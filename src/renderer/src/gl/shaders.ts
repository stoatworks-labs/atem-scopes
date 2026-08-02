/**
 * Every shader in the app.
 *
 * ---------------------------------------------------------------------------
 * The rule that matters here
 * ---------------------------------------------------------------------------
 *
 * No colorimetry constant is written down in GLSL. The luma coefficients and
 * the studio-range mapping arrive as uniforms, computed by `shared/colorimetry.ts`
 * — the module with the tests. Duplicating `0.2126` into a shader is how the
 * graticule and the trace end up disagreeing by a fraction of a degree that
 * nobody notices until a client does.
 *
 * The shared prelude below is prepended to every program, so `toSignal` and
 * `lumaOf` mean the same thing in all of them.
 */

const PRELUDE = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

// kr, kg, kb — from coefficients() in shared/colorimetry.ts.
uniform vec3 uLumaCoeff;
// Affine received -> signal mapping: signal = received * uRange.x + uRange.y.
// Identity for full range; undoes 16-235 for studio range.
uniform vec2 uRange;

vec3 toSignal(vec3 rgb) { return rgb * uRange.x + uRange.y; }
float lumaOf(vec3 sig) { return dot(sig, uLumaCoeff); }

// Cb, Cr from signal RGB. The offset in toSignal cancels in a colour
// difference, so chroma only ever scales — which is the correct behaviour and
// worth knowing when reading this.
vec2 chromaOf(vec3 sig, float y) {
  return vec2(
    (sig.b - y) / (2.0 * (1.0 - uLumaCoeff.b)),
    (sig.r - y) / (2.0 * (1.0 - uLumaCoeff.r))
  );
}
`

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Shared by every point-cloud pass. The crop is in texture UV with a top-left
 * origin, matching `Rect` — the video texture is uploaded without
 * UNPACK_FLIP_Y_WEBGL, so row 0 of the frame is v = 0.
 *
 * `uPointSize` is not decoration. A point is one *device* pixel unless told
 * otherwise, so on a HiDPI display a 1.0 point covers a quarter of the CSS
 * pixel it is meant to mark and the trace loses most of its apparent density.
 * It matters far more on the vectorscope than the waveform: a waveform spreads
 * its samples over hundreds of columns, but every sample of a flat colour lands
 * on the *same* vectorscope coordinate, so an entire colour bar can render as a
 * single pixel and read as no trace at all.
 */
const SAMPLING = /* glsl */ `
uniform sampler2D uTex;
uniform vec4 uCrop;         // x, y, w, h in UV
uniform ivec2 uSampleGrid;  // columns, rows
uniform float uPointSize;

vec2 cellUv(ivec2 cell) {
  vec2 f = (vec2(cell) + 0.5) / vec2(uSampleGrid);
  return uCrop.xy + uCrop.zw * f;
}
`

// ---------------------------------------------------------------------------
// Waveform (luma, RGB parade, Y/Cb/Cr parade)
// ---------------------------------------------------------------------------

export const WAVEFORM_VERT =
  PRELUDE +
  SAMPLING +
  /* glsl */ `
uniform int uSegments;    // 1 for luma, 3 for either parade
uniform int uMode;        // 0 luma, 1 RGB parade, 2 YCbCr parade
uniform vec2 uIreRange;   // min, max IRE mapped to the tile's full height

out vec3 vColour;

