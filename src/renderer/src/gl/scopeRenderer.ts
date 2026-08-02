/**
 * One WebGL2 context for the whole workspace.
 *
 * Every tile is a viewport on a single canvas rather than a canvas of its own.
 * Browsers cap the number of live WebGL contexts (commonly around 16) and drop
 * the oldest when you exceed it, so a per-tile context turns "add a ninth
 * scope" into "the first scope goes black" — a failure that looks like a bug in
 * the capture path. One context also means one texture upload per device per
 * frame, shared by every tile reading it, which is the whole reason a wall of
 * scopes is affordable at all.
 *
 * Graticules and labels are *not* drawn here — they go on a 2D canvas stacked
 * over this one (see graticule.ts), because legible text in GL costs more than
 * it is worth.
 */

import {
  coefficients,
  receivedToSignal,
  VECTOR_FULL_SCALE,
  WAVEFORM_IRE_MAX,
  WAVEFORM_IRE_MIN,
  type FalseColourBand,
  type SignalInterpretation
} from '@shared/colorimetry'
import type { Rect, ScopeKind, ScopeOptions } from '@shared/protocol'
import { createEmptyVao, createQuad, linkProgram, UniformCache } from './glUtils'
import {
  HISTOGRAM_ACCUM_FRAG,
  HISTOGRAM_ACCUM_VERT,
  HISTOGRAM_DRAW_FRAG,
  HISTOGRAM_DRAW_VERT,
  MAX_FALSE_COLOUR_BANDS,
  PICTURE_FRAG,
  PICTURE_VERT,
  TRACE_FRAG,
  VECTORSCOPE_VERT,
  WAVEFORM_VERT
} from './shaders'

/** Viewport in CSS pixels, relative to the canvas's top-left. */
export interface TileViewport {
  x: number
  y: number
  width: number
  height: number
}

export interface RenderRequest {
  kind: ScopeKind
  options: ScopeOptions
  viewport: TileViewport
  /** Crop within the source texture, normalised, top-left origin. */
  crop: Rect
  deviceId: string
  falseColourBands: FalseColourBand[]
}

interface DeviceTexture {
  texture: WebGLTexture
  width: number
  height: number
  /** Frame counter at last upload, so a device feeding several tiles uploads once. */
  uploadedAt: number
}

const HISTOGRAM_BINS = 256

/** Samples taken per tile per frame. Enough to be dense, small enough to stay cheap with many tiles. */
const MAX_SAMPLE_COLUMNS = 512
const MAX_SAMPLE_ROWS = 288

export class ScopeRenderer {
  readonly gl: WebGL2RenderingContext
  /** False when EXT_color_buffer_float is missing — the histogram needs a float target to accumulate into. */
  readonly supportsHistogram: boolean

