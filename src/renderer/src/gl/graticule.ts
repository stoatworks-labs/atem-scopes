/**
 * Graticules and labels, drawn on a 2D canvas stacked over the GL layer.
 *
 * Text in WebGL costs a glyph atlas and a lot of care to stay legible at
 * arbitrary tile sizes; a 2D context gives it for free and correctly
 * hinted. The traces stay in GL where the throughput matters.
 *
 * Every position here is computed from the same functions the shaders take
 * their uniforms from, so a graticule cannot drift away from the trace it is
 * measuring. In particular the vectorscope targets come from `vectorTargets()`
 * — change the matrix and the boxes move, which is the point.
 */

import {
  vectorTargets,
  VECTOR_FULL_SCALE,
  WAVEFORM_GRATICULE_IRE,
  WAVEFORM_IRE_MAX,
  WAVEFORM_IRE_MIN,
  type FalseColourBand,
  type MatrixId
} from '@shared/colorimetry'
import type { ScopeKind, ScopeOptions } from '@shared/protocol'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

const GRID = 'rgba(120, 140, 150, 0.28)'
const GRID_STRONG = 'rgba(150, 175, 185, 0.5)'
const TEXT = 'rgba(190, 205, 212, 0.85)'
const FONT = '10px ui-monospace, SFMono-Regular, Menlo, monospace'

export function ireToY(ire: number, box: Box): number {
  const t = (ire - WAVEFORM_IRE_MIN) / (WAVEFORM_IRE_MAX - WAVEFORM_IRE_MIN)
  return box.y + box.height * (1 - t)
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath()
  // Half-pixel offset so a 1px line lands on a pixel instead of straddling two
  // and rendering as a 2px smear.
  ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5)
  ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5)
  ctx.stroke()
}

export function drawWaveformGraticule(
  ctx: CanvasRenderingContext2D,
  box: Box,
  kind: 'waveformLuma' | 'waveformParadeRgb' | 'waveformParadeYcbcr'
): void {
  const segments = kind === 'waveformLuma' ? 1 : 3
  ctx.save()
  ctx.font = FONT
  ctx.lineWidth = 1

  for (const ire of WAVEFORM_GRATICULE_IRE) {
    const y = ireToY(ire, box)
    // 0 and 100 are the two that matter — black and nominal white.
    const strong = ire === 0 || ire === 100
    ctx.strokeStyle = strong ? GRID_STRONG : GRID
    line(ctx, box.x, y, box.x + box.width, y)
    if (ire % 20 === 0 || strong) {
      ctx.fillStyle = TEXT
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(ire), box.x + 3, y - 5)
    }
  }

  if (segments > 1) {
    const labels = kind === 'waveformParadeRgb' ? ['R', 'G', 'B'] : ['Y', 'Cb', 'Cr']
    const segWidth = box.width / segments
    ctx.strokeStyle = GRID_STRONG
    for (let i = 1; i < segments; i++) {
      line(ctx, box.x + segWidth * i, box.y, box.x + segWidth * i, box.y + box.height)
    }
    ctx.fillStyle = TEXT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    labels.forEach((label, i) => {
      ctx.fillText(label, box.x + segWidth * (i + 0.5), box.y + 3)
    })

    if (kind === 'waveformParadeYcbcr') {
      // Chroma is plotted about the 50 IRE line, so that line is chroma zero
      // for the Cb and Cr segments and nothing at all for Y. Saying so beats
      // leaving someone to read a colour difference off a luma scale.
      const y = ireToY(50, box)
      ctx.strokeStyle = 'rgba(200, 200, 120, 0.45)'
      ctx.setLineDash([3, 3])
      line(ctx, box.x + segWidth, y, box.x + box.width, y)
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(200, 200, 120, 0.8)'
      ctx.textAlign = 'right'
      ctx.fillText('chroma 0', box.x + box.width - 4, y + 2)
    }
  }
  ctx.restore()
}

