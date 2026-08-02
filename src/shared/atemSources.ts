/**
 * Classifying the ATEM source ids that turn up in a multiviewer's window list.
 *
 * The switcher tells us what each source *is* — `internalPortType` comes
 * straight off the wire in the InPr command, and atem-connection surfaces it —
 * so nothing here re-derives that from a hardcoded id table. The one thing the
 * port type does not tell us is *which* M/E an output belongs to and whether it
 * is that M/E's program or preview, and that comes from the id's own structure.
 */

/** atem-connection's InternalPortType values, named here so the renderer needn't import the library. */
export const InternalPortType = {
  External: 0,
  Black: 1,
  ColorBars: 2,
  ColorGenerator: 3,
  MediaPlayerFill: 4,
  MediaPlayerKey: 5,
  SuperSource: 6,
  ExternalDirect: 7,
  MEOutput: 128,
  Auxiliary: 129,
  Mask: 130,
  MultiViewer: 131,
  AudioMonitor: 132
} as const

/**
 * M/E output ids follow `10010 + meIndex * 10`, with `+1` for preview — the
 * same arithmetic atem-fleet-admin relies on when it routes the USB-C output to
 * 10010. Anything that does not fit the pattern returns null rather than being
 * forced into it.
 */
export interface MeOutputRole {
  meIndex: number
  role: 'program' | 'preview'
}

const ME_OUTPUT_BASE = 10010
const ME_OUTPUT_STRIDE = 10

export function meOutputRole(sourceId: number): MeOutputRole | null {
  if (sourceId < ME_OUTPUT_BASE) return null
  const offset = sourceId - ME_OUTPUT_BASE
  const within = offset % ME_OUTPUT_STRIDE
  if (within !== 0 && within !== 1) return null
  return {
    meIndex: Math.floor(offset / ME_OUTPUT_STRIDE),
    role: within === 0 ? 'program' : 'preview'
  }
}

export function isProgramSource(sourceId: number): boolean {
  return meOutputRole(sourceId)?.role === 'program'
}

export function isPreviewSource(sourceId: number): boolean {
  return meOutputRole(sourceId)?.role === 'preview'
}

/**
 * How to group a source in the tile's source picker.
 *
 * Program and preview get their own group rather than being filtered out: on a
 * Mini-family switcher they are the two windows anyone actually wants scopes
 * on, and burying them among the inputs makes the common case the awkward one.
 */
export type SourceGroup = 'programPreview' | 'input' | 'internal' | 'unknown'

export function sourceGroup(sourceId: number, internalPortType: number | undefined): SourceGroup {
  if (internalPortType === InternalPortType.MEOutput || meOutputRole(sourceId))
    return 'programPreview'
  if (
    internalPortType === InternalPortType.External ||
    internalPortType === InternalPortType.ExternalDirect
  ) {
    return 'input'
  }
  if (internalPortType === undefined) return 'unknown'
  return 'internal'
}

export const SOURCE_GROUP_LABELS: Record<SourceGroup, string> = {
  programPreview: 'Program / Preview',
  input: 'Inputs',
  internal: 'Internal',
  unknown: 'Unidentified'
}

/**
 * A display name for a source id, given the switcher's own input table.
 *
 * The ATEM names its internal sources itself ("Program", "Preview", "Clean
 * Feed 1"), so the table is authoritative wherever it has an entry and this
 * only has to cope with an id that is routed but not described — which happens
 * on a switcher whose InPr sweep has not finished when the first snapshot lands.
 */
export function sourceName(
  sourceId: number,
  inputs: ReadonlyArray<{ id: number; shortName: string; longName: string }>,
  prefer: 'short' | 'long' = 'long'
): string {
  const input = inputs.find((i) => i.id === sourceId)
  if (input) {
    const name = prefer === 'short' ? input.shortName : input.longName
    if (name.trim().length > 0) return name
  }
  const role = meOutputRole(sourceId)
  if (role) {
    const label = role.role === 'program' ? 'Program' : 'Preview'
    return role.meIndex === 0 ? label : `ME ${role.meIndex + 1} ${label}`
  }
  return `Source ${sourceId}`
}
