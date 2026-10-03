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

/** Steps 1–7: linearize, white balance, exposure, tone, color, HSL, curve. */
export const POINT_PASS =
  PRELUDE +
  /* glsl */ `
uniform sampler2D u_src;
uniform vec3 u_gains;
uniform float u_exposure, u_whites, u_blacks, u_shadows, u_highlights, u_contrast;
uniform float u_vibrance, u_saturation;
uniform bool u_bypass;
uniform bool u_encoded8;   // render target is 8-bit: store sRGB-encoded
uniform bool u_hslOn;
uniform vec3 u_hsl[8];     // (h, s, l) per color, −100…100
uniform bool u_curveOn;
uniform sampler2D u_curve; // 1024×1 RGB32F: C_channel(C_rgb(e)) per channel
out vec4 outColor;

const float CENTERS[9] = float[9](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0, 360.0);

float smoothstep01(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec3 rgb2hsv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  float s = mx > 1e-6 ? d / mx : 0.0;
  float h = 0.0;
  if (d >= 1e-9) {
    if (mx == c.r) h = 60.0 * (c.g - c.b) / d;
    else if (mx == c.g) h = 60.0 * ((c.b - c.r) / d + 2.0);
    else h = 60.0 * ((c.r - c.g) / d + 4.0);
    if (h < 0.0) h += 360.0;
  }
  return vec3(h, s, mx);
}

vec3 hsv2rgb(vec3 hsv) {
  float c = hsv.z * hsv.y;
  float hp = hsv.x / 60.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  float m = hsv.z - c;
  int sector = int(floor(hp)) % 6;
  vec3 rgb = sector == 0 ? vec3(c, x, 0.0)
           : sector == 1 ? vec3(x, c, 0.0)
           : sector == 2 ? vec3(0.0, c, x)
           : sector == 3 ? vec3(0.0, x, c)
           : sector == 4 ? vec3(x, 0.0, c)
           :               vec3(c, 0.0, x);
  return rgb + m;
}

vec3 applyHsl(vec3 c) {
  vec3 hsv = rgb2hsv(c);
  int i = 7;
  for (int j = 0; j < 8; j++) if (hsv.x >= CENTERS[j]) i = j;
  float t = (hsv.x - CENTERS[i]) / (CENTERS[i + 1] - CENTERS[i]);
  float s = t * t * (3.0 - 2.0 * t);
  vec3 d = (u_hsl[i] * (1.0 - s) + u_hsl[(i + 1) % 8] * s) / 100.0;
  float k = smoothstep01(0.02, 0.2, hsv.y);
  float h2 = mod(hsv.x + k * d.x * 30.0, 360.0);
  float s2 = clamp(hsv.y * (1.0 + k * d.y), 0.0, 1.0);
  float v2 = hsv.z * exp2(k * d.z);
  return hsv2rgb(vec3(h2, s2, v2));
}

float curveAt(int ch, float e) {
  float p = clamp(e, 0.0, 1.0) * 1023.0;
  int i = min(int(floor(p)), 1022);
  float f = p - float(i);
  return mix(texelFetch(u_curve, ivec2(i, 0), 0)[ch], texelFetch(u_curve, ivec2(i + 1, 0), 0)[ch], f);
}

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

    if (u_hslOn) c = applyHsl(c);                                  // 6

    if (u_curveOn) {                                               // 7
      vec3 e = linearToSrgb(c);
      c = srgbToLinear(clamp(vec3(curveAt(0, e.r), curveAt(1, e.g), curveAt(2, e.b)), 0.0, 1.0));
    }
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

/** Steps 8–12: sharpness, clarity, vignette, sRGB encode, LUT (8-bit target P). */
export const FINAL_PASS =
  PRELUDE +
  /* glsl */ `
precision highp sampler3D;
uniform sampler2D u_a;          // pass A: linear rgb + perceptual luminance
uniform sampler2D u_sharpBlur;  // G_σs(p), full size, .r
uniform sampler2D u_clarBlur;   // G_σc(p), reduced size, .r (bilinear)
uniform sampler2D u_lut1;       // 1D LUT: size×1 RGB32F
uniform sampler3D u_lut3;       // 3D LUT: size³ RGB32F (r = x, g = y, b = z)
uniform vec2 u_srcSize;
uniform bool u_bypass;
uniform bool u_encoded8;
uniform float u_sharpness, u_clarity, u_vignette;
uniform int u_lutMode;          // 0 none, 1 = 1D, 3 = 3D
uniform int u_lutSize;
uniform vec3 u_lutMin, u_lutMax;
uniform float u_lutIntensity;
out vec4 outColor;

