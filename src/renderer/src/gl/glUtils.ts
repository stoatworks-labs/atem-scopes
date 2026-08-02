/**
 * Thin WebGL2 helpers. Nothing clever — the value here is that every failure
 * path throws with the shader log attached, because a silently-null program
 * renders a black tile that looks exactly like a black tile with no signal.
 */

export class GlError extends Error {}

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new GlError('createShader returned null')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '(no log)'
    gl.deleteShader(shader)
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'
    throw new GlError(`${kind} shader failed to compile: ${log}\n${numberSource(source)}`)
  }
  return shader
}

export function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc)
  const program = gl.createProgram()
  if (!program) throw new GlError('createProgram returned null')
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '(no log)'
    gl.deleteProgram(program)
    throw new GlError(`program failed to link: ${log}`)
  }
  return program
}

function numberSource(source: string): string {
  return source
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(3)} | ${line}`)
    .join('\n')
}

/** Caches uniform locations — getUniformLocation is a string lookup and these are per-frame paths. */
export class UniformCache {
  private locations = new Map<string, WebGLUniformLocation | null>()

  constructor(
    private gl: WebGL2RenderingContext,
    private program: WebGLProgram
  ) {}

  at(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name)) {
      this.locations.set(name, this.gl.getUniformLocation(this.program, name))
    }
    return this.locations.get(name) ?? null
  }
}

/**
 * A unit quad as a triangle strip, for the fullscreen-ish passes. The scope
 * passes that plot one point per sampled pixel use no attributes at all and
 * derive position from gl_VertexID instead, so they need nothing from here.
 */
export function createQuad(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()
  if (!vao) throw new GlError('createVertexArray returned null')
  const buffer = gl.createBuffer()
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  return vao
}

/**
 * An empty VAO for attribute-less draws. WebGL2 still requires *a* VAO to be
 * bound, and leaving whichever one was last used bound is how you end up
 * reading a stale buffer as though it were vertex data.
 */
export function createEmptyVao(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()
  if (!vao) throw new GlError('createVertexArray returned null')
  return vao
}
