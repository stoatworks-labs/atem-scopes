import { EventEmitter } from 'events'
import { Atem, Enums } from 'atem-connection'
import type { AtemState } from 'atem-connection'
import type { AtemSnapshot, ConnectionStatus } from '../../shared/protocol'

/**
 * Read-only link to the switcher.
 *
 * atem-scopes never sends a command. It connects, reads the multiviewer's
 * window assignments and the input names, and disconnects — that is the entire
 * interaction. A scope tool has no business cutting a source, and a monitoring
 * tool that *could* switch is one mis-click away from doing it on air.
 * `atem-connection`'s client is capable of far more; nothing here exposes it.
 */

/** Exported for unit testing — pure, no live connection needed. */
export function buildSnapshot(state: AtemState | undefined): AtemSnapshot | null {
  if (!state) return null

  return {
    productModel: Enums.Model[state.info.model] ?? 'unknown',
    videoMode: state.settings.videoMode,

    // The input table includes the switcher's internal sources — program,
    // preview, clean feeds, media players — because the ATEM sends an InPr for
    // each of them. That is why a multiview window showing Program resolves to
    // the name "Program" without a lookup table of our own.
    inputs: Object.values(state.inputs)
      .filter((input) => !!input)
      .map((input) => ({
        id: input.inputId,
        shortName: input.shortName,
        longName: input.longName,
        internalPortType: input.internalPortType
      })),

    mixEffects: state.video.mixEffects
      .filter((me) => !!me)
      .map((me) => ({
        index: me.index,
        programInput: me.programInput,
        previewInput: me.previewInput
      })),

    multiViewers: state.settings.multiViewers
      .filter((mv) => !!mv)
      .map((mv) => ({
        index: mv.index,
        // The layout is a bitfield saying which quadrants are subdivided; see
        // shared/multiviewLayout.ts, which seeds the calibration geometry from it.
        layout: mv.properties?.layout ?? null,
        programPreviewSwapped: mv.properties?.programPreviewSwapped ?? false,
        windows: mv.windows
          .filter((w) => !!w)
          .map((w) => ({
            windowIndex: w.windowIndex,
            source: w.source,
            // Both of these are burnt into the window by the switcher and land
            // inside any crop taken from it.
            safeTitle: w.safeTitle ?? false,
            audioMeter: w.audioMeter ?? false,
            supportsSafeArea: w.supportsSafeArea,
            supportsVuMeter: w.supportsVuMeter
          }))
      }))
  }
}

class AtemConnection extends EventEmitter {
  private atem: Atem | null = null
  private status: ConnectionStatus = 'disconnected'
  private host: string | null = null

  connect(host: string): void {
    this.teardown()
    this.host = host
    this.setStatus('connecting')

    const atem = new Atem()
    this.atem = atem

    atem.on('connected', () => {
      this.setStatus('connected')
      this.emitSnapshot()
    })
    atem.on('disconnected', () => this.setStatus('disconnected'))
    atem.on('error', (message) => {
      this.setStatus('error')
      this.emit('error', message)
    })
    atem.on('stateChanged', () => this.emitSnapshot())

    atem.connect(host).catch((err: unknown) => {
      this.setStatus('error')
      this.emit('error', err instanceof Error ? err.message : String(err))
    })
  }

  disconnect(): void {
    this.teardown()
    this.setStatus('disconnected')
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  getHost(): string | null {
    return this.host
  }

  getSnapshot(): AtemSnapshot | null {
    return this.atem ? buildSnapshot(this.atem.state) : null
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status
    this.emit('status', status)
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot()
    if (snapshot) this.emit('snapshot', snapshot)
  }

  private teardown(): void {
    if (this.atem) {
      this.atem.disconnect().catch(() => {})
      this.atem.removeAllListeners()
      this.atem = null
    }
  }
}

export const atemConnection = new AtemConnection()
