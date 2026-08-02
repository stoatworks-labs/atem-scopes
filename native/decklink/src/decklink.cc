// Blackmagic DeckLink capture for atem-scopes.
//
// UNVERIFIED. This has never been compiled or run — see ../README.md. The API
// use follows the SDK's documented capture sequence, and the COM ownership and
// string handling mirror weblinked's DeckLink output, which is the closest
// thing to a tested reference available here.
//
// Two decisions worth understanding before changing anything:
//
// 1. It captures bmdFormat8BitYUV, not BGRA. The card would convert for us, but
//    it does not report which matrix it used, and RGB cannot be un-converted.
//    Every scope in this app depends on knowing the matrix and range a reading
//    was taken under, so the conversion stays ours.
//
// 2. Frames land in a SharedArrayBuffer supplied by JavaScript, with a triple
//    buffer so the capture thread never waits on the renderer. The capture
//    callback runs on a DeckLink thread, not the Node loop, and must not touch
//    a napi_env — so it only ever memcpy's and bumps an atomic.

#include <napi.h>

#include <atomic>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "DeckLinkAPI.h"

namespace {

// --- platform string handling ----------------------------------------------
// The SDK returns a different string type per platform and each has its own
// ownership rule. Getting this wrong leaks on every enumeration.

#if defined(_WIN32)
std::string DeckLinkString(BSTR text) {
  if (text == nullptr) return {};
  const int length = ::SysStringLen(text);
  const int bytes =
      ::WideCharToMultiByte(CP_UTF8, 0, text, length, nullptr, 0, nullptr, nullptr);
  std::string out(static_cast<size_t>(bytes), '\0');
  ::WideCharToMultiByte(CP_UTF8, 0, text, length, out.data(), bytes, nullptr, nullptr);
  ::SysFreeString(text);
  return out;
}
#elif defined(__APPLE__)
std::string DeckLinkString(CFStringRef text) {
  if (text == nullptr) return {};
  const CFIndex length = CFStringGetLength(text);
  const CFIndex maxBytes = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
  std::vector<char> buffer(static_cast<size_t>(maxBytes), '\0');
  std::string result;
  if (CFStringGetCString(text, buffer.data(), maxBytes, kCFStringEncodingUTF8)) {
    result = buffer.data();
  }
  CFRelease(text);
  return result;
}
#else
std::string DeckLinkString(const char* text) {
  if (text == nullptr) return {};
  std::string out(text);
  ::free(const_cast<char*>(text));  // the Linux SDK returns malloc'd strings
  return out;
}
#endif

template <typename T>
void SafeRelease(T*& object) {
  if (object != nullptr) {
    object->Release();
    object = nullptr;
  }
}

// --- the shared frame ring --------------------------------------------------

constexpr int kSlots = 3;

/// Header laid out at the start of the SharedArrayBuffer, read by the renderer.
/// Field order is part of the contract with decklinkCapture.ts — changing it
/// without changing both is the kind of mismatch that shows as a torn picture
/// rather than an error.
struct RingHeader {
  std::atomic<uint32_t> ready;   // slot index holding the most recent complete frame
  std::atomic<uint32_t> serial;  // increments per frame, so the renderer can skip re-uploads
  uint32_t width;
  uint32_t height;
  uint32_t rowBytes;
  uint32_t slotBytes;
};

class Capture;

/// The SDK's callback interface. Reference counted independently of Capture,
/// because the card may hold a reference past our own teardown.
class InputCallback final : public IDeckLinkInputCallback {
 public:
  explicit InputCallback(Capture* owner) : owner_(owner) {}

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, LPVOID*) override { return E_NOINTERFACE; }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++refCount_; }
  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG remaining = --refCount_;
    if (remaining == 0) delete this;
    return remaining;
  }

  HRESULT STDMETHODCALLTYPE VideoInputFormatChanged(BMDVideoInputFormatChangedEvents,
                                                   IDeckLinkDisplayMode*,
                                                   BMDDetectedVideoInputFormatFlags) override;
  HRESULT STDMETHODCALLTYPE VideoInputFrameArrived(IDeckLinkVideoInputFrame*,
                                                  IDeckLinkAudioInputPacket*) override;

  void Detach() {
    std::lock_guard<std::mutex> lock(mutex_);
    owner_ = nullptr;
  }

 private:
  std::atomic<ULONG> refCount_{1};
  std::mutex mutex_;
  Capture* owner_;
};

class Capture {
 public:
  Capture(IDeckLink* device, IDeckLinkInput* input) : device_(device), input_(input) {}

  ~Capture() { Stop(); }

