// GLSL for shader transitions (WebGL). A transition body defines `vec4 transition(vec2 uv)` and
// may use `getFromColor(uv)`, `getToColor(uv)`, `progress` (0 → 1) and `ratio` (width / height):
// the same convention as the gl-transitions collection, so bodies written for it drop in.

export const TRANSITION_VERTEX = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main(void) {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

/** Extra uniforms a custom body declares: a float, or a vec2 as `[x, y]`. */
export type TransitionUniforms = Record<string, number | [number, number]>;

/** Wrap a transition body into a full fragment shader. */
export function transitionFragment(body: string, uniforms: TransitionUniforms = {}): string {
  const decls = Object.entries(uniforms)
    .map(([name, v]) => `uniform ${Array.isArray(v) ? 'vec2' : 'float'} ${name};`)
    .join('\n');
  return /* glsl */ `
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float progress;
uniform float ratio;
${decls}
vec4 getFromColor(vec2 uv) { return texture(uFrom, uv); }
vec4 getToColor(vec2 uv) { return texture(uTo, uv); }
${body}
void main(void) { finalColor = transition(vUV); }
`;
}

export const SHADER_PRESETS = {
  /** A plain crossfade. */
  fade: /* glsl */ `
vec4 transition(vec2 uv) {
  return mix(getFromColor(uv), getToColor(uv), progress);
}`,

  /** Burns through in noisy patches with a glowing edge. */
  dissolve: /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec4 transition(vec2 uv) {
  vec2 p = uv * vec2(ratio, 1.0) * 6.0;
  float n = noise(p) * 0.65 + noise(p * 2.7) * 0.35;
  float edge = 0.06;
  float t = progress * (1.0 + 2.0 * edge) - edge;
  float m = smoothstep(n - edge, n + edge, t);
  vec4 c = mix(getFromColor(uv), getToColor(uv), m);
  float rim = 1.0 - abs(m * 2.0 - 1.0);
  rim = rim * rim * 0.9;
  return vec4(c.rgb + vec3(1.0, 0.72, 0.28) * rim, max(c.a, rim));
}`,

  /** A slanted soft wipe, left to right, with a light band on the edge. */
  wipe: /* glsl */ `
vec4 transition(vec2 uv) {
  float soft = 0.12;
  float x = uv.x + (uv.y - 0.5) * 0.18;
  float edge = mix(-0.09 - soft, 1.09, progress);
  float m = 1.0 - smoothstep(edge, edge + soft, x);
  vec4 c = mix(getFromColor(uv), getToColor(uv), m);
  float rim = (1.0 - abs(m * 2.0 - 1.0)) * 0.35;
  return vec4(c.rgb + vec3(rim), max(c.a, rim));
}`,

  /** A circle opening from the centre. */
  iris: /* glsl */ `
vec4 transition(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(ratio, 1.0);
  float soft = 0.04;
  float r = progress * (length(vec2(ratio, 1.0) * 0.5) + soft);
  float m = 1.0 - smoothstep(r - soft, r, length(p));
  vec4 c = mix(getFromColor(uv), getToColor(uv), m);
  float rim = (1.0 - abs(m * 2.0 - 1.0)) * 0.6;
  return vec4(c.rgb + vec3(1.0, 0.85, 0.45) * rim, max(c.a, rim));
}`,

  /** A comic starburst opening from the centre, with a white die-cut rim and an ink outline. */
  burst: /* glsl */ `
vec4 transition(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(ratio, 1.0);
  float a = atan(p.y, p.x) + progress * 0.9;
  float k = 0.72 + 0.28 * pow(abs(cos(a * 6.0)), 3.0);
  float maxR = length(vec2(ratio, 1.0) * 0.5) / 0.72 + 0.12;
  float r = progress * maxR * k;
  float d = length(p);
  float inside = 1.0 - smoothstep(r - 0.004, r, d);
  float rim = smoothstep(r - 0.004, r, d) * (1.0 - smoothstep(r + 0.018, r + 0.022, d));
  float ink = smoothstep(r + 0.018, r + 0.022, d) * (1.0 - smoothstep(r + 0.03, r + 0.034, d));
  float on = step(0.001, progress) * step(progress, 0.999);
  vec4 c = mix(getFromColor(uv), getToColor(uv), inside);
  c.rgb = mix(c.rgb, vec3(1.0), rim * on);
  c.rgb = mix(c.rgb, vec3(0.04), ink * on);
  return c;
}`,

  /** Comic halftone: dots of the new screen grow across the old one, corner to corner. */
  halftone: /* glsl */ `
vec4 transition(vec2 uv) {
  float cells = 22.0;
  vec2 g = uv * vec2(cells * ratio, cells);
  vec2 cell = floor(g) + 0.5;
  vec2 f = g - cell;
  vec2 cuv = cell / vec2(cells * ratio, cells);
  float sweep = (cuv.x + (1.0 - cuv.y)) * 0.5;
  float t = clamp(progress * 1.6 - sweep * 0.6, 0.0, 1.0);
  float r = t * 0.75;
  float m = 1.0 - smoothstep(r - 0.05, r, length(f));
  return mix(getFromColor(uv), getToColor(uv), m);
}`,

  /** The old screen peels off like a sticker, corner first: a white backing on the flap, a
   *  shadow under the fold, the new screen underneath. */
  peel: /* glsl */ `
vec4 transition(vec2 uv) {
  vec2 asp = vec2(ratio, 1.0);
  vec2 n = normalize(vec2(1.0, 1.0));
  vec2 p = uv * asp;
  float L = dot(asp, n);
  float F = mix(L + 0.04, -0.04, progress);
  float q = dot(p, n);
  if (q > F) {
    vec4 c = getToColor(uv);
    float sh = (1.0 - smoothstep(0.0, 0.09, q - F)) * 0.45 * step(0.001, progress) * step(progress, 0.999);
    return vec4(c.rgb * (1.0 - sh), c.a);
  }
  vec2 ur = (p + 2.0 * (F - q) * n) / asp;
  if (ur.x >= 0.0 && ur.x <= 1.0 && ur.y >= 0.0 && ur.y <= 1.0) {
    float d = F - q;
    vec3 back = vec3(0.97, 0.97, 0.95) * (0.8 + 0.2 * smoothstep(0.0, 0.25, d));
    vec2 e = min(ur, 1.0 - ur);
    float edge = 1.0 - smoothstep(0.004, 0.008, min(e.x * ratio, e.y));
    return vec4(mix(back, vec3(0.05), edge), 1.0);
  }
  return getFromColor(uv);
}`,

  /** Pixelates out of the old screen and back into the new one. */
  pixelate: /* glsl */ `
vec4 transition(vec2 uv) {
  float d = min(progress, 1.0 - progress) * 2.0;
  float cells = mix(260.0, 12.0, d * d);
  vec2 size = vec2(1.0 / (cells * ratio), 1.0 / cells);
  vec2 p = d > 0.02 ? (floor(uv / size) + 0.5) * size : uv;
  return mix(getFromColor(p), getToColor(p), smoothstep(0.35, 0.65, progress));
}`,
} as const;

export type ShaderPreset = keyof typeof SHADER_PRESETS;