float smoothstep01(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

vec3 sampleLut(vec3 e) {
  vec3 u = clamp((e - u_lutMin) / (u_lutMax - u_lutMin), 0.0, 1.0);
  vec3 p = u * float(u_lutSize - 1);
  ivec3 i0 = min(ivec3(floor(p)), ivec3(u_lutSize - 2));
  vec3 f = p - vec3(i0);
  if (u_lutMode == 1) {
    vec3 r;
    for (int ch = 0; ch < 3; ch++) {
      r[ch] = mix(texelFetch(u_lut1, ivec2(i0[ch], 0), 0)[ch], texelFetch(u_lut1, ivec2(i0[ch] + 1, 0), 0)[ch], f[ch]);
    }
    return r;
  }
  vec3 acc = vec3(0.0);
  for (int dz = 0; dz < 2; dz++)
    for (int dy = 0; dy < 2; dy++)
      for (int dx = 0; dx < 2; dx++) {
        float w = (dx == 1 ? f.x : 1.0 - f.x) * (dy == 1 ? f.y : 1.0 - f.y) * (dz == 1 ? f.z : 1.0 - f.z);
        acc += w * texelFetch(u_lut3, i0 + ivec3(dx, dy, dz), 0).rgb;
      }
  return acc;
}

void main() {
  ivec2 xy = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(u_a, xy, 0);
  vec3 c = u_encoded8 ? srgbToLinear(a.rgb) : a.rgb;

  if (!u_bypass) {
    float l = luma(c);                                             // 8
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

    vec2 uv = (vec2(xy) + 0.5) / u_srcSize;                        // 9
    float aspect = u_srcSize.x / u_srcSize.y;
    vec2 d = vec2((uv.x - 0.5) * aspect, uv.y - 0.5);
    float r = length(d) / sqrt(aspect * aspect * 0.25 + 0.25);
    c *= exp2(1.5 * (u_vignette / 100.0) * smoothstep01(0.25, 1.0, r));
  }

  vec3 e = linearToSrgb(c);                                        // 10
  if (!u_bypass && u_lutMode != 0) {                               // 11
    e = clamp(e + u_lutIntensity * (sampleLut(e) - e), 0.0, 1.0);
  }
  outColor = vec4(e, 1.0);                                         // 12 (8-bit target)
}
`;

/** Step 13: crop & straighten the 8-bit image P (bilinear). */
export const CROP_PASS =
  PRELUDE +
  /* glsl */ `
uniform sampler2D u_p;
uniform vec2 u_srcSize;   // W, H
uniform vec4 u_rect;      // x, y, w, h (fractions)
uniform vec2 u_rot;       // cos θ, sin θ
uniform vec2 u_outSize;   // Wc, Hc (or smaller, for subsampled readbacks)
uniform bool u_flipY;
out vec4 outColor;

vec3 at(ivec2 p) {
  return texelFetch(u_p, clamp(p, ivec2(0), ivec2(u_srcSize) - 1), 0).rgb;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  if (u_flipY) frag.y = u_outSize.y - frag.y;
  vec2 ij = floor(frag);
  float W = u_srcSize.x;
  float H = u_srcSize.y;
  float fx = u_rect.x * W + (ij.x + 0.5) * (u_rect.z * W / u_outSize.x) - W / 2.0;
  float fy = u_rect.y * H + (ij.y + 0.5) * (u_rect.w * H / u_outSize.y) - H / 2.0;
  float px = W / 2.0 + (u_rot.x * fx - u_rot.y * fy) - 0.5;
  float py = H / 2.0 + (u_rot.y * fx + u_rot.x * fy) - 0.5;
  if (px < -0.5 || px > W - 0.5 || py < -0.5 || py > H - 0.5) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  ivec2 p0 = ivec2(floor(px), floor(py));
  vec2 f = vec2(px, py) - vec2(p0);
  vec3 v = at(p0) * (1.0 - f.x) * (1.0 - f.y)
         + at(p0 + ivec2(1, 0)) * f.x * (1.0 - f.y)
         + at(p0 + ivec2(0, 1)) * (1.0 - f.x) * f.y
         + at(p0 + ivec2(1, 1)) * f.x * f.y;
  outColor = vec4(v, 1.0);
}
`;
