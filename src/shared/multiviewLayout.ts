/**
 * Seed geometry for the multiview window grid.
 *
 * animATEM starts calibration from an evenly-spaced sqrt grid and notes that
 * the real layout "isn't documented/queryable". That is truer of the box
 * *positions* than of the layout itself: `MultiViewerLayout` is a bitfield, and
 * reading it as one gives the arrangement exactly.
 *
 *     TopLeftSmall     = 1
 *     TopRightSmall    = 2
 *     BottomLeftSmall  = 4
 *     BottomRightSmall = 8
 *
 * and every named value is a combination of those bits:
 *
 *     ProgramBottom = 3  = TL|TR small        -> big pair along the bottom
 *     ProgramRight  = 5  = TL|BL small        -> big pair down the right
 *     ProgramLeft   = 10 = TR|BR small        -> big pair down the left
 *     ProgramTop    = 12 = BL|BR small        -> big pair along the top
 *     Default       = 0  = nothing subdivided -> four big windows
 *
 * So the frame is four quadrants; a quadrant whose bit is set is subdivided
 * into its own 2x2, and one that isn't is a single large window. ProgramTop on
 * a Mini Pro gives 2 large + 8 small = the 10 windows it actually has.
 *
 * ---------------------------------------------------------------------------
 * What is derived and what is assumed
 * ---------------------------------------------------------------------------
 *
 * The *cell rectangles* are derived — that is just what the bits mean.
 *
 * The mapping from cell to `windowIndex` is an **assumption**: quadrants in
 * TL, TR, BL, BR order, and row-major within a subdivided quadrant. Nothing in
 * the protocol states that ordering and no switcher has confirmed it here.
 *
 * It is a cheap assumption to be wrong about, because the calibration screen
 * labels every box with the source the switcher says is in that window, live.
 * A mis-ordered seed shows up immediately as labels in the wrong boxes, and
 * each box's window index can be reassigned from a dropdown without redrawing
 * anything. Treat `seeded: true` as "not yet checked by a human", which is what
 * the UI says too.
 */

import type { CalibratedWindow, Rect } from './protocol'
import { DEFAULT_INSET } from './protocol'

export const LAYOUT_BIT = {
  topLeftSmall: 1,
  topRightSmall: 2,
  bottomLeftSmall: 4,
  bottomRightSmall: 8
} as const

/** Quadrant origins in the order cells are numbered. */
const QUADRANTS: { bit: number; x: number; y: number }[] = [
  { bit: LAYOUT_BIT.topLeftSmall, x: 0, y: 0 },
  { bit: LAYOUT_BIT.topRightSmall, x: 0.5, y: 0 },
  { bit: LAYOUT_BIT.bottomLeftSmall, x: 0, y: 0.5 },
  { bit: LAYOUT_BIT.bottomRightSmall, x: 0.5, y: 0.5 }
]

/**
 * The cell rectangles for a layout, in the assumed window order.
 *
 * A layout of 15 (every quadrant subdivided) gives the 16 equal windows an
 * Extreme shows; 0 gives four.
 */
export function layoutCells(layout: number): Rect[] {
  const cells: Rect[] = []
  for (const quadrant of QUADRANTS) {
    if ((layout & quadrant.bit) === 0) {
      cells.push({ x: quadrant.x, y: quadrant.y, width: 0.5, height: 0.5 })
      continue
    }
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        cells.push({
          x: quadrant.x + col * 0.25,
          y: quadrant.y + row * 0.25,
          width: 0.25,
          height: 0.25
        })
      }
    }
  }
  return cells
}

/** An evenly-spaced fallback for when the layout and the window count disagree. */
export function gridCells(count: number): Rect[] {
  if (count <= 0) return []
  const columns = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / columns)
  const cells: Rect[] = []
  for (let i = 0; i < count; i++) {
    cells.push({
      x: (i % columns) / columns,
      y: Math.floor(i / columns) / rows,
      width: 1 / columns,
      height: 1 / rows
    })
  }
  return cells
}

export interface SeedResult {
  windows: CalibratedWindow[]
  /** How the geometry was arrived at — the UI says which, because they are not equally trustworthy. */
  derivation: 'layout' | 'grid'
}

/**
 * Seeds calibration geometry for `windowIndices`, preferring the layout
 * bitfield and falling back to a plain grid when the cell count doesn't match
 * the number of windows the switcher reported. A mismatch means the layout is
 * doing something this model doesn't cover, and quietly stretching the cells to
 * fit would produce boxes that look deliberate and sit over nothing.
 */
export function seedWindows(layout: number | null, windowIndices: number[]): SeedResult {
  const cells = layout === null ? [] : layoutCells(layout)
  const useLayout = cells.length === windowIndices.length
  const chosen = useLayout ? cells : gridCells(windowIndices.length)
  return {
    derivation: useLayout ? 'layout' : 'grid',
    windows: windowIndices.map((windowIndex, i) => ({
      windowIndex,
      rect: chosen[i],
      inset: { ...DEFAULT_INSET }
    }))
  }
}

/** Applies a window's inset, giving the rect a scope should actually sample. */
export function insetRect(window: CalibratedWindow): Rect {
  const { rect, inset } = window
  const x = rect.x + rect.width * inset.left
  const y = rect.y + rect.height * inset.top
  return {
    x,
    y,
    width: Math.max(0, rect.width * (1 - inset.left - inset.right)),
    height: Math.max(0, rect.height * (1 - inset.top - inset.bottom))
  }
}
