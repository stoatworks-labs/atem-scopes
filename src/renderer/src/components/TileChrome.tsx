import { useState } from 'react'
import type { ResolvedSource, ScopeKind, Tile } from '@shared/protocol'
import { captureManager } from '../capture/captureManager'
import { availableSources, sameSource } from '../sources/sourceModel'
import { useStore } from '../state/store'
import TileOptions from './TileOptions'

/** Short badge shown on the tile header, where there is room for a word at most. */
const KIND_TAGS: Record<ScopeKind, string> = {
  picture: 'PIC',
  waveformLuma: 'WFM',
  waveformParadeRgb: 'RGB',
  waveformParadeYcbcr: 'YCC',
  vectorscope: 'VEC',
  histogram: 'HIST'
}

const KIND_LABELS: Record<ScopeKind, string> = {
  picture: 'Picture',
  waveformLuma: 'Waveform (luma)',
  waveformParadeRgb: 'Parade (RGB)',
  waveformParadeYcbcr: 'Parade (Y/Cb/Cr)',
  vectorscope: 'Vectorscope',
  histogram: 'Histogram'
}

interface Props {
  tile: Tile
  resolved: ResolvedSource | null
  histogramSupported: boolean
  registerRef: (element: HTMLDivElement | null) => void
}

/**
 * The DOM half of a tile: everything except the trace itself, which the GL
 * layer draws into exactly this element's bounds.
 *
 * The two warnings it can show are the ones that make a reading wrong while
 * looking right, so neither is buried in a tooltip.
 */
function TileChrome({ tile, resolved, histogramSupported, registerRef }: Props): React.JSX.Element {
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const devices = useStore((s) => s.devices)
  const snapshot = useStore((s) => s.snapshot)
  const calibrations = useStore((s) => s.calibrations)
  const setTileSource = useStore((s) => s.setTileSource)
  const updateTile = useStore((s) => s.updateTile)
  const removeTile = useStore((s) => s.removeTile)

  const groups = availableSources(devices, {
    snapshot,
    calibrationFor: (deviceId) => {
      const capture = captureManager.get(deviceId)
      if (!capture || capture.width === 0) return null
      return calibrations[`${deviceId}@${capture.width}x${capture.height}`] ?? null
    },
    deviceLabelFor: (deviceId) => captureManager.get(deviceId)?.label ?? null
  })

  const unavailable = tile.kind === 'histogram' && !histogramSupported

  return (
    <div
      className="tile"
      style={{
        gridColumn: `${tile.grid.col + 1} / span ${tile.grid.colSpan}`,
        gridRow: `${tile.grid.row + 1} / span ${tile.grid.rowSpan}`
      }}
    >
      <header className="tile__head">
        <button
          className="tile__source"
          title={`${KIND_LABELS[tile.kind]} — click to change source`}
          onClick={() => setPickerOpen((v) => !v)}
        >
          <span className="tile__kindTag">{KIND_TAGS[tile.kind]}</span>
          <span className="tile__sourceName">{resolved ? resolved.label : 'no source'}</span>
        </button>

        <div className="tile__actions">
          <button title="Options" onClick={() => setOptionsOpen((v) => !v)}>
            ⚙
          </button>
          <button title="Remove tile" onClick={() => removeTile(tile.id)}>
            ✕
          </button>
        </div>
      </header>

      {pickerOpen && (
        <div className="picker">
          <button
            className={`picker__option${tile.source === null ? ' is-current' : ''}`}
            onClick={() => {
              setTileSource(tile.id, null)
              setPickerOpen(false)
            }}
          >
            <span className="picker__label">No source</span>
          </button>
          {groups.length === 0 && (
            <p className="picker__empty">
              No capture device is open. Open one from the sidebar first.
            </p>
          )}
          {groups.map((group) => (
            <section key={group.group}>
              <h4>{group.label}</h4>
              {group.options.map((option) => (
                <button
                  key={`${option.ref.kind}:${option.ref.deviceId}:${option.detail}`}
                  className={`picker__option${sameSource(option.ref, tile.source) ? ' is-current' : ''}`}
                  onClick={() => {
                    setTileSource(tile.id, option.ref)
                    setPickerOpen(false)
                  }}
                >
                  <span className="picker__label">{option.label}</span>
                  <span className="picker__detail">
                    {option.detail}
                    {option.hasOverlay && ' · overlay'}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}

      {optionsOpen && (
        <TileOptions
          tile={tile}
          onKindChange={(kind) => updateTile(tile.id, { kind })}
          onChange={(options) => updateTile(tile.id, { options })}
        />
      )}

      <div className="tile__body" ref={registerRef}>
        {unavailable && (
          <p className="tile__warn tile__warn--hard">
            This browser has no float render target (EXT_color_buffer_float), which the histogram
            needs to accumulate bins into. The other scopes are unaffected.
          </p>
        )}
        {!tile.source && !unavailable && <p className="tile__hint">Pick a source</p>}
      </div>

      <footer className="tile__foot">
        {resolved && !resolved.trustworthy && (
          <span
            className="badge badge--warn"
            title="Window geometry has not been checked against the capture"
          >
            uncalibrated
          </span>
        )}
        {resolved?.hasOverlay && (
          <span
            className="badge badge--warn"
            title="The switcher is drawing a safe-area box or audio meter into this window. It is inside the crop and will appear in the trace — trim it with the window inset on the calibration screen."
          >
            overlay in crop
          </span>
        )}
      </footer>
    </div>
  )
}

export default TileChrome
