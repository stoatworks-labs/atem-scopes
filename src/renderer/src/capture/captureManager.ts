/**
 * Owns every open capture device and the single animation-frame loop that
 * drives the whole workspace.
 *
 * animATEM's capture manager is the same idea for one device: one <video>
 * element, one rAF, many consumers drawing their own crops. This one holds
 * several, because a useful workspace is usually the multiview *plus* a
 * full-raster feed off an aux — a multiview tile is a few hundred pixels wide,
 * compressed over USB, and has the switcher's own label burnt into it, so it is
 * a monitoring aid rather than a measurement. An aux out captured whole is the
 * honest source, and both should be on screen at once.
 *
 * The loop ticks once per frame regardless of how many tiles are subscribed;
 * tiles do not each request their own.
 */

export interface OpenCapture {
  deviceId: string
  label: string
  video: HTMLVideoElement
  stream: MediaStream
  width: number
  height: number
}

type Listener = () => void

export async function listVideoInputs(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'videoinput')
}

/**
 * Device labels are blank until the page has been granted camera permission
 * once. Asking for any device and immediately stopping it is the standard way
 * to get a named list, and without it the picker shows a column of empty rows.
 */
export async function primeDeviceLabels(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
  stream.getTracks().forEach((t) => t.stop())
}

class CaptureManager {
  private captures = new Map<string, OpenCapture>()
  private errors = new Map<string, string>()
  private frameListeners = new Set<Listener>()
  private stateListeners = new Set<Listener>()
  private rafHandle: number | null = null

  getOpen(): OpenCapture[] {
    return [...this.captures.values()]
  }

  get(deviceId: string): OpenCapture | undefined {
    return this.captures.get(deviceId)
  }

  getError(deviceId: string): string | undefined {
    return this.errors.get(deviceId)
  }

  onFrame(listener: Listener): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onState(listener: Listener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  /**
   * Adopts an already-made MediaStream — used by the built-in test pattern, so
   * a generated signal travels the same path as a real device rather than
   * bypassing it and proving less.
   */
  async openStream(deviceId: string, label: string, stream: MediaStream): Promise<void> {
    if (this.captures.has(deviceId)) return
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    this.captures.set(deviceId, { deviceId, label, video, stream, width: 0, height: 0 })
    this.ensureLoop()
    this.notifyState()
  }

  async open(deviceId: string, label: string): Promise<void> {
    if (this.captures.has(deviceId)) return
    this.errors.delete(deviceId)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          // Ask for the largest the device offers rather than pinning a size:
          // an ATEM's USB multiview is 1080p on some models and 720p on
          // others, and an exact constraint fails outright on the wrong one.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60 }
        },
        audio: false
      })
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      await video.play()
      this.captures.set(deviceId, { deviceId, label, video, stream, width: 0, height: 0 })
      this.ensureLoop()
    } catch (err) {
      this.errors.set(deviceId, err instanceof Error ? err.message : String(err))
    }
    this.notifyState()
  }

  close(deviceId: string): void {
    const capture = this.captures.get(deviceId)
    if (!capture) return
    capture.stream.getTracks().forEach((t) => t.stop())
    capture.video.srcObject = null
    this.captures.delete(deviceId)
    if (this.captures.size === 0 && this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle)
      this.rafHandle = null
    }
    this.notifyState()
  }

  closeAll(): void {
    for (const id of [...this.captures.keys()]) this.close(id)
  }

  private ensureLoop(): void {
    if (this.rafHandle === null) this.loop()
  }

  private loop = (): void => {
    let changed = false
    for (const capture of this.captures.values()) {
      const { videoWidth, videoHeight } = capture.video
      if (videoWidth > 0 && (capture.width !== videoWidth || capture.height !== videoHeight)) {
        capture.width = videoWidth
        capture.height = videoHeight
        // A resolution change invalidates the calibration geometry keyed to the
        // old one, so this has to be a state change and not a silent update.
        changed = true
      }
    }
    if (changed) this.notifyState()
    this.frameListeners.forEach((listener) => listener())
    this.rafHandle = requestAnimationFrame(this.loop)
  }

  private notifyState(): void {
    this.stateListeners.forEach((listener) => listener())
  }
}

export const captureManager = new CaptureManager()
