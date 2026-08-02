import type { PictureOverlay, ScopeKind, ScopeOptions, Tile } from '@shared/protocol'

interface Props {
  tile: Tile
  onKindChange: (kind: ScopeKind) => void
  onChange: (options: ScopeOptions) => void
}

const KIND_LABELS: Record<ScopeKind, string> = {
  picture: 'Picture',
  waveformLuma: 'Waveform (luma)',
  waveformParadeRgb: 'Parade (RGB)',
  waveformParadeYcbcr: 'Parade (Y/Cb/Cr)',
  vectorscope: 'Vectorscope',
  histogram: 'Histogram'
}

const OVERLAYS: { value: PictureOverlay; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'falseColour', label: 'False colour' },
  { value: 'zebra', label: 'Zebras' },
  { value: 'focusPeaking', label: 'Focus peaking' }
]

/** Per-tile controls. Only the ones that mean something for the tile's kind are shown. */
function TileOptions({ tile, onKindChange, onChange }: Props): React.JSX.Element {
  const o = tile.options
  const set = (patch: Partial<ScopeOptions>): void => onChange({ ...o, ...patch })

  const isTrace = tile.kind !== 'picture'
  const isVector = tile.kind === 'vectorscope'
  const isHistogram = tile.kind === 'histogram'

  return (
    <div className="options">
      <label>
        Scope
        <select value={tile.kind} onChange={(e) => onKindChange(e.target.value as ScopeKind)}>
          {(Object.keys(KIND_LABELS) as ScopeKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </label>

      {tile.kind === 'picture' && (
        <>
          <label>
            Overlay
            <select
              value={o.overlay}
              onChange={(e) => set({ overlay: e.target.value as PictureOverlay })}
            >
              {OVERLAYS.map((overlay) => (
                <option key={overlay.value} value={overlay.value}>
                  {overlay.label}
                </option>
              ))}
            </select>
          </label>

          {o.overlay === 'zebra' && (
            <>
              <label>
                Zebra {o.zebraIre} IRE
                <input
                  type="range"
                  min={-10}
                  max={110}
                  step={1}
                  value={o.zebraIre}
                  onChange={(e) => set({ zebraIre: Number(e.target.value) })}
                />
              </label>
              <label className="options__check">
                <input
                  type="checkbox"
                  checked={o.zebraIre2 !== null}
                  onChange={(e) => set({ zebraIre2: e.target.checked ? 100 : null })}
                />
                Second band
              </label>
              {o.zebraIre2 !== null && (
                <label>
                  Band 2 {o.zebraIre2} IRE
                  <input
                    type="range"
                    min={-10}
                    max={110}
                    step={1}
                    value={o.zebraIre2}
                    onChange={(e) => set({ zebraIre2: Number(e.target.value) })}
                  />
                </label>
              )}
            </>
          )}

          {o.overlay === 'focusPeaking' && (
            <label>
              Peaking {o.peakingThreshold.toFixed(2)}
              <input
                type="range"
                min={0.02}
                max={1}
                step={0.01}
                value={o.peakingThreshold}
                onChange={(e) => set({ peakingThreshold: Number(e.target.value) })}
              />
            </label>
          )}
        </>
      )}

      {isTrace && (
        <label>
          {isHistogram ? 'Scale' : 'Intensity'} {o.gain.toFixed(2)}
          <input
            type="range"
            min={0.02}
            max={1}
            step={0.01}
            value={o.gain}
            onChange={(e) => set({ gain: Number(e.target.value) })}
          />
        </label>
      )}

      {isTrace && !isHistogram && (
        <label>
          Trace width {o.traceWidth}px
          <input
            type="range"
            min={1}
            max={6}
            step={1}
            value={o.traceWidth}
            onChange={(e) => set({ traceWidth: Number(e.target.value) })}
          />
        </label>
      )}

      {isVector && (
        <>
          <label>
            Graticule
            <select
              value={o.barAmplitude}
              onChange={(e) => set({ barAmplitude: Number(e.target.value) })}
            >
              <option value={0.75}>75% bars</option>
              <option value={1}>100% bars</option>
            </select>
          </label>
          <label>
            Zoom {o.vectorZoom}x
            <select
              value={o.vectorZoom}
              onChange={(e) => set({ vectorZoom: Number(e.target.value) })}
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={5}>5x</option>
              <option value={10}>10x</option>
            </select>
          </label>
        </>
      )}

      {isHistogram && (
        <fieldset className="options__channels">
          <legend>Channels</legend>
          {(['r', 'g', 'b', 'luma'] as const).map((channel) => (
            <label key={channel} className="options__check">
              <input
                type="checkbox"
                checked={o.histogramChannels[channel]}
                onChange={(e) =>
                  set({
                    histogramChannels: { ...o.histogramChannels, [channel]: e.target.checked }
                  })
                }
              />
              {channel === 'luma' ? 'Y' : channel.toUpperCase()}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}

export default TileOptions