void main() {
  int perSegment = uSampleGrid.x * uSampleGrid.y;
  int segment = gl_VertexID / perSegment;
  int index = gl_VertexID % perSegment;
  ivec2 cell = ivec2(index % uSampleGrid.x, index / uSampleGrid.x);

  vec3 sig = toSignal(texture(uTex, cellUv(cell)).rgb);

  float value;
  vec3 colour;
  if (uMode == 0) {
    value = lumaOf(sig);
    colour = vec3(0.55, 1.0, 0.65);
  } else if (uMode == 1) {
    value = segment == 0 ? sig.r : (segment == 1 ? sig.g : sig.b);
    colour = segment == 0 ? vec3(1.0, 0.25, 0.25)
           : segment == 1 ? vec3(0.25, 1.0, 0.35)
                          : vec3(0.35, 0.5, 1.0);
  } else {
    float y = lumaOf(sig);
    if (segment == 0) {
      value = y;
      colour = vec3(0.85);
    } else {
      vec2 c = chromaOf(sig, y);
      // Chroma is bipolar. Centring it on 50 IRE lets it share one graticule
      // with luma; the UI labels that centre line as chroma zero, not 50 IRE.
      value = 0.5 + (segment == 1 ? c.x : c.y);
      colour = segment == 1 ? vec3(0.45, 0.65, 1.0) : vec3(1.0, 0.55, 0.55);
    }
  }

  float t = (value * 100.0 - uIreRange.x) / (uIreRange.y - uIreRange.x);
  float segWidth = 1.0 / float(uSegments);
  float xInSeg = (float(cell.x) + 0.5) / float(uSampleGrid.x);
  float x = (float(segment) + xInSeg) * segWidth;

  gl_Position = vec4(x * 2.0 - 1.0, t * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = uPointSize;
  vColour = colour;
}
`

export const TRACE_FRAG =
  PRELUDE +
  /* glsl */ `
uniform float uIntensity;
in vec3 vColour;
out vec4 fragColour;
void main() {
  // Additive, so intensity is a density control: one sample barely marks the
  // tile and a thousand on the same spot saturate it.
  fragColour = vec4(vColour * uIntensity, 1.0);
}
`

// ---------------------------------------------------------------------------
// Vectorscope
// ---------------------------------------------------------------------------

export const VECTORSCOPE_VERT =
  PRELUDE +
  SAMPLING +
  /* glsl */ `
uniform float uFullScale;   // chroma magnitude at the graticule's outer ring
uniform float uZoom;
uniform float uAspect;      // tile width / height, so the plot stays circular

out vec3 vColour;

void main() {
  ivec2 cell = ivec2(gl_VertexID % uSampleGrid.x, gl_VertexID / uSampleGrid.x);
  vec3 sig = toSignal(texture(uTex, cellUv(cell)).rgb);
  vec2 c = chromaOf(sig, lumaOf(sig)) / uFullScale * uZoom;

  // Cb runs right, Cr runs up — the mathematical convention, and the same one
  // vectorTargets() uses to place the graticule, so trace and graticule cannot
  // drift apart.
  vec2 p = c;
  if (uAspect > 1.0) p.x /= uAspect; else p.y *= uAspect;

  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = uPointSize;
  vColour = vec3(0.45, 1.0, 0.55);
}
`

// ---------------------------------------------------------------------------
// Histogram — accumulate then draw
// ---------------------------------------------------------------------------

/** Pass 1: one point per sample per enabled channel, additively binned into a bins x 1 float target. */
export const HISTOGRAM_ACCUM_VERT =
  PRELUDE +
  SAMPLING +
  /* glsl */ `
uniform int uBins;
flat out int vChannel;

void main() {
  int perChannel = uSampleGrid.x * uSampleGrid.y;
  int channel = gl_VertexID / perChannel;   // 0 R, 1 G, 2 B, 3 luma
  int index = gl_VertexID % perChannel;
  ivec2 cell = ivec2(index % uSampleGrid.x, index / uSampleGrid.x);

  vec3 sig = toSignal(texture(uTex, cellUv(cell)).rgb);
  float value = channel == 0 ? sig.r
              : channel == 1 ? sig.g
              : channel == 2 ? sig.b
                             : lumaOf(sig);

  // Out-of-range samples pile into the end bins rather than vanishing: a
  // histogram that hides clipping is worse than no histogram.
  float bin = clamp(value, 0.0, 1.0) * float(uBins - 1);
  float x = (bin + 0.5) / float(uBins);

  // Deliberately 1.0 and not uPointSize: this pass writes into a bins x 1
  // target, where a fatter point would smear a sample across neighbouring bins.
  gl_Position = vec4(x * 2.0 - 1.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  vChannel = channel;
}
`

export const HISTOGRAM_ACCUM_FRAG = /* glsl */ `#version 300 es
precision highp float;
flat in int vChannel;
out vec4 fragColour;
void main() {
  // One-hot, so additive blending counts each channel independently.
  fragColour = vec4(
    vChannel == 0 ? 1.0 : 0.0,
    vChannel == 1 ? 1.0 : 0.0,
    vChannel == 2 ? 1.0 : 0.0,
    vChannel == 3 ? 1.0 : 0.0
  );
}
`

/** Pass 2: read the bins back and draw them as filled columns. */
export const HISTOGRAM_DRAW_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aQuad;
out vec2 vUv;
void main() {
  vUv = aQuad;
  gl_Position = vec4(aQuad * 2.0 - 1.0, 0.0, 1.0);
}
`

export const HISTOGRAM_DRAW_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uBins;
uniform float uNorm;        // scales counts to 0..1 tile height
uniform vec4 uChannelMask;  // which of R,G,B,luma to draw
uniform float uBinsPerPixel;
in vec2 vUv;
out vec4 fragColour;

/**
 * Reduce every bin the output pixel covers, not just the one under its centre.
 *
 * A 256-bin histogram in a 240-pixel-wide tile puts more than one bin behind
 * each pixel, and point-sampling then decides which bins are *visible* by where
 * the pixel centres happen to land. A one-bin spike — clipped white, crushed
 * black, a colour bar — can disappear entirely, and reappear when the tile is
 * resized. That is precisely the reading a histogram exists to show.
 *
 * The reducer is max rather than mean, deliberately: a mean would average a
 * narrow spike down against its empty neighbours and hide it just as
 * effectively, only more smoothly.
 */
vec4 binMax(float u) {
  int bins = textureSize(uBins, 0).x;
  float halfSpan = max(uBinsPerPixel, 1.0) * 0.5;
  float centre = u * float(bins);
  int first = int(max(0.0, floor(centre - halfSpan)));
  int last = int(min(float(bins - 1), ceil(centre + halfSpan)));
  vec4 peak = vec4(0.0);
  // Bounded so an absurdly narrow tile cannot spin the fragment shader.
  for (int i = first; i <= last && i - first < 32; i++) {
    peak = max(peak, texelFetch(uBins, ivec2(i, 0), 0));
  }
  return peak;
}

void main() {
  vec4 counts = binMax(vUv.x) * uNorm;
  vec3 rgb = vec3(0.0);
  float a = 0.0;

  // Each channel is drawn as its own translucent column so overlaps read as
  // the mix rather than whichever was drawn last.
  if (uChannelMask.r > 0.5 && vUv.y < counts.r) { rgb += vec3(1.0, 0.2, 0.2); a += 0.55; }
  if (uChannelMask.g > 0.5 && vUv.y < counts.g) { rgb += vec3(0.2, 1.0, 0.3); a += 0.55; }
  if (uChannelMask.b > 0.5 && vUv.y < counts.b) { rgb += vec3(0.3, 0.45, 1.0); a += 0.55; }
  if (uChannelMask.a > 0.5 && vUv.y < counts.a) { rgb += vec3(0.85);          a += 0.55; }

  if (a <= 0.0) discard;
  fragColour = vec4(rgb / max(a / 0.55, 1.0), min(a, 1.0));
}
`

// ---------------------------------------------------------------------------
// Picture, with the exposure/focus overlays
// ---------------------------------------------------------------------------

export const PICTURE_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aQuad;
uniform vec4 uCrop;
// Letterbox/pillarbox factors, 1.0 on the axis that fills the tile. A picture
// stretched to fit its tile is not a picture of the signal: a 16:9 multiview
// window in a tall tile reads as the wrong lens, and any judgement about framing
// made from it is wrong.
uniform vec2 uFit;
out vec2 vUv;
void main() {
  // Quad y runs 0 at the bottom in NDC but the crop's y is top-left origin, so
  // v is flipped here rather than by flipping the texture upload (which every
  // other pass would then have to undo).
  vUv = uCrop.xy + uCrop.zw * vec2(aQuad.x, 1.0 - aQuad.y);
  gl_Position = vec4((aQuad * 2.0 - 1.0) * uFit, 0.0, 1.0);
}
`

export const MAX_FALSE_COLOUR_BANDS = 16

export const PICTURE_FRAG =
  PRELUDE +
  /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;        // 1 / texture size, for the peaking gradient
uniform int uOverlay;       // 0 none, 1 false colour, 2 zebra, 3 focus peaking

uniform int uBandCount;
uniform float uBandIre[${MAX_FALSE_COLOUR_BANDS}];
uniform vec3 uBandColour[${MAX_FALSE_COLOUR_BANDS}];

uniform float uZebraIre;
uniform float uZebraIre2;   // < -1000 disables the second band
uniform float uPeakThreshold;
uniform vec3 uPeakColour;

in vec2 vUv;
out vec4 fragColour;

float lumaAt(vec2 uv) {
  return lumaOf(toSignal(texture(uTex, uv).rgb));
}

void main() {
  vec3 rgb = texture(uTex, vUv).rgb;
  float ire = lumaOf(toSignal(rgb)) * 100.0;

  if (uOverlay == 1) {
    // Bands are lower-inclusive and ascending, matching falseColourBandFor().
    vec3 banded = uBandColour[0];
    for (int i = 0; i < ${MAX_FALSE_COLOUR_BANDS}; i++) {
      if (i >= uBandCount) break;
      if (ire >= uBandIre[i]) banded = uBandColour[i];
    }
    fragColour = vec4(banded, 1.0);
    return;
  }

  if (uOverlay == 2) {
    // 45-degree stripes in device pixels, so they stay the same width however
    // the tile is scaled and never alias into a flat wash.
    float stripe = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 12.0));
    bool hit = ire >= uZebraIre;
    bool hit2 = uZebraIre2 > -1000.0 && ire >= uZebraIre2;
    if (hit2 && stripe > 0.5) { fragColour = vec4(1.0, 0.35, 0.0, 1.0); return; }
    if (hit && stripe > 0.5) { fragColour = vec4(1.0, 1.0, 1.0, 1.0); return; }
    fragColour = vec4(rgb, 1.0);
    return;
  }

  if (uOverlay == 3) {
    // Sobel on luma. Cheap, isotropic enough, and it responds to edge contrast
    // rather than absolute level, so a dark but sharp subject still peaks.
    float tl = lumaAt(vUv + uTexel * vec2(-1.0, -1.0));
    float t  = lumaAt(vUv + uTexel * vec2( 0.0, -1.0));
    float tr = lumaAt(vUv + uTexel * vec2( 1.0, -1.0));
    float l  = lumaAt(vUv + uTexel * vec2(-1.0,  0.0));
    float r  = lumaAt(vUv + uTexel * vec2( 1.0,  0.0));
    float bl = lumaAt(vUv + uTexel * vec2(-1.0,  1.0));
    float b  = lumaAt(vUv + uTexel * vec2( 0.0,  1.0));
    float br = lumaAt(vUv + uTexel * vec2( 1.0,  1.0));
    float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
    float gy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
    float g = length(vec2(gx, gy));
    if (g >= uPeakThreshold) {
      fragColour = vec4(uPeakColour, 1.0);
      return;
    }
    // Desaturated underneath so the tint is the only colour on the tile.
    float y = lumaOf(toSignal(rgb));
    fragColour = vec4(vec3(y) * 0.8, 1.0);
    return;
  }

  fragColour = vec4(rgb, 1.0);
}
`

// ---------------------------------------------------------------------------
// Flat colour, for graticules drawn as line primitives
// ---------------------------------------------------------------------------

export const LINE_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

export const LINE_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec4 uColour;
out vec4 fragColour;
void main() { fragColour = uColour; }
`
