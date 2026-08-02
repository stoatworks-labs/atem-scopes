import { describe, expect, it } from 'vitest'
import { gridCells, insetRect, layoutCells, LAYOUT_BIT, seedWindows } from './multiviewLayout'
import type { Rect } from './protocol'

const PROGRAM_TOP = 12
const PROGRAM_BOTTOM = 3
const PROGRAM_LEFT = 10
const PROGRAM_RIGHT = 5
const DEFAULT_LAYOUT = 0
const ALL_SMALL = 15

function area(r: Rect): number {
  return r.width * r.height
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

describe('layoutCells', () => {
  it('reads the named layouts as the bitfield they are', () => {
    expect(PROGRAM_BOTTOM).toBe(LAYOUT_BIT.topLeftSmall | LAYOUT_BIT.topRightSmall)
    expect(PROGRAM_RIGHT).toBe(LAYOUT_BIT.topLeftSmall | LAYOUT_BIT.bottomLeftSmall)
    expect(PROGRAM_LEFT).toBe(LAYOUT_BIT.topRightSmall | LAYOUT_BIT.bottomRightSmall)
    expect(PROGRAM_TOP).toBe(LAYOUT_BIT.bottomLeftSmall | LAYOUT_BIT.bottomRightSmall)
  })

  it('gives a Mini Pro 10 windows: two large plus eight small', () => {
    const cells = layoutCells(PROGRAM_TOP)
    expect(cells).toHaveLength(10)
    expect(cells.filter((c) => c.width === 0.5)).toHaveLength(2)
    expect(cells.filter((c) => c.width === 0.25)).toHaveLength(8)
  })

  it('puts the large pair where the layout name says', () => {
    const large = (layout: number): Rect[] => layoutCells(layout).filter((c) => c.width === 0.5)

    expect(large(PROGRAM_TOP).every((c) => c.y === 0)).toBe(true)
    expect(large(PROGRAM_BOTTOM).every((c) => c.y === 0.5)).toBe(true)
    expect(large(PROGRAM_LEFT).every((c) => c.x === 0)).toBe(true)
    expect(large(PROGRAM_RIGHT).every((c) => c.x === 0.5)).toBe(true)
  })

  it('gives four windows for Default and sixteen when every quadrant is subdivided', () => {
    expect(layoutCells(DEFAULT_LAYOUT)).toHaveLength(4)
    expect(layoutCells(ALL_SMALL)).toHaveLength(16)
    expect(layoutCells(ALL_SMALL).every((c) => c.width === 0.25)).toBe(true)
  })

  it.each([DEFAULT_LAYOUT, PROGRAM_TOP, PROGRAM_BOTTOM, PROGRAM_LEFT, PROGRAM_RIGHT, ALL_SMALL])(
    'layout %i tiles the frame exactly, with no gaps or overlaps',
    (layout) => {
      const cells = layoutCells(layout)
      expect(cells.reduce((sum, c) => sum + area(c), 0)).toBeCloseTo(1, 12)
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          expect(overlaps(cells[i], cells[j])).toBe(false)
        }
      }
      for (const c of cells) {
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.y).toBeGreaterThanOrEqual(0)
        expect(c.x + c.width).toBeLessThanOrEqual(1)
        expect(c.y + c.height).toBeLessThanOrEqual(1)
      }
    }
  )
})

describe('seedWindows', () => {
  it('uses the layout when the cell count matches the reported windows', () => {
    const result = seedWindows(PROGRAM_TOP, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(result.derivation).toBe('layout')
    expect(result.windows).toHaveLength(10)
    expect(result.windows.map((w) => w.windowIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('falls back to a grid rather than stretching cells to fit', () => {
    // A layout this model does not cover should look obviously provisional,
    // not produce confident boxes sitting over nothing.
    const result = seedWindows(PROGRAM_TOP, [0, 1, 2, 3, 4, 5, 6])
    expect(result.derivation).toBe('grid')
    expect(result.windows).toHaveLength(7)
  })

  it('falls back to a grid when there is no switcher link to ask', () => {
    expect(seedWindows(null, [0, 1, 2, 3]).derivation).toBe('grid')
  })

  it('preserves non-contiguous window indices', () => {
    const result = seedWindows(null, [2, 5, 9])
    expect(result.windows.map((w) => w.windowIndex)).toEqual([2, 5, 9])
  })
})

describe('gridCells', () => {
  it('covers every window without overlapping', () => {
    for (const count of [1, 4, 7, 10, 16]) {
      const cells = gridCells(count)
      expect(cells).toHaveLength(count)
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          expect(overlaps(cells[i], cells[j])).toBe(false)
        }
      }
    }
  })

  it('is empty for a count of zero', () => {
    expect(gridCells(0)).toEqual([])
  })
})

describe('insetRect', () => {
  it('trims the burnt-in label bar off the bottom of the sampled area', () => {
    const inset = insetRect({
      windowIndex: 0,
      rect: { x: 0, y: 0, width: 0.5, height: 0.5 },
      inset: { top: 0, right: 0, bottom: 0.1, left: 0 }
    })
    expect(inset.y).toBe(0)
    expect(inset.height).toBeCloseTo(0.45, 12)
  })

  it('stays inside the window on every edge', () => {
    const window = {
      windowIndex: 0,
      rect: { x: 0.25, y: 0.5, width: 0.25, height: 0.25 },
      inset: { top: 0.05, right: 0.02, bottom: 0.09, left: 0.02 }
    }
    const r = insetRect(window)
    expect(r.x).toBeGreaterThanOrEqual(window.rect.x)
    expect(r.y).toBeGreaterThanOrEqual(window.rect.y)
    expect(r.x + r.width).toBeLessThanOrEqual(window.rect.x + window.rect.width + 1e-12)
    expect(r.y + r.height).toBeLessThanOrEqual(window.rect.y + window.rect.height + 1e-12)
  })

  it('clamps to zero rather than going negative on an over-wide inset', () => {
    const r = insetRect({
      windowIndex: 0,
      rect: { x: 0, y: 0, width: 0.5, height: 0.5 },
      inset: { top: 0.6, right: 0.6, bottom: 0.6, left: 0.6 }
    })
    expect(r.width).toBe(0)
    expect(r.height).toBe(0)
  })
})
