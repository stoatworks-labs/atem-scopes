import { describe, expect, it } from 'vitest'
import type { Rect } from '@shared/protocol'
import { applyDrag, hitTest, isUsableRegion, rectFromCorners } from './regionDrag'

const A: Rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }
const B: Rect = { x: 0.2, y: 0.2, width: 0.2, height: 0.2 } // overlaps A

describe('rectFromCorners', () => {
  it('normalises a drag in any direction to a positive-size rect', () => {
    const forward = rectFromCorners({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.6 })
    const backward = rectFromCorners({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.2 })
    expect(forward).toEqual(backward)
    expect(forward.x).toBeCloseTo(0.2, 12)
    expect(forward.y).toBeCloseTo(0.2, 12)
    expect(forward.width).toBeCloseTo(0.3, 12)
    expect(forward.height).toBeCloseTo(0.4, 12)
  })

  it('clamps to the frame', () => {
    const r = rectFromCorners({ x: -0.5, y: -0.5 }, { x: 1.5, y: 1.5 })
    expect(r).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})

describe('hitTest', () => {
  it('finds a corner before the body it belongs to', () => {
    expect(hitTest([A], { x: 0.1, y: 0.1 }, 0.02)).toEqual({ index: 0, handle: 'nw' })
    expect(hitTest([A], { x: 0.3, y: 0.3 }, 0.02)).toEqual({ index: 0, handle: 'se' })
    expect(hitTest([A], { x: 0.2, y: 0.2 }, 0.02)).toEqual({ index: 0, handle: 'move' })
  })

  it('grabs the topmost region where they overlap', () => {
    // B is drawn after A, so a press in the shared area takes B.
    expect(hitTest([A, B], { x: 0.25, y: 0.25 }, 0.02)).toEqual({ index: 1, handle: 'move' })
  })

  it('prefers any corner over any body', () => {
    // A's south-east corner sits inside B. Resizing A must still win, or a
    // region can become impossible to resize once another overlaps it.
    expect(hitTest([A, B], { x: 0.3, y: 0.3 }, 0.02)).toEqual({ index: 0, handle: 'se' })
  })

  it('misses cleanly outside every region', () => {
    expect(hitTest([A, B], { x: 0.8, y: 0.8 }, 0.02)).toBeNull()
  })

  it('respects the tolerance it is given', () => {
    const justOutside = { x: 0.1 - 0.03, y: 0.1 }
    expect(hitTest([A], justOutside, 0.02)).toBeNull()
    expect(hitTest([A], justOutside, 0.05)).toEqual({ index: 0, handle: 'nw' })
  })
})

describe('applyDrag', () => {
  it('moves without resizing', () => {
    const moved = applyDrag(A, 'move', { x: 0.1, y: -0.05 })
    expect(moved.x).toBeCloseTo(0.2, 12)
    expect(moved.y).toBeCloseTo(0.05, 12)
    expect(moved.width).toBe(A.width)
    expect(moved.height).toBe(A.height)
  })

  it('keeps a moved region wholly in frame', () => {
    const moved = applyDrag(A, 'move', { x: 5, y: 5 })
    expect(moved.x + moved.width).toBeCloseTo(1, 12)
    expect(moved.y + moved.height).toBeCloseTo(1, 12)
    expect(moved.width).toBe(A.width)
    expect(moved.height).toBe(A.height)
  })

  it('resizes from the corner that was grabbed, leaving the opposite one fixed', () => {
    const resized = applyDrag(A, 'se', { x: 0.1, y: 0.1 })
    expect(resized.x).toBeCloseTo(A.x, 12)
    expect(resized.y).toBeCloseTo(A.y, 12)
    expect(resized.width).toBeCloseTo(0.3, 12)
    expect(resized.height).toBeCloseTo(0.3, 12)

    const fromNw = applyDrag(A, 'nw', { x: 0.05, y: 0.05 })
    expect(fromNw.x + fromNw.width).toBeCloseTo(A.x + A.width, 12)
    expect(fromNw.width).toBeCloseTo(0.15, 12)
  })

  it('flips rather than collapsing when a corner is dragged past its opposite', () => {
    const flipped = applyDrag(A, 'se', { x: -0.3, y: -0.3 })
    expect(flipped.width).toBeGreaterThan(0)
    expect(flipped.height).toBeGreaterThan(0)
    expect(flipped.x + flipped.width).toBeCloseTo(A.x, 12)
  })

  it('does not accumulate drift over a long drag', () => {
    // Deltas are always measured from the press, so applying one big move and
    // a hundred small ones that sum to it land in exactly the same place.
    const once = applyDrag(A, 'move', { x: 0.3, y: 0.2 })
    let step = A
    for (let i = 1; i <= 100; i++) step = applyDrag(A, 'move', { x: 0.003 * i, y: 0.002 * i })
    expect(step.x).toBeCloseTo(once.x, 12)
    expect(step.y).toBeCloseTo(once.y, 12)
  })
})

describe('isUsableRegion', () => {
  it('rejects a stray click but accepts a drawn box', () => {
    expect(isUsableRegion({ x: 0.5, y: 0.5, width: 0, height: 0 })).toBe(false)
    expect(isUsableRegion({ x: 0.5, y: 0.5, width: 0.2, height: 0.001 })).toBe(false)
    expect(isUsableRegion({ x: 0.5, y: 0.5, width: 0.2, height: 0.15 })).toBe(true)
  })
})
