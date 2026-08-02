import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_FALSE_COLOUR_BANDS } from '@shared/colorimetry'
import { calibrationKey } from '@shared/protocol'
import { captureManager } from '../capture/captureManager'
import { drawGraticule } from '../gl/graticule'
import { ScopeRenderer, type RenderRequest } from '../gl/scopeRenderer'
import { resolveSource, type ResolveContext } from '../sources/sourceModel'
import { useStore } from '../state/store'
import TileChrome from './TileChrome'

/**
 * The wall: two stacked canvases under a CSS grid of tile chrome.
 *
 * The GL canvas draws every trace, the 2D canvas every graticule and label, and
 * the DOM on top carries the controls. Keeping the controls in the DOM rather
 * than drawing them means they are focusable, selectable and readable by a
 * screen reader for free, and keeping the traces out of the DOM means the tile
 * count is limited by the GPU rather than by compositing.
 */
function ScopeWall(): React.JSX.Element {
  const wallRef = useRef<HTMLDivElement>(null)
  const glCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<ScopeRenderer | null>(null)
  const tileRefs = useRef(new Map<string, HTMLDivElement>())
  const [glError, setGlError] = useState<string | null>(null)
  const [histogramSupported, setHistogramSupported] = useState(true)

  const workspace = useStore((s) => s.workspace)
  const devices = useStore((s) => s.devices)
  const snapshot = useStore((s) => s.snapshot)
  const calibrations = useStore((s) => s.calibrations)

  const resolveContext = useMemo<ResolveContext>(
    () => ({
      snapshot,
      calibrationFor: (deviceId) => {
        const capture = captureManager.get(deviceId)
        if (!capture || capture.width === 0) return null
        return calibrations[calibrationKey(deviceId, capture.width, capture.height)] ?? null
      },
      deviceLabelFor: (deviceId) => captureManager.get(deviceId)?.label ?? null
    }),
    [snapshot, calibrations]
  )

  // Kept in refs as well as in state: the render loop runs outside React, on
  // requestAnimationFrame, and must not close over a stale context between
  // frames. Synced in an effect rather than during render — the loop only ever
  // reads them after a commit, so there is no window where they are behind.
  const contextRef = useRef(resolveContext)
  const workspaceRef = useRef(workspace)
  useEffect(() => {
    contextRef.current = resolveContext
    workspaceRef.current = workspace
  }, [resolveContext, workspace])

  useLayoutEffect(() => {
    const canvas = glCanvasRef.current
    if (!canvas) return
    try {
      const renderer = new ScopeRenderer(canvas)
      rendererRef.current = renderer
      // Dev-only handle for poking at the GL state from the console. A scope
      // that renders nothing looks identical to a scope with no signal, and
      // this is the difference between the two.
      if (import.meta.env.DEV) {
        ;(window as unknown as { __scopes?: ScopeRenderer }).__scopes = renderer
      }
      // Whether WebGL2 and its float-blend extensions are usable is only
      // knowable once the canvas is mounted. It settles once and never changes.
      setHistogramSupported(renderer.supportsHistogram)
    } catch (err) {
      setGlError(err instanceof Error ? err.message : String(err))
    }
    return () => {
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  const renderFrame = useCallback(() => {
    const renderer = rendererRef.current
    const wall = wallRef.current
    const overlay = overlayRef.current
    if (!renderer || !wall || !overlay) return

    const bounds = wall.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    renderer.beginFrame(bounds.width, bounds.height, dpr)

    if (
      overlay.width !== Math.round(bounds.width * dpr) ||
      overlay.height !== Math.round(bounds.height * dpr)
    ) {
      overlay.width = Math.round(bounds.width * dpr)
      overlay.height = Math.round(bounds.height * dpr)
    }
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, bounds.width, bounds.height)

    // One upload per device per frame however many tiles read it — the reason
    // a wall of scopes off one capture costs about the same as one scope.
    for (const capture of captureManager.getOpen()) {
      if (capture.width > 0) renderer.uploadFrame(capture.deviceId, capture.video)
    }

    for (const tile of workspaceRef.current.tiles) {
      const element = tileRefs.current.get(tile.id)
      if (!tile.source || !element) continue

      const resolved = resolveSource(tile.source, contextRef.current)
      const capture = captureManager.get(tile.source.deviceId)
      if (!capture || capture.width === 0) continue

      const rect = element.getBoundingClientRect()
      const viewport = {
        x: rect.left - bounds.left,
        y: rect.top - bounds.top,
        width: rect.width,
        height: rect.height
      }

      const request: RenderRequest = {
        kind: tile.kind,
        options: tile.options,
        viewport,
        crop: resolved.rect,
        deviceId: tile.source.deviceId,
        falseColourBands: DEFAULT_FALSE_COLOUR_BANDS
      }
      renderer.renderTile(request, workspaceRef.current.interpretation, dpr)

      drawGraticule(
        ctx,
        viewport,
        tile.kind,
        workspaceRef.current.interpretation.matrix,
        tile.options,
        DEFAULT_FALSE_COLOUR_BANDS
      )
    }
  }, [])

  useEffect(() => captureManager.onFrame(renderFrame), [renderFrame])

  // Redraw once on layout changes too, so a resized or re-sourced tile does not
  // hold a stale frame until the next capture tick (there may not be one — a
  // stopped device stops the loop).
  useEffect(() => {
    renderFrame()
  }, [renderFrame, workspace, devices, calibrations, snapshot])

  const gridStyle = {
    gridTemplateColumns: `repeat(${workspace.columns}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${workspace.rows}, minmax(0, 1fr))`
  }

  if (glError) {
    return (
      <div className="wall wall--error">
        <div className="notice notice--error">
          <h2>No WebGL2</h2>
          <p>{glError}</p>
          <p>
            Every scope in this app is drawn on the GPU. Without WebGL2 there is nothing to fall
            back to that would run at video rate.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="wall" ref={wallRef}>
      <canvas className="wall__layer" ref={glCanvasRef} />
      <canvas className="wall__layer wall__layer--overlay" ref={overlayRef} />
      <div className="wall__grid" style={gridStyle}>
        {workspace.tiles.map((tile) => (
          <TileChrome
            key={tile.id}
            tile={tile}
            resolved={tile.source ? resolveSource(tile.source, resolveContext) : null}
            histogramSupported={histogramSupported}
            registerRef={(element) => {
              if (element) tileRefs.current.set(tile.id, element)
              else tileRefs.current.delete(tile.id)
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default ScopeWall
