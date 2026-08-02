import { useCallback, useEffect, useMemo, useRef } from 'react'
import { insetRect, seedWindows } from '@shared/multiviewLayout'
import { calibrationKey, DEFAULT_INSET, type CalibratedWindow, type Rect } from '@shared/protocol'
import { sourceName } from '@shared/atemSources'
import { captureManager } from '../capture/captureManager'
import {
  applyDrag,
  hitTest,
  isUsableRegion,
  rectFromCorners,
  type Handle
} from '../sources/regionDrag'
import { useStore } from '../state/store'

/**
 * Draw regions over the capture and say what each one is.
 *
 * With a switcher link this is calibration: the boxes get window indices, and
 * the names come off the wire. Without one it is the whole source model — draw
 * a box round each multiview tile and type what it is. Same screen either way,
 * which is why the hosted build needs nothing extra to be useful.
 *
 * The label under each box is the live source name where there is a link, so a
 * seeded box in the wrong place is obvious at a glance rather than something
 * you discover from a wrong reading later.
 */

interface DragState {
  kind: 'draw' | 'adjust'
  handle: Handle
  index: number
  origin: Rect
  start: { x: number; y: number }
  current: { x: number; y: number }
}

const HANDLE_TOLERANCE_PX = 10

function CalibrationView(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<DragState | null>(null)

  const deviceId = useStore((s) => s.calibrateDeviceId)
  const devices = useStore((s) => s.devices)
  const snapshot = useStore((s) => s.snapshot)
  const calibrations = useStore((s) => s.calibrations)
  const putCalibration = useStore((s) => s.putCalibration)
  const setMode = useStore((s) => s.setMode)

  const device = devices.find((d) => d.deviceId === deviceId) ?? null
  const capture = deviceId ? captureManager.get(deviceId) : undefined
  const key = capture && deviceId ? calibrationKey(deviceId, capture.width, capture.height) : null
  const profile = key ? calibrations[key] : undefined
  // Memoised so the ref-sync and redraw effects below don't see a new array
  // identity on every render and redraw the whole calibration frame each time.
  const windows = useMemo(() => profile?.windows ?? [], [profile])

  // Synced in an effect, not during render: the pointer handlers and the
  // animation-frame draw both read it outside React, always after a commit.
  const windowsRef = useRef(windows)
  useEffect(() => {
    windowsRef.current = windows
  }, [windows])

  const commit = useCallback(
    (next: CalibratedWindow[], seeded = false) => {
      if (!key || !device) return
      putCalibration({ key, multiViewerIndex: device.multiViewerIndex, windows: next, seeded })
    },
    [key, device, putCalibration]
  )

  const liveName = useCallback(
    (windowIndex: number): string | null => {
      const mv = snapshot?.multiViewers.find((m) => m.index === device?.multiViewerIndex)
      const live = mv?.windows.find((w) => w.windowIndex === windowIndex)
      return live ? sourceName(live.source, snapshot?.inputs ?? []) : null
    },
    [snapshot, device]
  )

  // ---- drawing ------------------------------------------------------------

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !capture || capture.width === 0) return
    if (canvas.width !== capture.width) canvas.width = capture.width
    if (canvas.height !== capture.height) canvas.height = capture.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(capture.video, 0, 0, canvas.width, canvas.height)

    const drag = dragRef.current
    const pending = drag?.kind === 'draw' ? rectFromCorners(drag.start, drag.current) : null

    ctx.lineWidth = Math.max(2, canvas.width / 700)
    ctx.font = `${Math.max(13, canvas.width / 90)}px ui-sans-serif, system-ui, sans-serif`
    ctx.textBaseline = 'top'

    windowsRef.current.forEach((window, index) => {
      const rect =
        drag?.kind === 'adjust' && drag.index === index
          ? applyDrag(drag.origin, drag.handle, {
              x: drag.current.x - drag.start.x,
              y: drag.current.y - drag.start.y
            })
          : window.rect

      const px = {
        x: rect.x * canvas.width,
        y: rect.y * canvas.height,
        w: rect.width * canvas.width,
        h: rect.height * canvas.height
      }
      const name = liveName(window.windowIndex) ?? window.name?.trim() ?? ''

      // Green when we can say what is in the box, amber when we cannot — the
      // amber ones are the work still to do.
      ctx.strokeStyle = name ? 'rgba(74, 222, 128, 0.95)' : 'rgba(251, 191, 36, 0.95)'
      ctx.strokeRect(px.x, px.y, px.w, px.h)

      // The inset is what the scopes will actually sample, so it is drawn too —
      // otherwise trimming the label bar is guesswork.
      const inner = insetRect({ ...window, rect })
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = 'rgba(120, 200, 255, 0.7)'
      ctx.strokeRect(
        inner.x * canvas.width,
        inner.y * canvas.height,
        inner.width * canvas.width,
        inner.height * canvas.height
      )
      ctx.setLineDash([])

      const label = `${window.windowIndex + 1}. ${name || 'unnamed'}`
      const metrics = ctx.measureText(label)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)'
      ctx.fillRect(px.x, px.y, metrics.width + 12, 24)
      ctx.fillStyle = name ? '#86efac' : '#fcd34d'
      ctx.fillText(label, px.x + 6, px.y + 4)

      const handle = Math.max(6, canvas.width / 200)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      for (const [hx, hy] of [
        [px.x, px.y],
        [px.x + px.w, px.y],
        [px.x, px.y + px.h],
        [px.x + px.w, px.y + px.h]
      ]) {
        ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle)
      }
    })

    if (pending) {
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.95)'
      ctx.setLineDash([8, 4])
      ctx.strokeRect(
        pending.x * canvas.width,
        pending.y * canvas.height,
        pending.width * canvas.width,
        pending.height * canvas.height
      )
      ctx.setLineDash([])
    }
  }, [capture, liveName])

  useEffect(() => captureManager.onFrame(draw), [draw])
  useEffect(() => {
    draw()
  }, [draw, windows])

  // ---- pointer ------------------------------------------------------------

  const toNormalised = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const bounds = e.currentTarget.getBoundingClientRect()
    return {
      x: (e.clientX - bounds.left) / bounds.width,
      y: (e.clientY - bounds.top) / bounds.height
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = toNormalised(e)
    const bounds = e.currentTarget.getBoundingClientRect()
    // A fixed pixel grab radius converted to normalised units, so handles are
    // the same physical size however large the view is.
    const tolerance = HANDLE_TOLERANCE_PX / Math.max(bounds.width, bounds.height)
    const hit = hitTest(
      windowsRef.current.map((w) => w.rect),
      point,
      tolerance
    )

    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = hit
      ? {
          kind: 'adjust',
          handle: hit.handle,
          index: hit.index,
          origin: windowsRef.current[hit.index].rect,
          start: point,
          current: point
        }
      : {
          kind: 'draw',
          handle: 'se',
          index: -1,
          origin: { x: 0, y: 0, width: 0, height: 0 },
          start: point,
          current: point
        }
    draw()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!dragRef.current) return
    dragRef.current.current = toNormalised(e)
    draw()
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    e.currentTarget.releasePointerCapture(e.pointerId)

    if (drag.kind === 'draw') {
      const rect = rectFromCorners(drag.start, drag.current)
      if (!isUsableRegion(rect)) return
      const used = new Set(windowsRef.current.map((w) => w.windowIndex))
      let windowIndex = 0
      while (used.has(windowIndex)) windowIndex++
      commit([...windowsRef.current, { windowIndex, rect, inset: { ...DEFAULT_INSET } }])
    } else {
      const delta = { x: drag.current.x - drag.start.x, y: drag.current.y - drag.start.y }
      const rect = applyDrag(drag.origin, drag.handle, delta)
      commit(windowsRef.current.map((w, i) => (i === drag.index ? { ...w, rect } : w)))
    }
  }

  // ---- controls -----------------------------------------------------------

  const patchWindow = (index: number, patch: Partial<CalibratedWindow>): void => {
    commit(windows.map((w, i) => (i === index ? { ...w, ...patch } : w)))
  }

  const seedFromSwitcher = (): void => {
    const mv = snapshot?.multiViewers.find((m) => m.index === device?.multiViewerIndex)
    if (!mv) return
    const { windows: seeded } = seedWindows(
      mv.layout,
      mv.windows.map((w) => w.windowIndex)
    )
    commit(seeded, true)
  }

  if (!device || !capture || capture.width === 0) {
    return (
      <div className="calibrate">
        <div className="notice">
          <h2>No capture to calibrate</h2>
          <p>Open a capture device and set its role to multiview first.</p>
          <button onClick={() => setMode('wall')}>Back to the wall</button>
        </div>
      </div>
    )
  }

  const mv = snapshot?.multiViewers.find((m) => m.index === device.multiViewerIndex)

  return (
    <div className="calibrate">
      <div className="calibrate__stage">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      <aside className="calibrate__panel">
        <header>
          <h2>Regions</h2>
          <button onClick={() => setMode('wall')}>Done</button>
        </header>

        <p className="hint">
          Drag on the picture to draw a region. Drag a corner to resize, the middle to move. The
          dashed inner box is what the scopes sample — widen the inset to keep a burnt-in label or
          audio meter out of the trace.
        </p>

        {mv ? (
          <div className="panel__row">
            <button onClick={seedFromSwitcher}>Seed from switcher layout</button>
            <span className="hint">
              {mv.windows.length} windows, layout {mv.layout ?? '?'}
            </span>
          </div>
        ) : (
          <p className="hint">
            No switcher link, so regions are named by hand. Type what each one is; the scope tiles
            use those names.
          </p>
        )}

        {profile?.seeded && (
          <p className="notice notice--warn">
            This geometry is generated, not checked. Nudge each box onto its window — any edit
            clears the warning.
          </p>
        )}

        <ol className="regions">
          {windows.map((window, index) => (
            <li key={index}>
              <span className="regions__index">{window.windowIndex + 1}</span>
              <input
                type="text"
                value={window.name ?? ''}
                placeholder={liveName(window.windowIndex) ?? 'name this region'}
                disabled={liveName(window.windowIndex) !== null}
                onChange={(e) => patchWindow(index, { name: e.target.value })}
              />
              <input
                type="number"
                className="regions__window"
                min={1}
                value={window.windowIndex + 1}
                title="Multiview window number"
                onChange={(e) =>
                  patchWindow(index, { windowIndex: Math.max(0, Number(e.target.value) - 1) })
                }
              />
              <button
                title="Remove region"
                onClick={() => commit(windows.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </li>
          ))}
        </ol>

        {windows.length > 0 && (
          <label className="panel__inset">
            Bottom inset {(windows[0].inset.bottom * 100).toFixed(0)}%
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.005}
              value={windows[0].inset.bottom}
              onChange={(e) =>
                commit(
                  windows.map((w) => ({
                    ...w,
                    inset: { ...w.inset, bottom: Number(e.target.value) }
                  }))
                )
              }
            />
            <span className="hint">
              Applies to every region — the label bar is the same height on all of them.
            </span>
          </label>
        )}
      </aside>
    </div>
  )
}

export default CalibrationView