export function drawVectorscopeGraticule(
  ctx: CanvasRenderingContext2D,
  box: Box,
  matrix: MatrixId,
  options: ScopeOptions
): void {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  // Matches the shader's aspect handling exactly: the unit circle is inscribed
  // in the shorter dimension.
  const radius = Math.min(box.width, box.height) / 2
  const zoom = options.vectorZoom

  ctx.save()
  ctx.font = FONT
  ctx.lineWidth = 1
  ctx.strokeStyle = GRID

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.stroke()
  for (const fraction of [0.25, 0.5, 0.75]) {
    ctx.beginPath()
    ctx.arc(cx, cy, radius * fraction, 0, Math.PI * 2)
    ctx.stroke()
  }
  line(ctx, cx - radius, cy, cx + radius, cy)
  line(ctx, cx, cy - radius, cx, cy + radius)

  for (const target of vectorTargets(matrix, options.barAmplitude)) {
    const px = cx + (target.cb / VECTOR_FULL_SCALE) * zoom * radius
    // Screen y grows downward; Cr grows up.
    const py = cy - (target.cr / VECTOR_FULL_SCALE) * zoom * radius
    const size = Math.max(4, radius * 0.055)

    ctx.strokeStyle = 'rgba(230, 210, 120, 0.8)'
    ctx.strokeRect(px - size / 2, py - size / 2, size, size)
    ctx.fillStyle = 'rgba(230, 210, 120, 0.9)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(target.name.slice(0, 2).toUpperCase(), px, py - size)
  }

  ctx.fillStyle = TEXT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const amplitude = options.barAmplitude === 1 ? '100%' : '75%'
  ctx.fillText(
    `${amplitude} bars · ${matrix.toUpperCase()}${zoom !== 1 ? ` · ${zoom}x` : ''}`,
    box.x + 4,
    box.y + 4
  )
  ctx.restore()
}

export function drawHistogramGraticule(ctx: CanvasRenderingContext2D, box: Box): void {
  ctx.save()
  ctx.font = FONT
  ctx.lineWidth = 1
  for (const ire of [0, 25, 50, 75, 100]) {
    const x = box.x + box.width * (ire / 100)
    ctx.strokeStyle = ire === 0 || ire === 100 ? GRID_STRONG : GRID
    line(ctx, x, box.y, x, box.y + box.height)
    ctx.fillStyle = TEXT
    ctx.textAlign = ire === 100 ? 'right' : ire === 0 ? 'left' : 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(String(ire), x + (ire === 0 ? 2 : ire === 100 ? -2 : 0), box.y + box.height - 2)
  }
  ctx.fillStyle = 'rgba(190, 205, 212, 0.55)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  // Said plainly, because a histogram's vertical axis invites being read as a
  // count and this one is not.
  ctx.fillText('relative', box.x + 4, box.y + 4)
  ctx.restore()
}

export function drawFalseColourLegend(
  ctx: CanvasRenderingContext2D,
  box: Box,
  bands: FalseColourBand[]
): void {
  const swatch = 9
  const gap = 2
  const height = bands.length * (swatch + gap)
  let y = box.y + box.height - height - 6

  ctx.save()
  ctx.font = FONT
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(box.x + 4, y - 4, 108, height + 8)

  for (const band of bands) {
    const [r, g, b] = band.colour
    ctx.fillStyle = `rgb(${r * 255}, ${g * 255}, ${b * 255})`
    ctx.fillRect(box.x + 8, y, swatch, swatch)
    ctx.fillStyle = TEXT
    const bound = Number.isFinite(band.fromIre) ? `${band.fromIre}` : '<'
    ctx.fillText(`${bound.padStart(3)} ${band.label}`, box.x + 8 + swatch + 4, y + swatch / 2)
    y += swatch + gap
  }
  ctx.restore()
}

/** Dispatches to the right graticule for a tile, or draws nothing for a plain picture. */
export function drawGraticule(
  ctx: CanvasRenderingContext2D,
  box: Box,
  kind: ScopeKind,
  matrix: MatrixId,
  options: ScopeOptions,
  bands: FalseColourBand[]
): void {
  switch (kind) {
    case 'waveformLuma':
    case 'waveformParadeRgb':
    case 'waveformParadeYcbcr':
      drawWaveformGraticule(ctx, box, kind)
      break
    case 'vectorscope':
      drawVectorscopeGraticule(ctx, box, matrix, options)
      break
    case 'histogram':
      drawHistogramGraticule(ctx, box)
      break
    case 'picture':
      if (options.overlay === 'falseColour') drawFalseColourLegend(ctx, box, bands)
      break
  }
}
