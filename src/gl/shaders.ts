/**
 * GLSL (WebGL2) for the live preview. Every formula mirrors
 * docs/ADJUSTMENTS.md; the step numbers below refer to that document.
 *
 * Images are stored top row first (no UNPACK_FLIP), so texel (x, y) is image
 * pixel (x, y). Only the final pass to the canvas flips vertically.
 */

const PRELUDE = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float enc(float l) { return pow(max(l, 0.0), 1.0 / 2.2); }
float dec(float p) { return pow(max(p, 0.0), 2.2); }

float srgbToLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
vec3 srgbToLinear(vec3 c) { return vec3(srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)); }

float linearToSrgb(float c) {
  c = clamp(c, 0.0, 1.0);
  return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}
vec3 linearToSrgb(vec3 c) { return vec3(linearToSrgb(c.r), linearToSrgb(c.g), linearToSrgb(c.b)); }

vec3 relum(vec3 c, float l, float l2) {
  return l > 1e-6 ? c * (l2 / l) : vec3(l2);
}
`;

export const VERTEX = /* glsl */ `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/** Steps 1–5: linearize, white balance, exposure, tone, color. */
export const POINT_PASS =
  PRELUDE +
  /* glsl */ `
uniform sampler2D u_src;
uniform vec3 u_gains;
uniform float u_exposure, u_whites, u_blacks, u_shadows, u_highlights, u_contrast;
uniform float u_vibrance, u_saturation;
uniform bool u_bypass;
uniform bool u_encoded8;   // render target is 8-bit: store sRGB-encoded
out vec4 outColor;

void main() {
  ivec2 xy = ivec2(gl_FragCoord.xy);
  vec3 c = srgbToLinear(texelFetch(u_src, xy, 0).rgb);            // 1

  if (!u_bypass) {
    c *= u_gains;                                                  // 2
    c *= exp2(u_exposure);                                         // 3

    float l = luma(c);                                             // 4
    float p = enc(l);
    float wp = 1.0 - 0.25 * u_whites / 100.0;
    float bp = -0.10 * u_blacks / 100.0;
    float p1 = (p - bp) / (wp - bp);
    float q = clamp(p1, 0.0, 1.0);
    float p2 = p1 + 0.25 * (u_shadows / 100.0) * 6.75 * q * (1.0 - q) * (1.0 - q)
                  + 0.25 * (u_highlights / 100.0) * 6.75 * q * q * (1.0 - q);
    float q2 = clamp(p2, 0.0, 1.0);
    float p3 = p2 + (u_contrast / 100.0) * 4.0 * (q2 - 0.5) * q2 * (1.0 - q2);
    c = relum(c, l, dec(p3));

    float l5 = luma(c);                                            // 5
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float sat = mx > 1e-6 ? (mx - mn) / mx : 0.0;
    float f = (1.0 + (u_vibrance / 100.0) * (1.0 - sat) * (1.0 - sat))
            * (1.0 + u_saturation / 100.0);
    c = max(vec3(l5) + (c - vec3(l5)) * f, 0.0);
  }

  float p = enc(luma(c));
  outColor = u_encoded8 ? vec4(linearToSrgb(c), clamp(p, 0.0, 1.0)) : vec4(c, p);
}
`;

/** Box average of the perceptual luminance (alpha of pass A) by `u_factor`. */
export const DOWNSAMPLE_PASS =
  PRELUDE +
  /* glsl */ `
uniform sampler2D u_in;
uniform int u_factor;
uniform ivec2 u_srcSize;
out vec4 outColor;

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * u_factor;
  float acc = 0.0;
  for (int j = 0; j < 8; j++) {
    if (j >= u_factor) break;
    for (int i = 0; i < 8; i++) {
      if (i >= u_factor) break;
      ivec2 s = min(base + ivec2(i, j), u_srcSize - 1);
      acc += texelFetch(u_in, s, 0).a;
    }
  }
  outColor = vec4(acc / float(u_factor * u_factor), 0.0, 0.0, 1.0);
}
`;

/**
 * One direction of a separable Gaussian (step 6), replicated edges.
 * `u_fromAlpha` reads the luminance from pass A's alpha; otherwise from .r.
 */
export const BLUR_PASS =
  PRELUDE +
  /* glsl */ `
uniform sampler2D u_in;
uniform bool u_fromAlpha;
uniform ivec2 u_dir;
uniform ivec2 u_size;
uniform float u_sigma;
uniform int u_radius;
out vec4 outColor;

float read(ivec2 p) {
  vec4 t = texelFetch(u_in, clamp(p, ivec2(0), u_size - 1), 0);
  return u_fromAlpha ? t.a : t.r;
}

void main() {
  ivec2 xy = ivec2(gl_FragCoord.xy);
  float acc = 0.0;
  float norm = 0.0;
  for (int k = -64; k <= 64; k++) {
    if (k < -u_radius || k > u_radius) continue;
    float w = exp(-float(k * k) / (2.0 * u_sigma * u_sigma));
    acc += w * read(xy + u_dir * k);
    norm += w;
  }
  outColor = vec4(acc / norm, 0.0, 0.0, 1.0);
}
`;

/** Steps 6–8: sharpness, clarity, vignette, sRGB encode. */
export const FINAL_PASS =
  PRELUDE +
  /* glsl */ `
uniform sampler2D u_a;          // pass A: linear rgb + perceptual luminance
uniform sampler2D u_sharpBlur;  // G_σs(p), full size, .r
uniform sampler2D u_clarBlur;   // G_σc(p), reduced size, .r (bilinear)
uniform vec2 u_srcSize;
uniform vec2 u_outSize;
uniform bool u_flipY;
uniform bool u_bypass;
uniform bool u_encoded8;
uniform float u_sharpness, u_clarity, u_vignette;
out vec4 outColor;

float smoothstep01(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (u_flipY) frag.y = u_outSize.y - frag.y;
  // Nearest source pixel (identity when output and source have the same size).
  ivec2 xy = ivec2(floor(frag * u_srcSize / u_outSize));
  vec4 a = texelFetch(u_a, xy, 0);
  vec3 c = u_encoded8 ? srgbToLinear(a.rgb) : a.rgb;

  if (!u_bypass) {
    float l = luma(c);                                             // 6
    float p = enc(l);
    float q = clamp(p, 0.0, 1.0);
    float m = 4.0 * q * (1.0 - q);
    float p2 = p;
    if (u_sharpness != 0.0) {
      p2 += 1.5 * (u_sharpness / 100.0) * (p - texelFetch(u_sharpBlur, xy, 0).r);
    }
    if (u_clarity != 0.0) {
      vec2 uv = (vec2(xy) + 0.5) / u_srcSize;
      p2 += 0.6 * (u_clarity / 100.0) * m * (p - texture(u_clarBlur, uv).r);
    }
    c = relum(c, l, dec(p2));

    vec2 uv = (vec2(xy) + 0.5) / u_srcSize;                        // 7
    float aspect = u_srcSize.x / u_srcSize.y;
    vec2 d = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float r = length(d) / sqrt(aspect * aspect * 0.25 + 0.25);
    c *= exp2(1.5 * (u_vignette / 100.0) * smoothstep01(0.25, 1.0, r));
  }

  outColor = vec4(linearToSrgb(c), 1.0);                           // 8
}
`;
