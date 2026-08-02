/**
 * The measurement core. Every scope in the app reads its numbers through this
 * module, and every graticule it draws is *derived* here rather than typed in
 * from a picture of a real scope.
 *
 * ---------------------------------------------------------------------------
 * The thing to understand before touching any of this
 * ---------------------------------------------------------------------------
 *
 * We never see the video signal. We see whatever RGB the capture path handed
 * the browser, and that path has already made two decisions for us that it
 * does not reliably tell us about:
 *
 *   1. Which matrix it used to get from Y'CbCr to RGB (BT.601 or BT.709).
 *   2. Whether it expanded studio-range levels (Y 16-235) to full range
 *      (0-255), or passed them through untouched.
 *
 * Get either wrong and the scopes are confidently, plausibly wrong: a BT.709
 * signal read as BT.601 puts every colour-bar target about 5.7 degrees off its
 * vectorscope box, and unexpanded studio levels put reference white at 92 IRE
 * instead of 100. Both look like a mildly misadjusted camera rather than a
 * measurement error, which is exactly what makes them dangerous.
 *
 * So the interpretation is an explicit, user-visible setting
 * (`SignalInterpretation`), not a guess, and the UI states which one is in
 * force. There is no way to detect it from the pixels.
 */

export type MatrixId = 'bt601' | 'bt709' | 'bt2020'

/** How to read the RGB we were handed — not a property of the file, a decision about it. */
export type SignalRange = 'full' | 'limited'

export interface SignalInterpretation {
  matrix: MatrixId
  range: SignalRange
}

export const DEFAULT_INTERPRETATION: SignalInterpretation = {
  // HD is BT.709 and an ATEM Mini's multiview is HD, so this is the right
  // default here — but it is still a default, not a detection.
  matrix: 'bt709',
  range: 'full'
}

/**
 * Luma coefficients. Kg is derived rather than written down, because the three
 * must sum to exactly 1 and a transcribed Kg is the classic place for that to
 * quietly stop being true.
 */
export interface LumaCoefficients {
  kr: number
  kg: number
  kb: number
}

const COEFFICIENTS: Record<MatrixId, { kr: number; kb: number }> = {
  bt601: { kr: 0.299, kb: 0.114 },
  bt709: { kr: 0.2126, kb: 0.0722 },
  bt2020: { kr: 0.2627, kb: 0.0593 }
}

export const MATRIX_LABELS: Record<MatrixId, string> = {
  bt601: 'BT.601 (SD)',
  bt709: 'BT.709 (HD)',
  bt2020: 'BT.2020 (UHD)'
}

export function coefficients(matrix: MatrixId): LumaCoefficients {
  const { kr, kb } = COEFFICIENTS[matrix]
  return { kr, kg: 1 - kr - kb, kb }
}

export interface YCbCr {
  /** 0 = black, 1 = nominal white. */
  y: number
  /** -0.5 .. +0.5, zero at neutral. */
  cb: number
  cr: number
}

/**
 * R'G'B' (non-linear, 0..1) to Y'CbCr. This is the standard non-constant-luminance
 * form used by every video matrix we care about: luma is a weighted sum of the
 * *gamma-encoded* primaries, and the chroma differences are normalised so that a
 * full-amplitude primary swing lands at +/-0.5.
 */
export function rgbToYCbCr(r: number, g: number, b: number, matrix: MatrixId): YCbCr {
  const { kr, kg, kb } = coefficients(matrix)
  const y = kr * r + kg * g + kb * b
  return {
    y,
    cb: (b - y) / (2 * (1 - kb)),
    cr: (r - y) / (2 * (1 - kr))
  }
}

export function yCbCrToRgb(
  y: number,
  cb: number,
  cr: number,
  matrix: MatrixId
): [number, number, number] {
  const { kr, kg, kb } = coefficients(matrix)
  const r = y + cr * 2 * (1 - kr)
  const b = y + cb * 2 * (1 - kb)
  // Recovered from the luma equation rather than a second set of constants, so
  // it cannot disagree with rgbToYCbCr.
  const g = (y - kr * r - kb * b) / kg
  return [r, g, b]
}

