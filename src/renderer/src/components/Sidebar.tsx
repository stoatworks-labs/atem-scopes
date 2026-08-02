import { useEffect, useState } from 'react'
import { MATRIX_LABELS, type MatrixId, type SignalRange } from '@shared/colorimetry'
import { calibrationKey, type ScopeKind } from '@shared/protocol'
import { captureManager, listVideoInputs, primeDeviceLabels } from '../capture/captureManager'
import {
  startTestPattern,
  TEST_PATTERN_DEVICE_ID,
  TEST_PATTERN_LABEL,
  type TestPatternHandle
} from '../capture/testPattern'
import { useStore } from '../state/store'

const ADDABLE: { kind: ScopeKind; label: string }[] = [
  { kind: 'picture', label: 'Picture' },
  { kind: 'waveformLuma', label: 'Waveform' },
  { kind: 'waveformParadeRgb', label: 'RGB parade' },
  { kind: 'waveformParadeYcbcr', label: 'Y/Cb/Cr parade' },
  { kind: 'vectorscope', label: 'Vectorscope' },
  { kind: 'histogram', label: 'Histogram' }
]

function Sidebar(): React.JSX.Element {
  const capabilities = window.api.capabilities
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  const [labelsPrimed, setLabelsPrimed] = useState(false)
  const [captureTick, setCaptureTick] = useState(0)
  const [testPattern, setTestPattern] = useState<TestPatternHandle | null>(null)

  const devices = useStore((s) => s.devices)
  const addDevice = useStore((s) => s.addDevice)
  const removeDevice = useStore((s) => s.removeDevice)
  const setDeviceRole = useStore((s) => s.setDeviceRole)
  const workspace = useStore((s) => s.workspace)
  const setInterpretation = useStore((s) => s.setInterpretation)
  const addTile = useStore((s) => s.addTile)
  const atemStatus = useStore((s) => s.atemStatus)
  const atemHost = useStore((s) => s.atemHost)
  const setAtemHost = useStore((s) => s.setAtemHost)
  const snapshot = useStore((s) => s.snapshot)
  const setMode = useStore((s) => s.setMode)
  const setCalibrateDevice = useStore((s) => s.setCalibrateDevice)
  const ensureCalibration = useStore((s) => s.ensureCalibration)
  const calibrations = useStore((s) => s.calibrations)

  useEffect(() => captureManager.onState(() => setCaptureTick((n) => n + 1)), [])

  const refresh = async (): Promise<void> => {
    setInputs(await listVideoInputs())
  }

  // enumerateDevices settles in a later task, so setInputs never runs
  // synchronously inside the effect — but the lint rule cannot see that through
  // the await, hence the directive rather than a restructure.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [])

  const open = async (device: MediaDeviceInfo): Promise<void> => {
    const label = device.label || `Camera ${device.deviceId.slice(0, 6)}`
    await captureManager.open(device.deviceId, label)
    addDevice({ deviceId: device.deviceId, label, role: 'multiview', multiViewerIndex: 0 })
  }

  const close = (deviceId: string): void => {
    captureManager.close(deviceId)
    removeDevice(deviceId)
  }

  const calibrate = (deviceId: string): void => {
    const capture = captureManager.get(deviceId)
    const device = devices.find((d) => d.deviceId === deviceId)
    if (!capture || capture.width === 0 || !device) return
    ensureCalibration(deviceId, capture.width, capture.height, device.multiViewerIndex)
    setCalibrateDevice(deviceId)
    setMode('calibrate')
  }

  return (
    <aside className="sidebar">
      <section>
        <h2>Capture</h2>
        {!labelsPrimed && inputs.some((d) => !d.label) && (
          <button
            onClick={async () => {
              await primeDeviceLabels()
              setLabelsPrimed(true)
              refresh()
            }}
          >
            Show device names
          </button>
        )}

        <ul className="devices">
          {inputs.map((input, index) => {
            const entry = devices.find((d) => d.deviceId === input.deviceId)
            const capture = captureManager.get(input.deviceId)
            const error = captureManager.getError(input.deviceId)
            const key = capture
              ? calibrationKey(input.deviceId, capture.width, capture.height)
              : null
            const calibrated = key ? calibrations[key] : undefined

            return (
              // A device with no id yet (labels not primed) still needs a
              // stable key — Math.random() here remounts the row every render
              // and loses focus mid-typing.
              <li key={input.deviceId || `device-${index}`} data-tick={captureTick}>
                <div className="devices__row">
                  <span className="devices__name">
                    {input.label || 'unnamed device'}
                    {capture && capture.width > 0 && (
                      <em>
                        {capture.width}×{capture.height}
                      </em>
                    )}
                  </span>
                  {entry ? (
                    <button onClick={() => close(input.deviceId)}>Close</button>
                  ) : (
                    <button onClick={() => open(input)}>Open</button>
                  )}
                </div>

                {error && <p className="notice notice--error">{error}</p>}

                {entry && (
                  <div className="devices__controls">
                    <select
                      value={entry.role}
                      onChange={(e) =>
                        setDeviceRole(entry.deviceId, e.target.value as 'multiview' | 'fullRaster')
                      }
                    >
                      <option value="multiview">Multiview</option>
                      <option value="fullRaster">Full raster</option>
                    </select>
                    {entry.role === 'multiview' && (
                      <button onClick={() => calibrate(entry.deviceId)}>
                        {calibrated
                          ? calibrated.seeded
                            ? 'Check regions'
                            : 'Regions'
                          : 'Set regions'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
          {inputs.length === 0 && <p className="hint">No video input devices found.</p>}
        </ul>

        <div className="panel__row">
          {devices.some((d) => d.deviceId === TEST_PATTERN_DEVICE_ID) ? (
            <button
              onClick={() => {
                testPattern?.stop()
                setTestPattern(null)
                close(TEST_PATTERN_DEVICE_ID)
              }}
            >
              Stop test pattern
            </button>
          ) : (
            <button
              onClick={async () => {
                const handle = startTestPattern()
                setTestPattern(handle)
                await captureManager.openStream(
                  TEST_PATTERN_DEVICE_ID,
                  TEST_PATTERN_LABEL,
                  handle.stream
                )
                addDevice({
                  deviceId: TEST_PATTERN_DEVICE_ID,
                  label: TEST_PATTERN_LABEL,
                  role: 'multiview',
                  multiViewerIndex: 0
                })
              }}
            >
              Start test pattern
            </button>
          )}
        </div>
        <p className="hint">
          Four quadrants of 75% bars over a ramp, with a label bar burnt in like a real multiview.
          With the vectorscope on 75% bars the trace must sit in the graticule boxes — if it does
          not, the fault is in the scopes, not the signal.
        </p>
      </section>

      {capabilities.atemLink ? (
        <section>
          <h2>Switcher</h2>
          <div className="panel__row">
            <input
              type="text"
              placeholder="192.168.1.240"
              value={atemHost}
              onChange={(e) => setAtemHost(e.target.value)}
            />
            {atemStatus === 'connected' ? (
              <button onClick={() => window.api.atem.disconnect()}>Disconnect</button>
            ) : (
              <button disabled={!atemHost} onClick={() => window.api.atem.connect(atemHost)}>
                Connect
              </button>
            )}
          </div>
          <p className={`status status--${atemStatus}`}>
            {atemStatus}
            {snapshot && ` · ${snapshot.productModel}`}
          </p>
          <p className="hint">
            Read-only. Connecting names the multiview windows and follows a live re-route; no
            command is ever sent to the switcher.
          </p>
        </section>
      ) : (
        <section>
          <h2>Switcher</h2>
          <p className="hint">
            The browser build has no switcher link — the ATEM protocol is UDP and a page cannot open
            a socket. Name each region by hand on the regions screen instead.
          </p>
        </section>
      )}

      <section>
        <h2>Signal</h2>
        <label>
          Matrix
          <select
            value={workspace.interpretation.matrix}
            onChange={(e) =>
              setInterpretation({ ...workspace.interpretation, matrix: e.target.value as MatrixId })
            }
          >
            {(Object.keys(MATRIX_LABELS) as MatrixId[]).map((matrix) => (
              <option key={matrix} value={matrix}>
                {MATRIX_LABELS[matrix]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Levels
          <select
            value={workspace.interpretation.range}
            onChange={(e) =>
              setInterpretation({
                ...workspace.interpretation,
                range: e.target.value as SignalRange
              })
            }
          >
            <option value="full">Full range (0–255)</option>
            <option value="limited">Studio range (16–235)</option>
          </select>
        </label>
        <p className="hint">
          How to read the RGB the capture path handed us — it is not detectable from the pixels.
          Wrong matrix rotates the vectorscope graticule off the trace; wrong levels put reference
          white at 92 IRE.
        </p>
      </section>

      <section>
        <h2>Add scope</h2>
        <div className="chips">
          {ADDABLE.map((item) => (
            <button key={item.kind} onClick={() => addTile(item.kind)}>
              {item.label}
            </button>
          ))}
        </div>
      </section>
    </aside>
  )
}

export default Sidebar
