/**
 * A built-in colour-bar generator, for the same reason simpleRTA generates its
 * own pink noise: it is the only way to check that the instrument is reading
 * correctly without trusting the thing you are trying to measure.
 *
 * It is also self-validating in a useful way. The bars are drawn as exact RGB
 * values, and `vectorTargets()` places the vectorscope graticule from the same
 * matrix the shader plots with. So with 75% bars selected the trace must land
 * *inside the boxes*. If it doesn't, something between the two — the matrix,
 * the range mapping, a shader uniform — is wrong, and you know that before
 * pointing it at a real signal and blaming the camera.
 *
 * The pattern is drawn to a canvas and handed out as a MediaStream via
 * captureStream(), so it arrives through exactly the same path as a real UVC
 * device and exercises the same code.
 */

export const TEST_PATTERN_DEVICE_ID = '__test-pattern__'
export const TEST_PATTERN_LABEL = 'Test pattern (built in)'

/** 75% EBU bars, in the order they appear left to right. */
const BARS_75: { name: string; rgb: [number, number, number] }[] = [
  { name: 'white', rgb: [0.75, 0.75, 0.75] },
  { name: 'yellow', rgb: [0.75, 0.75, 0] },
  { name: 'cyan', rgb: [0, 0.75, 0.75] },
  { name: 'green', rgb: [0, 0.75, 0] },
  { name: 'magenta', rgb: [0.75, 0, 0.75] },
  { name: 'red', rgb: [0.75, 0, 0] },
  { name: 'blue', rgb: [0, 0, 0.75] },
  { name: 'black', rgb: [0, 0, 0] }
]

function css(rgb: [number, number, number]): string {
  // Rounded to 8-bit here rather than left to the canvas, so the value the
  // scope reads back is the value this file says it drew.
  const [r, g, b] = rgb.map((v) => Math.round(v * 255))
  return `rgb(${r}, ${g}, ${b})`
}

export interface TestPatternHandle {
  stream: MediaStream
  stop: () => void
}

/**
 * Draws a 2x2 multiview-shaped pattern so the region-drawing workflow can be
 * exercised too: four quadrants, each with bars over a ramp, each with a label
 * bar burnt into the bottom exactly as a real multiview has. The label bar is
 * white-on-black, so leaving it inside a scope's crop visibly parks a spike at
 * 100 IRE — which is the trap the window inset exists to avoid, made visible.
 */
export function startTestPattern(width = 1280, height = 720, fps = 30): TestPatternHandle {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('2D canvas is unavailable, so the test pattern cannot be generated.')

  const quadrantLabels = ['Window 1', 'Window 2', 'Window 3', 'Window 4']

  const drawQuadrant = (qx: number, qy: number, qw: number, qh: number, label: string): void => {
    const labelHeight = Math.round(qh * 0.08)
    const pictureHeight = qh - labelHeight
    const barHeight = Math.round(pictureHeight * 0.7)
    const barWidth = qw / BARS_75.length

    BARS_75.forEach((bar, i) => {
      ctx.fillStyle = css(bar.rgb)
      ctx.fillRect(qx + i * barWidth, qy, Math.ceil(barWidth), barHeight)
    })

    // A black-to-white ramp under the bars: gives the waveform a diagonal, the
    // histogram a flat floor, and false colour every band at once.
    const ramp = ctx.createLinearGradient(qx, 0, qx + qw, 0)
    ramp.addColorStop(0, 'rgb(0, 0, 0)')
    ramp.addColorStop(1, 'rgb(255, 255, 255)')
    ctx.fillStyle = ramp
    ctx.fillRect(qx, qy + barHeight, qw, pictureHeight - barHeight)

    ctx.fillStyle = '#000'
    ctx.fillRect(qx, qy + pictureHeight, qw, labelHeight)
    ctx.fillStyle = '#fff'
    ctx.font = `${Math.round(labelHeight * 0.62)}px ui-sans-serif, system-ui, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.fillText(label, qx + 8, qy + pictureHeight + labelHeight / 2)
  }

  const render = (): void => {
    const halfW = width / 2
    const halfH = height / 2
    drawQuadrant(0, 0, halfW, halfH, quadrantLabels[0])
    drawQuadrant(halfW, 0, halfW, halfH, quadrantLabels[1])
    drawQuadrant(0, halfH, halfW, halfH, quadrantLabels[2])
    drawQuadrant(halfW, halfH, halfW, halfH, quadrantLabels[3])
  }

  render()
  // captureStream on a canvas that never changes emits one frame and stops, and
  // a <video> holding a stalled track reports videoWidth 0 on some builds. A
  // slow repaint keeps the track live without costing anything.
  const timer = window.setInterval(render, Math.round(1000 / Math.min(fps, 10)))

  const stream = canvas.captureStream(fps)
  return {
    stream,
    stop: () => {
      window.clearInterval(timer)
      stream.getTracks().forEach((t) => t.stop())
    }
  }
}

/** The 75% bar values, exported so a test can assert what the scopes should read. */
export const TEST_PATTERN_BARS = BARS_75
