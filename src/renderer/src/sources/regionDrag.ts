/**
 * Hit testing and dragging for the calibration regions.
 *
 * Pure and normalised (0..1 on both axes) so it can be tested without a canvas,
 * and so the same geometry works whatever size the calibration view happens to
 * be on screen. Everything here clamps to the frame: a region dragged off the
 * edge would sample nothing and read as a black tile.
 */

import type { Rect } from '@shared/protocol'

export type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

export interface Point {
  x: number
  y: number
}

export interface Hit {
  index: number
  handle: Handle
}

export function rectFromCorners(a: Point, b: Point): Rect {
  const left = clamp01(Math.min(a.x, b.x))
  const top = clamp01(Math.min(a.y, b.y))
  const right = clamp01(Math.max(a.x, b.x))
  const bottom = clamp01(Math.max(a.y, b.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

const HANDLE_CORNERS: { handle: Handle; ox: number; oy: number }[] = [
  { handle: 'nw', ox: 0, oy: 0 },
  { handle: 'ne', ox: 1, oy: 0 },
  { handle: 'sw', ox: 0, oy: 1 },
  { handle: 'se', ox: 1, oy: 1 }
]

/**
 * Finds what a press landed on. `tolerance` is in normalised units, so the
 * caller converts from a pixel radius using the current view size — a fixed
 * normalised tolerance would be an unusably small target on a large display and
 * cover the whole region on a small one.
 *
 * Later regions win, so a region drawn on top of another is the one you grab.
 * Corners are tested before bodies for the same reason.
 */
export function hitTest(rects: Rect[], point: Point, tolerance: number): Hit | null {
  for (let index = rects.length - 1; index >= 0; index--) {
    const rect = rects[index]
    for (const corner of HANDLE_CORNERS) {
      const cx = rect.x + rect.width * corner.ox
      const cy = rect.y + rect.height * corner.oy
      if (Math.abs(point.x - cx) <= tolerance && Math.abs(point.y - cy) <= tolerance) {
        return { index, handle: corner.handle }
      }
    }
  }
  for (let index = rects.length - 1; index >= 0; index--) {
    if (contains(rects[index], point)) return { index, handle: 'move' }
  }
  return null
}

/**
 * Applies a drag. `origin` is the rect as it was when the press began and
 * `delta` is the movement since — both taken from the press rather than the
 * previous frame, so rounding cannot accumulate over a long drag.
 */
export function applyDrag(origin: Rect, handle: Handle, delta: Point): Rect {
  if (handle === 'move') {
    return {
      // Clamped so the whole region stays in frame, rather than letting the
      // origin clamp and the far edge run off.
      x: Math.min(1 - origin.width, Math.max(0, origin.x + delta.x)),
      y: Math.min(1 - origin.height, Math.max(0, origin.y + delta.y)),
      width: origin.width,
      height: origin.height
    }
  }

  const left = origin.x
  const top = origin.y
  const right = origin.x + origin.width
  const bottom = origin.y + origin.height

  const west = handle === 'nw' || handle === 'sw'
  const north = handle === 'nw' || handle === 'ne'

  // Dragging a corner past its opposite flips the rect rather than collapsing
  // it, which is what every drawing tool does and what the hand expects.
  return rectFromCorners(
    { x: west ? left + delta.x : left, y: north ? top + delta.y : top },
    { x: west ? right : right + delta.x, y: north ? bottom : bottom + delta.y }
  )
}

/** Regions below this are almost certainly an accidental click rather than a drawn box. */
export const MIN_REGION_SIZE = 0.01

export function isUsableRegion(rect: Rect): boolean {
  return rect.width >= MIN_REGION_SIZE && rect.height >= MIN_REGION_SIZE
}
