import { describe, expect, it } from 'vitest'
import {
  coefficients,
  DEFAULT_FALSE_COLOUR_BANDS,
  falseColourBandFor,
  luma,
  receivedToSignal,
  rgbToYCbCr,
  signalToIre,
  signalToReceived,
  STUDIO_BLACK_8BIT,
  STUDIO_WHITE_8BIT,
  vectorTargets,
  yCbCrToRgb,
  type MatrixId
} from './colorimetry'

const MATRICES: MatrixId[] = ['bt601', 'bt709', 'bt2020']

describe('coefficients', () => {
  it.each(MATRICES)('%s luma coefficients sum to exactly 1', (matrix) => {
    const { kr, kg, kb } = coefficients(matrix)
    expect(kr + kg + kb).toBeCloseTo(1, 12)
  })

  it('derives Kg rather than tabulating it', () => {
    // BT.709's Kg is the one everyone half-remembers as 0.7152.
    expect(coefficients('bt709').kg).toBeCloseTo(0.7152, 10)
    expect(coefficients('bt601').kg).toBeCloseTo(0.587, 10)
  })
})

describe('rgbToYCbCr', () => {
  it.each(MATRICES)('%s: neutral greys have zero chroma', (matrix) => {
    for (const v of [0, 0.18, 0.5, 1]) {
      const { y, cb, cr } = rgbToYCbCr(v, v, v, matrix)
      expect(y).toBeCloseTo(v, 12)
      expect(cb).toBeCloseTo(0, 12)
      expect(cr).toBeCloseTo(0, 12)
    }
  })

  it.each(MATRICES)('%s: round trips back to RGB', (matrix) => {
    const samples: [number, number, number][] = [
      [0.75, 0, 0],
      [0, 0.75, 0],
      [0, 0, 0.75],
      [0.2, 0.6, 0.9],
      [1, 1, 0]
    ]
    for (const [r, g, b] of samples) {
      const { y, cb, cr } = rgbToYCbCr(r, g, b, matrix)
      const [r2, g2, b2] = yCbCrToRgb(y, cb, cr, matrix)
      expect(r2).toBeCloseTo(r, 10)
      expect(g2).toBeCloseTo(g, 10)
      expect(b2).toBeCloseTo(b, 10)
    }
  })

  it.each(MATRICES)(
    '%s: a pure primary at amplitude a lands at exactly a/2 on its own axis',
    (matrix) => {
      // Falls out of the normalisation: (R - Kr·R) / (2(1 - Kr)) = R/2, whatever Kr is.
      // If this ever fails, the chroma denominators have been mistyped.
      for (const a of [0.75, 1]) {
        expect(rgbToYCbCr(a, 0, 0, matrix).cr).toBeCloseTo(a / 2, 12)
        expect(rgbToYCbCr(0, 0, a, matrix).cb).toBeCloseTo(a / 2, 12)
      }
    }
  )

  it('luma() agrees with rgbToYCbCr().y', () => {
    for (const matrix of MATRICES) {
      expect(luma(0.2, 0.6, 0.9, matrix)).toBeCloseTo(rgbToYCbCr(0.2, 0.6, 0.9, matrix).y, 12)
    }
  })
})