  private programs: Record<string, WebGLProgram> = {}
  private uniforms: Record<string, UniformCache> = {}
  private quadVao: WebGLVertexArrayObject
  private emptyVao: WebGLVertexArrayObject
  private textures = new Map<string, DeviceTexture>()
  private nearestSampler: WebGLSampler
  private linearSampler: WebGLSampler
  private histogramTexture: WebGLTexture | null = null
  private histogramFbo: WebGLFramebuffer | null = null
  private frameCounter = 0
  /** Trace point size in device pixels, set from the frame's devicePixelRatio. */
  private pointSize = 1

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      // The scopes are the output; keeping the buffer lets a tile be read back
      // for a screenshot without re-rendering it.
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    })
    if (!gl) throw new Error('WebGL2 is not available in this browser.')
    this.gl = gl

    // Both extensions, and both for a reason. EXT_color_buffer_float makes a
    // float target renderable; EXT_float_blend makes it *blendable*, which the
    // histogram's accumulate pass depends on entirely.
    //
    // 32-bit and not 16: half-float carries about 11 bits of mantissa, so
    // adding 1.0 to a bin already holding 4096 rounds straight back to 4096.
    // The count silently stops rising, and the tallest bins — the clipped
    // whites and crushed blacks anyone opens a histogram to find — are exactly
    // the ones that stall first.
    const colourBufferFloat = gl.getExtension('EXT_color_buffer_float') !== null
    const floatBlend = gl.getExtension('EXT_float_blend') !== null
    this.supportsHistogram = colourBufferFloat && floatBlend

    this.programs.waveform = linkProgram(gl, WAVEFORM_VERT, TRACE_FRAG)
    this.programs.vectorscope = linkProgram(gl, VECTORSCOPE_VERT, TRACE_FRAG)
    this.programs.picture = linkProgram(gl, PICTURE_VERT, PICTURE_FRAG)
    if (this.supportsHistogram) {
      this.programs.histogramAccum = linkProgram(gl, HISTOGRAM_ACCUM_VERT, HISTOGRAM_ACCUM_FRAG)
      this.programs.histogramDraw = linkProgram(gl, HISTOGRAM_DRAW_VERT, HISTOGRAM_DRAW_FRAG)
    }
    for (const [name, program] of Object.entries(this.programs)) {
      this.uniforms[name] = new UniformCache(gl, program)
    }

    this.quadVao = createQuad(gl)
    this.emptyVao = createEmptyVao(gl)

    // Two samplers, and the difference is a measurement decision rather than a
    // cosmetic one: scope passes must read the pixels that are actually there,
    // so they use NEAREST. A linear filter would blend neighbours and quietly
    // pull every reading toward the local mean — clipped whites stop reading as
    // clipped. Only the picture pass, which nothing is measured from, filters.
    this.nearestSampler = this.makeSampler(gl.NEAREST)
    this.linearSampler = this.makeSampler(gl.LINEAR)

    if (this.supportsHistogram) this.initHistogramTarget()
  }

  private makeSampler(filter: number): WebGLSampler {
    const gl = this.gl
    const sampler = gl.createSampler()
    if (!sampler) throw new Error('createSampler returned null')
    gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, filter)
    gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, filter)
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return sampler
  }

  private initHistogramTarget(): void {
    const gl = this.gl
    this.histogramTexture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.histogramTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, HISTOGRAM_BINS, 1, 0, gl.RGBA, gl.FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.histogramFbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.histogramFbo)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.histogramTexture,
      0
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** Call once per animation frame, before any renderTile calls. */
  beginFrame(cssWidth: number, cssHeight: number, dpr: number): void {
    const gl = this.gl
    const canvas = gl.canvas as HTMLCanvasElement
    const width = Math.max(1, Math.round(cssWidth * dpr))
    const height = Math.max(1, Math.round(cssHeight * dpr))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    this.frameCounter++
    // Points are sized in device pixels, so without this the trace is drawn a
    // quarter of the intended size on a HiDPI display.
    this.pointSize = Math.max(1, Math.round(dpr))
    gl.disable(gl.SCISSOR_TEST)
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /**
   * Uploads a device's current frame. Safe to call repeatedly for the same
   * device within a frame — only the first upload of each frame does work.
   */
  uploadFrame(deviceId: string, source: HTMLVideoElement | HTMLCanvasElement): void {
    const gl = this.gl
    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height
    if (width === 0 || height === 0) return

    let entry = this.textures.get(deviceId)
    if (!entry) {
      const texture = gl.createTexture()
      if (!texture) throw new Error('createTexture returned null')
      entry = { texture, width: 0, height: 0, uploadedAt: -1 }
      this.textures.set(deviceId, entry)
    }
    if (entry.uploadedAt === this.frameCounter) return

    gl.bindTexture(gl.TEXTURE_2D, entry.texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    // NONE, not BROWSER_DEFAULT_WEBGL. The browser's default is entitled to
    // colour-manage the video on its way into the texture, which would adjust
    // the exact values every scope in this app exists to report.
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
    entry.width = width
    entry.height = height
    entry.uploadedAt = this.frameCounter
  }

  hasFrame(deviceId: string): boolean {
    const entry = this.textures.get(deviceId)
    return entry !== undefined && entry.width > 0
  }

  releaseDevice(deviceId: string): void {
    const entry = this.textures.get(deviceId)
    if (!entry) return
    this.gl.deleteTexture(entry.texture)
    this.textures.delete(deviceId)
  }

  renderTile(request: RenderRequest, interpretation: SignalInterpretation, dpr: number): void {
    const entry = this.textures.get(request.deviceId)
    if (!entry || entry.width === 0) return

    const gl = this.gl
    const canvasHeight = (gl.canvas as HTMLCanvasElement).height
    const x = Math.round(request.viewport.x * dpr)
    const w = Math.max(1, Math.round(request.viewport.width * dpr))
    const h = Math.max(1, Math.round(request.viewport.height * dpr))
    // GL's origin is bottom-left; the layout's is top-left.
    const y = canvasHeight - Math.round(request.viewport.y * dpr) - h

    gl.enable(gl.SCISSOR_TEST)
    gl.viewport(x, y, w, h)
    gl.scissor(x, y, w, h)
    gl.clearColor(0.04, 0.05, 0.06, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    switch (request.kind) {
      case 'picture':
        this.drawPicture(request, entry, interpretation, w, h)
        break
      case 'waveformLuma':
        this.drawWaveform(request, entry, interpretation, 0, 1, w)
        break
      case 'waveformParadeRgb':
        this.drawWaveform(request, entry, interpretation, 1, 3, w)
        break
      case 'waveformParadeYcbcr':
        this.drawWaveform(request, entry, interpretation, 2, 3, w)
        break
      case 'vectorscope':
        this.drawVectorscope(request, entry, interpretation, w, h)
        break
      case 'histogram':
        this.drawHistogram(request, entry, interpretation, x, y, w, h)
        break
    }

    gl.disable(gl.SCISSOR_TEST)
  }

  // -------------------------------------------------------------------------

  private bindCommon(
    name: string,
    entry: DeviceTexture,
    interpretation: SignalInterpretation,
    crop: Rect,
    sampler: WebGLSampler
  ): UniformCache {
    const gl = this.gl
    const program = this.programs[name]
    const u = this.uniforms[name]
    gl.useProgram(program)

    const { kr, kg, kb } = coefficients(interpretation.matrix)
    gl.uniform3f(u.at('uLumaCoeff'), kr, kg, kb)

    // The affine received -> signal map, recovered from the tested function
    // rather than restated: scale is f(1) - f(0) and offset is f(0).
    const offset = receivedToSignal(0, interpretation.range)
    const scale = receivedToSignal(1, interpretation.range) - offset
    gl.uniform2f(u.at('uRange'), scale, offset)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, entry.texture)
    gl.bindSampler(0, sampler)
    gl.uniform1i(u.at('uTex'), 0)
    gl.uniform4f(u.at('uCrop'), crop.x, crop.y, crop.width, crop.height)
    return u
  }

  private sampleGrid(entry: DeviceTexture, crop: Rect, tileWidthPx: number): [number, number] {
    const cropWidthPx = Math.max(1, Math.round(entry.width * crop.width))
    const cropHeightPx = Math.max(1, Math.round(entry.height * crop.height))
    // One sample column per output column where the source has the detail to
    // fill it; never more, because extra columns only resample the same pixels.
    const cols = Math.max(16, Math.min(cropWidthPx, Math.round(tileWidthPx), MAX_SAMPLE_COLUMNS))
    const rows = Math.max(16, Math.min(cropHeightPx, MAX_SAMPLE_ROWS))
    return [cols, rows]
  }

  private drawPicture(
    request: RenderRequest,
    entry: DeviceTexture,
    interpretation: SignalInterpretation,
    tileWidthPx: number,
    tileHeightPx: number
  ): void {
    const gl = this.gl
    const u = this.bindCommon('picture', entry, interpretation, request.crop, this.linearSampler)
    const o = request.options

    // Fit the crop into the tile without distorting it. The source aspect is the
    // crop's aspect *in source pixels*, not the crop's normalised numbers — a
    // quarter-frame window of a 16:9 capture is 16:9, but its normalised rect is
    // square.
    const sourceAspect =
      (entry.width * request.crop.width) / Math.max(1, entry.height * request.crop.height)
    const tileAspect = tileWidthPx / Math.max(1, tileHeightPx)
    const fit: [number, number] =
      sourceAspect > tileAspect ? [1, tileAspect / sourceAspect] : [sourceAspect / tileAspect, 1]
    gl.uniform2f(u.at('uFit'), fit[0], fit[1])

    gl.uniform2f(u.at('uTexel'), 1 / entry.width, 1 / entry.height)
    const overlayIndex = { none: 0, falseColour: 1, zebra: 2, focusPeaking: 3 }[o.overlay]
    gl.uniform1i(u.at('uOverlay'), overlayIndex)

    const bands = request.falseColourBands.slice(0, MAX_FALSE_COLOUR_BANDS)
    gl.uniform1i(u.at('uBandCount'), bands.length)
    // -Infinity is not expressible as a GLSL float uniform; the first band's
    // bound is only ever compared with `>=` so any sufficiently negative
    // number does the same job.
    const ires = new Float32Array(MAX_FALSE_COLOUR_BANDS)
    const colours = new Float32Array(MAX_FALSE_COLOUR_BANDS * 3)
    bands.forEach((band, i) => {
      ires[i] = Number.isFinite(band.fromIre) ? band.fromIre : -1e6
      colours[i * 3] = band.colour[0]
      colours[i * 3 + 1] = band.colour[1]
      colours[i * 3 + 2] = band.colour[2]
    })
    gl.uniform1fv(u.at('uBandIre'), ires)
    gl.uniform3fv(u.at('uBandColour'), colours)

    gl.uniform1f(u.at('uZebraIre'), o.zebraIre)
    gl.uniform1f(u.at('uZebraIre2'), o.zebraIre2 ?? -1e6)
    gl.uniform1f(u.at('uPeakThreshold'), o.peakingThreshold)
    gl.uniform3f(u.at('uPeakColour'), ...o.peakingColour)

    gl.disable(gl.BLEND)
    gl.bindVertexArray(this.quadVao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
  }

  private drawWaveform(
    request: RenderRequest,
    entry: DeviceTexture,
    interpretation: SignalInterpretation,
    mode: number,
    segments: number,
    tileWidthPx: number
  ): void {
    const gl = this.gl
    const u = this.bindCommon('waveform', entry, interpretation, request.crop, this.nearestSampler)
    const [cols, rows] = this.sampleGrid(entry, request.crop, tileWidthPx / segments)

    gl.uniform2i(u.at('uSampleGrid'), cols, rows)
    gl.uniform1i(u.at('uSegments'), segments)
    gl.uniform1i(u.at('uMode'), mode)
    gl.uniform2f(u.at('uIreRange'), WAVEFORM_IRE_MIN, WAVEFORM_IRE_MAX)
    gl.uniform1f(u.at('uIntensity'), request.options.gain)
    gl.uniform1f(u.at('uPointSize'), this.pointSize * request.options.traceWidth)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.bindVertexArray(this.emptyVao)
    gl.drawArrays(gl.POINTS, 0, cols * rows * segments)
    gl.bindVertexArray(null)
    gl.disable(gl.BLEND)
  }

  private drawVectorscope(
    request: RenderRequest,
    entry: DeviceTexture,
    interpretation: SignalInterpretation,
    tileWidthPx: number,
    tileHeightPx: number
  ): void {
    const gl = this.gl
    const u = this.bindCommon(
      'vectorscope',
      entry,
      interpretation,
      request.crop,
      this.nearestSampler
    )
    const [cols, rows] = this.sampleGrid(entry, request.crop, tileWidthPx)

    gl.uniform2i(u.at('uSampleGrid'), cols, rows)
    gl.uniform1f(u.at('uFullScale'), VECTOR_FULL_SCALE)
    gl.uniform1f(u.at('uZoom'), request.options.vectorZoom)
    gl.uniform1f(u.at('uAspect'), tileWidthPx / Math.max(1, tileHeightPx))
    gl.uniform1f(u.at('uIntensity'), request.options.gain)
    // A shade larger than the waveform's: every sample of a flat colour lands
    // on one coordinate here, so a bar that fills a quarter of the picture can
    // otherwise occupy a single pixel and look like no trace at all.
    gl.uniform1f(u.at('uPointSize'), this.pointSize * request.options.traceWidth + 1)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.bindVertexArray(this.emptyVao)
    gl.drawArrays(gl.POINTS, 0, cols * rows)
    gl.bindVertexArray(null)
    gl.disable(gl.BLEND)
  }

  private drawHistogram(
    request: RenderRequest,
    entry: DeviceTexture,
    interpretation: SignalInterpretation,
    viewX: number,
    viewY: number,
    viewW: number,
    viewH: number
  ): void {
    if (!this.supportsHistogram || !this.histogramFbo) return
    const gl = this.gl
    const [cols, rows] = this.sampleGrid(entry, request.crop, viewW)
    const channels = request.options.histogramChannels

    // Pass 1 — bin into the float target.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.histogramFbo)
    gl.disable(gl.SCISSOR_TEST)
    gl.viewport(0, 0, HISTOGRAM_BINS, 1)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    const uAccum = this.bindCommon(
      'histogramAccum',
      entry,
      interpretation,
      request.crop,
      this.nearestSampler
    )
    gl.uniform2i(uAccum.at('uSampleGrid'), cols, rows)
    gl.uniform1i(uAccum.at('uBins'), HISTOGRAM_BINS)
    gl.uniform1f(uAccum.at('uPointSize'), 1)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.bindVertexArray(this.emptyVao)
    // Four channel passes in one draw; the draw shader masks off the ones the
    // tile is not showing, so toggling a channel costs nothing.
    gl.drawArrays(gl.POINTS, 0, cols * rows * 4)
    gl.bindVertexArray(null)
    gl.disable(gl.BLEND)

    // Pass 2 — draw the bins into the tile.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.enable(gl.SCISSOR_TEST)
    gl.viewport(viewX, viewY, viewW, viewH)
    gl.scissor(viewX, viewY, viewW, viewH)

    const program = this.programs.histogramDraw
    const u = this.uniforms.histogramDraw
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.histogramTexture)
    gl.bindSampler(0, null)
    gl.uniform1i(u.at('uBins'), 0)
    // The vertical axis is relative, not a count: a bin holding the average
    // share of the samples reaches a fixed fraction of the tile, scaled by the
    // tile's gain. Absolute counts would need a reduction pass and would mean
    // nothing to read anyway.
    const perBin = (cols * rows) / HISTOGRAM_BINS
    gl.uniform1f(u.at('uNorm'), (1 / (perBin * 8)) * (request.options.gain / 0.35))
    // How many bins land behind one output pixel — the draw shader reduces over
    // that span so a one-bin spike cannot fall between pixel centres.
    gl.uniform1f(u.at('uBinsPerPixel'), HISTOGRAM_BINS / Math.max(1, viewW))
    gl.uniform4f(
      u.at('uChannelMask'),
      channels.r ? 1 : 0,
      channels.g ? 1 : 0,
      channels.b ? 1 : 0,
      channels.luma ? 1 : 0
    )

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.bindVertexArray(this.quadVao)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
    gl.disable(gl.BLEND)
  }

  dispose(): void {
    const gl = this.gl
    for (const entry of this.textures.values()) gl.deleteTexture(entry.texture)
    this.textures.clear()
    for (const program of Object.values(this.programs)) gl.deleteProgram(program)
    if (this.histogramTexture) gl.deleteTexture(this.histogramTexture)
    if (this.histogramFbo) gl.deleteFramebuffer(this.histogramFbo)
    gl.deleteSampler(this.nearestSampler)
    gl.deleteSampler(this.linearSampler)
    gl.deleteVertexArray(this.quadVao)
    gl.deleteVertexArray(this.emptyVao)
  }
}