  /// `buffer` is owned by JavaScript and must outlive the capture — the JS side
  /// keeps the SharedArrayBuffer referenced for exactly this reason.
  bool Start(uint8_t* buffer, size_t bufferBytes, std::string* error) {
    buffer_ = buffer;
    bufferBytes_ = bufferBytes;
    header_ = reinterpret_cast<RingHeader*>(buffer);

    callback_ = new InputCallback(this);
    if (input_->SetCallback(callback_) != S_OK) {
      *error = "SetCallback failed";
      return false;
    }

    // Format detection on, and the initial mode is only a starting guess: the
    // card tells us what is actually arriving through VideoInputFormatChanged,
    // and a wrong guess here costs one restart rather than a failure.
    if (input_->EnableVideoInput(bmdModeHD1080i50, bmdFormat8BitYUV,
                                 bmdVideoInputEnableFormatDetection) != S_OK) {
      *error = "EnableVideoInput failed (is another application using the card?)";
      return false;
    }
    if (input_->StartStreams() != S_OK) {
      *error = "StartStreams failed";
      return false;
    }
    running_ = true;
    return true;
  }

  void Stop() {
    if (running_) {
      input_->StopStreams();
      input_->DisableVideoInput();
      input_->SetCallback(nullptr);
      running_ = false;
    }
    if (callback_ != nullptr) {
      callback_->Detach();
      SafeRelease(callback_);
    }
    SafeRelease(input_);
    SafeRelease(device_);
  }

  /// Called on a DeckLink thread. No napi_env, no allocation, no locks that the
  /// Node loop also takes.
  void OnFrame(IDeckLinkVideoInputFrame* frame) {
    if (frame == nullptr || header_ == nullptr) return;
    if ((frame->GetFlags() & bmdFrameHasNoInputSource) != 0) return;

    void* bytes = nullptr;
    if (frame->GetBytes(&bytes) != S_OK || bytes == nullptr) return;

    const uint32_t rowBytes = static_cast<uint32_t>(frame->GetRowBytes());
    const uint32_t height = static_cast<uint32_t>(frame->GetHeight());
    const size_t frameBytes = static_cast<size_t>(rowBytes) * height;

    const size_t slotBytes = (bufferBytes_ - sizeof(RingHeader)) / kSlots;
    if (frameBytes > slotBytes) return;  // a mode larger than the ring was sized for

    // Write to the slot that is neither the one being read nor the last one
    // published, so a reader holding `ready` is never overwritten mid-read.
    const uint32_t ready = header_->ready.load(std::memory_order_acquire);
    const uint32_t slot = (ready + 1) % kSlots;

    uint8_t* dest = buffer_ + sizeof(RingHeader) + slot * slotBytes;
    std::memcpy(dest, bytes, frameBytes);

    header_->width = static_cast<uint32_t>(frame->GetWidth());
    header_->height = height;
    header_->rowBytes = rowBytes;
    header_->slotBytes = static_cast<uint32_t>(slotBytes);
    // Release ordering: the memcpy above must be visible before the reader sees
    // the new slot index, or it reads a half-written frame as a torn picture.
    header_->ready.store(slot, std::memory_order_release);
    header_->serial.fetch_add(1, std::memory_order_release);
  }

  void OnFormatChanged(IDeckLinkDisplayMode* mode) {
    if (mode == nullptr) return;
    // The documented restart sequence. Anything less and the card keeps
    // delivering the old raster while the picture has already changed.
    input_->StopStreams();
    input_->EnableVideoInput(mode->GetDisplayMode(), bmdFormat8BitYUV,
                             bmdVideoInputEnableFormatDetection);
    input_->StartStreams();
  }

 private:
  IDeckLink* device_ = nullptr;
  IDeckLinkInput* input_ = nullptr;
  InputCallback* callback_ = nullptr;
  uint8_t* buffer_ = nullptr;
  size_t bufferBytes_ = 0;
  RingHeader* header_ = nullptr;
  bool running_ = false;
};

HRESULT InputCallback::VideoInputFrameArrived(IDeckLinkVideoInputFrame* frame,
                                              IDeckLinkAudioInputPacket*) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (owner_ != nullptr) owner_->OnFrame(frame);
  return S_OK;
}

HRESULT InputCallback::VideoInputFormatChanged(BMDVideoInputFormatChangedEvents,
                                               IDeckLinkDisplayMode* mode,
                                               BMDDetectedVideoInputFormatFlags) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (owner_ != nullptr) owner_->OnFormatChanged(mode);
  return S_OK;
}

