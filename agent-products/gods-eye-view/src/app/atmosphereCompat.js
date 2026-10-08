// Current-upstream compatibility seam. Apple mobile's Metal translator can
// reject Cesium's model-atmosphere varying/out-parameter shader at link time.
const PROBE_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec3 a_position;
out vec3 v_probe;
void writeOut(out vec3 value) { value = vec3(1.0); }
void main() { writeOut(v_probe); gl_Position = vec4(a_position, 1.0); }`;
const PROBE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 v_probe;
out vec4 fragColor;
void main() { fragColor = vec4(v_probe, 1.0); }`;

export function isAppleMobilePlatform(navigatorLike = globalThis.navigator) {
  if (!navigatorLike) return false;
  const ua = String(navigatorLike.userAgent || '');
  if (/\b(iPad|iPhone|iPod)\b/.test(ua)) return true;
  const platform = String(navigatorLike.platform || '');
  const macLike = platform === 'MacIntel' || platform === 'MacARM' || /\bMacintosh\b/.test(ua);
  return macLike && (Number(navigatorLike.maxTouchPoints) || 0) > 1;
}

export function probeOutParamVaryingLinkFailure(gl) {
  if (!gl) return false;
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return false;
  try {
    gl.shaderSource(vs, PROBE_VERTEX_SHADER);
    gl.compileShader(vs);
    gl.shaderSource(fs, PROBE_FRAGMENT_SHADER);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)
      || !gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return false;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    return !gl.getProgramParameter(program, gl.LINK_STATUS);
  } catch {
    return false;
  } finally {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteProgram(program);
  }
}

function defaultProbeContext() {
  try {
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(1, 1)
      : globalThis.document?.createElement('canvas');
    return canvas?.getContext('webgl2') ?? null;
  } catch {
    return null;
  }
}

export function shouldDisableModelAtmosphere({
  navigatorLike = globalThis.navigator,
  createProbeContext = defaultProbeContext,
} = {}) {
  const gl = createProbeContext();
  if (gl) {
    let linkFails;
    try {
      linkFails = probeOutParamVaryingLinkFailure(gl);
    } finally {
      try { gl.getExtension?.('WEBGL_lose_context')?.loseContext(); } catch { /* GC fallback */ }
    }
    if (linkFails) return true;
    return isAppleMobilePlatform(navigatorLike);
  }
  return isAppleMobilePlatform(navigatorLike);
}

export function applyModelAtmosphereWorkaround(scene, options = {}) {
  if (!scene?.fog || !shouldDisableModelAtmosphere(options)) return false;
  scene.fog.renderable = false;
  return true;
}