/** Luma only — the hot path for waveform, zebras and false colour. */
export function luma(r: number, g: number, b: number, matrix: MatrixId): number {
  const { kr, kg, kb } = coefficients(matrix)
  return kr * r + kg * g + kb * b
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** 8-bit studio-range anchors, per ITU-R BT.601/709/2020 (identical in all three). */
export const STUDIO_BLACK_8BIT = 16
export const STUDIO_WHITE_8BIT = 235
const STUDIO_LUMA_SWING = STUDIO_WHITE_8BIT - STUDIO_BLACK_8BIT // 219

/**
 * Maps a received sample (0..1, as read out of the framebuffer) to signal level,
 * where 0 is video black and 1 is nominal white.
 *
 * With `range: 'full'` this is the identity — the capture path already expanded
 * studio levels for us. With `range: 'limited'` it undoes the fact that it
 * didn't. Values outside 0..1 are meaningful and deliberately not clamped:
 * that is super-white and sub-black, and hiding it would defeat the point of
 * having a scope.
 */
export function receivedToSignal(v: number, range: SignalRange): number {
  if (range === 'full') return v
  return (v * 255 - STUDIO_BLACK_8BIT) / STUDIO_LUMA_SWING
}

/** Inverse of receivedToSignal — used to place graticule lines in screen space. */
export function signalToReceived(s: number, range: SignalRange): number {
  if (range === 'full') return s
  return (s * STUDIO_LUMA_SWING + STUDIO_BLACK_8BIT) / 255
}

/** Signal level to IRE. Black is 0 IRE and nominal white is 100 IRE by definition. */
export function signalToIre(s: number): number {
  return s * 100
}

export function ireToSignal(ire: number): number {
  return ire / 100
}

/**
 * The waveform's vertical extent, in IRE. Wider than 0..100 on purpose: an ATEM
 * passes super-white through, and a scope that crops at 100 cannot show you
 * that it did.
 */
export const WAVEFORM_IRE_MIN = -10
export const WAVEFORM_IRE_MAX = 110

/** Graticule lines for the waveform, in IRE. */
export const WAVEFORM_GRATICULE_IRE = [-10, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]

// ---------------------------------------------------------------------------
// Vectorscope targets
// ---------------------------------------------------------------------------

export type BarColourName = 'red' | 'magenta' | 'blue' | 'cyan' | 'green' | 'yellow'

/** R'G'B' switch pattern for each colour-bar primary/complementary, at unit amplitude. */
const BAR_PRIMARIES: Record<BarColourName, [number, number, number]> = {
  red: [1, 0, 0],
  magenta: [1, 0, 1],
  blue: [0, 0, 1],
  cyan: [0, 1, 1],
  green: [0, 1, 0],
  yellow: [1, 1, 0]
}

export interface VectorTarget {
  name: BarColourName
  cb: number
  cr: number
  /** Degrees, measured anticlockwise from the +Cb axis — the convention a vectorscope's graticule uses. */
  angleDeg: number
  /** Distance from the centre, in the same units as cb/cr. */
  magnitude: number
}

/**
 * The six colour-bar boxes, computed from the matrix rather than tabulated.
 *
 * `amplitude` is the bar amplitude as a fraction: 0.75 for 75% bars, 1.0 for
 * 100% bars. Because the targets fall out of the same matrix the scope plots
 * with, changing the matrix moves the graticule and the trace together — which
 * is the honest behaviour. Selecting the wrong matrix should not silently make
 * a mismatched signal look correct.
 */
export function vectorTargets(matrix: MatrixId, amplitude = 0.75): VectorTarget[] {
  return (Object.keys(BAR_PRIMARIES) as BarColourName[]).map((name) => {
    const [r, g, b] = BAR_PRIMARIES[name]
    const { cb, cr } = rgbToYCbCr(r * amplitude, g * amplitude, b * amplitude, matrix)
    let angleDeg = (Math.atan2(cr, cb) * 180) / Math.PI
    if (angleDeg < 0) angleDeg += 360
    return { name, cb, cr, angleDeg, magnitude: Math.hypot(cb, cr) }
  })
}

/**
 * The vectorscope's plotted radius at full scale. A saturated primary reaches
 * |Cb| or |Cr| of exactly 0.5, so 0.5 is the natural unit circle; the graticule
 * is drawn against it and 75% bars land at 0.375 on their respective axes.
 */
export const VECTOR_FULL_SCALE = 0.5

// ---------------------------------------------------------------------------
// False colour
// ---------------------------------------------------------------------------

export interface FalseColourBand {
  /** Inclusive lower bound in IRE. The band runs up to the next band's `fromIre`. */
  fromIre: number
  /** CSS/GL colour as [r, g, b] in 0..1. */
  colour: [number, number, number]
  label: string
}

/**
 * The default false-colour scale.
 *
 * These are *our* bands, chosen to be legible and to put the boundaries where
 * they are useful (clipping, near-clip, the middle of the range, crush). They
 * are deliberately not presented as a reproduction of any camera manufacturer's
 * scale — ARRI's, RED's and Blackmagic's differ from each other and are tied to
 * their own log curves, and copying the colours without the curve would produce
 * something that looks authoritative and means nothing. Bands are editable in
 * the UI; the numbers below are only the starting point.
 */
export const DEFAULT_FALSE_COLOUR_BANDS: FalseColourBand[] = [
  { fromIre: -Infinity, colour: [0.25, 0.0, 0.5], label: 'sub-black' },
  { fromIre: 0, colour: [0.0, 0.0, 0.75], label: 'crushed' },
  { fromIre: 5, colour: [0.0, 0.55, 0.85], label: 'shadow' },
  { fromIre: 20, colour: [0.35, 0.35, 0.35], label: 'low mid' },
  { fromIre: 45, colour: [0.55, 0.55, 0.55], label: 'mid' },
  { fromIre: 55, colour: [0.75, 0.75, 0.75], label: 'high mid' },
  { fromIre: 70, colour: [0.95, 0.85, 0.0], label: 'highlight' },
  { fromIre: 90, colour: [0.95, 0.45, 0.0], label: 'near clip' },
  { fromIre: 100, colour: [0.9, 0.0, 0.0], label: 'clip' }
]

/** Resolves an IRE value to its band. Exported for the legend and for tests. */
export function falseColourBandFor(
  ire: number,
  bands = DEFAULT_FALSE_COLOUR_BANDS
): FalseColourBand {
  let found = bands[0]
  for (const band of bands) {
    if (ire >= band.fromIre) found = band
    else break
  }
  return found
}