std::map<std::string, std::unique_ptr<Capture>>& OpenCaptures() {
  static std::map<std::string, std::unique_ptr<Capture>> captures;
  return captures;
}

// --- N-API surface ----------------------------------------------------------

/// Returns [{ id, label }]. `id` is the persistent device id where the card
/// offers one, so a workspace saved against a specific input still resolves
/// after a reboot reorders enumeration.
Napi::Value ListDevices(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array result = Napi::Array::New(env);

  IDeckLinkIterator* iterator = CreateDeckLinkIteratorInstance();
  if (iterator == nullptr) return result;  // no Desktop Video installed

  IDeckLink* device = nullptr;
  uint32_t index = 0;
  while (iterator->Next(&device) == S_OK) {
    IDeckLinkInput* input = nullptr;
    if (device->QueryInterface(IID_IDeckLinkInput, reinterpret_cast<void**>(&input)) == S_OK) {
      decklink_string_t name = nullptr;
      std::string label = device->GetDisplayName(&name) == S_OK ? DeckLinkString(name) : "DeckLink";

      std::string id = label;
      IDeckLinkProfileAttributes* attributes = nullptr;
      if (device->QueryInterface(IID_IDeckLinkProfileAttributes,
                                 reinterpret_cast<void**>(&attributes)) == S_OK) {
        decklink_string_t handle = nullptr;
        if (attributes->GetString(BMDDeckLinkDeviceHandle, &handle) == S_OK) {
          id = DeckLinkString(handle);
        }
        SafeRelease(attributes);
      }

      Napi::Object entry = Napi::Object::New(env);
      entry.Set("id", Napi::String::New(env, id));
      entry.Set("label", Napi::String::New(env, label));
      result.Set(index++, entry);
      SafeRelease(input);
    }
    SafeRelease(device);
  }
  SafeRelease(iterator);
  return result;
}

/// openDevice(id, sharedArrayBuffer) — the buffer must be at least
/// sizeof(RingHeader) + 3 * maxFrameBytes and is kept alive by the caller.
Napi::Value OpenDevice(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString() || !info[1].IsArrayBuffer()) {
    Napi::TypeError::New(env, "openDevice(id: string, buffer: SharedArrayBuffer)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const std::string id = info[0].As<Napi::String>();
  Napi::ArrayBuffer buffer = info[1].As<Napi::ArrayBuffer>();

  if (OpenCaptures().count(id) != 0) return env.Undefined();

  IDeckLinkIterator* iterator = CreateDeckLinkIteratorInstance();
  if (iterator == nullptr) {
    Napi::Error::New(env, "No DeckLink driver found. Is Desktop Video installed?")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  IDeckLink* device = nullptr;
  IDeckLink* found = nullptr;
  while (iterator->Next(&device) == S_OK) {
    decklink_string_t name = nullptr;
    const std::string label =
        device->GetDisplayName(&name) == S_OK ? DeckLinkString(name) : std::string();
    if (label == id) {
      found = device;  // ownership transfers to Capture
      break;
    }
    SafeRelease(device);
  }
  SafeRelease(iterator);

  if (found == nullptr) {
    Napi::Error::New(env, "DeckLink device not found: " + id).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  IDeckLinkInput* input = nullptr;
  if (found->QueryInterface(IID_IDeckLinkInput, reinterpret_cast<void**>(&input)) != S_OK) {
    SafeRelease(found);
    Napi::Error::New(env, "Device has no input interface: " + id).ThrowAsJavaScriptException();
    return env.Undefined();
  }

  auto capture = std::make_unique<Capture>(found, input);
  std::string error;
  if (!capture->Start(static_cast<uint8_t*>(buffer.Data()), buffer.ByteLength(), &error)) {
    Napi::Error::New(env, error).ThrowAsJavaScriptException();
    return env.Undefined();
  }
  OpenCaptures()[id] = std::move(capture);
  return env.Undefined();
}

Napi::Value CloseDevice(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) return env.Undefined();
  OpenCaptures().erase(info[0].As<Napi::String>().Utf8Value());
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("listDevices", Napi::Function::New(env, ListDevices));
  exports.Set("openDevice", Napi::Function::New(env, OpenDevice));
  exports.Set("closeDevice", Napi::Function::New(env, CloseDevice));
  // Published so the JS side sizes the ring and parses the header from one
  // source of truth rather than a second copy of the struct layout.
  exports.Set("headerBytes", Napi::Number::New(env, sizeof(RingHeader)));
  exports.Set("slots", Napi::Number::New(env, kSlots));
  return exports;
}

}  // namespace

NODE_API_MODULE(decklink, Init)