describe('vectorTargets', () => {
  it('places 75% bars at magnitude 0.375 on the primary axes', () => {
    const targets = vectorTargets('bt709', 0.75)
    expect(targets.find((t) => t.name === 'red')!.cr).toBeCloseTo(0.375, 12)
    expect(targets.find((t) => t.name === 'blue')!.cb).toBeCloseTo(0.375, 12)
  })

  it('puts complementaries opposite their primaries', () => {
    const targets = vectorTargets('bt709', 0.75)
    const pairs: [string, string][] = [
      ['red', 'cyan'],
      ['green', 'magenta'],
      ['blue', 'yellow']
    ]
    for (const [a, b] of pairs) {
      const ta = targets.find((t) => t.name === a)!
      const tb = targets.find((t) => t.name === b)!
      expect(ta.cb).toBeCloseTo(-tb.cb, 12)
      expect(ta.cr).toBeCloseTo(-tb.cr, 12)
      expect(Math.abs(ta.angleDeg - tb.angleDeg)).toBeCloseTo(180, 10)
    }
  })

  it('rotates the graticule between BT.601 and BT.709', () => {
    // The whole reason the matrix is a user-visible setting. Reading a 709
    // signal on a 601 graticule throws every box out by this much, which looks
    // like a hue error in the camera rather than a mis-set scope.
    const red601 = vectorTargets('bt601', 0.75).find((t) => t.name === 'red')!
    const red709 = vectorTargets('bt709', 0.75).find((t) => t.name === 'red')!
    expect(red601.angleDeg).toBeCloseTo(108.6481, 3)
    expect(red709.angleDeg).toBeCloseTo(102.9062, 3)
    expect(red601.angleDeg - red709.angleDeg).toBeCloseTo(5.7419, 3)
  })

  it('scales linearly with bar amplitude', () => {
    const at75 = vectorTargets('bt709', 0.75)
    const at100 = vectorTargets('bt709', 1)
    for (const t of at75) {
      const full = at100.find((f) => f.name === t.name)!
      expect(t.magnitude / full.magnitude).toBeCloseTo(0.75, 10)
      expect(t.angleDeg).toBeCloseTo(full.angleDeg, 10)
    }
  })
})

describe('level interpretation', () => {
  it('full range is the identity', () => {
    for (const v of [0, 0.5, 1]) expect(receivedToSignal(v, 'full')).toBe(v)
  })

  it('limited range maps 16 to black and 235 to nominal white', () => {
    expect(receivedToSignal(STUDIO_BLACK_8BIT / 255, 'limited')).toBeCloseTo(0, 12)
    expect(receivedToSignal(STUDIO_WHITE_8BIT / 255, 'limited')).toBeCloseTo(1, 12)
  })

  it('keeps sub-black and super-white rather than clamping', () => {
    // A scope that clamps cannot show you the thing you opened it to find.
    expect(receivedToSignal(0, 'limited')).toBeLessThan(0)
    expect(receivedToSignal(1, 'limited')).toBeGreaterThan(1)
  })

  it('reading studio levels as full range costs 8 IRE at white', () => {
    // The concrete cost of getting the range setting wrong: reference white
    // reads 92 IRE and looks like an underexposed camera.
    const whiteAsFull = receivedToSignal(STUDIO_WHITE_8BIT / 255, 'full')
    expect(signalToIre(whiteAsFull)).toBeCloseTo(92.16, 2)
  })

  it('signalToReceived inverts receivedToSignal', () => {
    for (const range of ['full', 'limited'] as const) {
      for (const s of [-0.05, 0, 0.5, 1, 1.05]) {
        expect(receivedToSignal(signalToReceived(s, range), range)).toBeCloseTo(s, 12)
      }
    }
  })
})

describe('falseColourBandFor', () => {
  it('is defined below, across and above the nominal range', () => {
    expect(falseColourBandFor(-20).label).toBe('sub-black')
    expect(falseColourBandFor(0).label).toBe('crushed')
    expect(falseColourBandFor(50).label).toBe('mid')
    expect(falseColourBandFor(100).label).toBe('clip')
    expect(falseColourBandFor(200).label).toBe('clip')
  })

  it('is lower-inclusive at every boundary', () => {
    for (const band of DEFAULT_FALSE_COLOUR_BANDS) {
      if (band.fromIre === -Infinity) continue
      expect(falseColourBandFor(band.fromIre).label).toBe(band.label)
    }
  })

  it('has strictly ascending bounds', () => {
    // falseColourBandFor breaks out of its scan on the first band above the
    // value, so an out-of-order table would silently return the wrong colour.
    const bounds = DEFAULT_FALSE_COLOUR_BANDS.map((b) => b.fromIre)
    for (let i = 1; i < bounds.length; i++) expect(bounds[i]).toBeGreaterThan(bounds[i - 1])
  })
})
