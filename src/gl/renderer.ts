/**
 * WebGL2 renderer for the Develop preview. Passes (see docs/ADJUSTMENTS.md):
 *
 *   src ──point──▶ A (linear rgb + perceptual luminance in alpha)
 *   A.a ──blur H/V σs──▶ sharp blur            (only when sharpness ≠ 0)
 *   A.a ──÷f──▶ blur H/V σc/f ──▶ clarity blur  (only when clarity ≠ 0)
 *   A + blurs ──final (+ LUT)──▶ P (8-bit, whole photo)
 *   P ──crop & straighten──▶ canvas / readback target
 */
import { whiteBalanceGains } from "../lib/adjust";
import { cropSize, type CropRect } from "../lib/crop";
import { curvesIdentity, curveTable } from "../lib/curve";
import { hslIsNeutral, hslVectors } from "../lib/hsl";
import type { Lut } from "../lib/lut";
import type { Recipe } from "../lib/recipe";
import { BLUR_PASS, CROP_PASS, DOWNSAMPLE_PASS, FINAL_PASS, POINT_PASS, VERTEX } from "./shaders";

const CURVE_SAMPLES = 1024;

/** Crop actually applied: the recipe's, an override (crop mode) or none (before view). */
export type CropView = CropRect & { angle: number };

const NO_CROP: CropView = { x: 0, y: 0, w: 1, h: 1, angle: 0 };

/** Reduction for the clarity blur: f = clamp(floor(σc / 2.5), 1, 4). */
export function clarityFactor(side: number): number {
  const sigma = (20 * side) / 2048;
  return Math.min(4, Math.max(1, Math.floor(sigma / 2.5)));
}
const MAX_RADIUS = 64;

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

interface Program {
  prog: WebGLProgram;
  u: Uniforms;
}

export interface RenderOptions {
  bypass?: boolean;
  /** Replaces the recipe's crop (crop mode shows the whole rotated frame). */
  crop?: CropView;
}

export class PreviewRenderer {
  readonly gl: WebGL2RenderingContext;
  private readonly floatTargets: boolean;
  private readonly point: Program;
  private readonly blur: Program;
  private readonly down: Program;
  private readonly final: Program;
  private readonly cropProg: Program;
  private readonly vao: WebGLVertexArrayObject;
  private src: WebGLTexture | null = null;
  private curveTex: WebGLTexture;
  private curveKey = "";
  private lut: Lut | null = null;
  private lutTex1: WebGLTexture;
  private lutTex3: WebGLTexture;
  private lutVersion = 0;
  private factor = 1;
  private width = 0;
  private height = 0;
  private targets: Record<string, Target> = {};

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 indisponível neste computador.");
    this.gl = gl;
    this.floatTargets = gl.getExtension("EXT_color_buffer_float") !== null;

    this.point = this.program(POINT_PASS, [
      "u_src", "u_gains", "u_exposure", "u_whites", "u_blacks", "u_shadows", "u_highlights",
      "u_contrast", "u_vibrance", "u_saturation", "u_bypass", "u_encoded8",
      "u_hslOn", "u_hsl", "u_curveOn", "u_curve",
    ]);
    this.blur = this.program(BLUR_PASS, [
      "u_in", "u_fromAlpha", "u_dir", "u_size", "u_sigma", "u_radius",
    ]);
    this.down = this.program(DOWNSAMPLE_PASS, ["u_in", "u_factor", "u_srcSize"]);
    this.final = this.program(FINAL_PASS, [
      "u_a", "u_sharpBlur", "u_clarBlur", "u_lut1", "u_lut3", "u_srcSize", "u_bypass",
      "u_encoded8", "u_sharpness", "u_clarity", "u_vignette",
      "u_lutMode", "u_lutSize", "u_lutMin", "u_lutMax", "u_lutIntensity",
    ]);
    this.cropProg = this.program(CROP_PASS, ["u_p", "u_srcSize", "u_rect", "u_rot", "u_outSize", "u_flipY"]);

    // Float data textures (sampled with texelFetch only: no filtering needed).
    this.curveTex = this.dataTexture2D(CURVE_SAMPLES, 1, new Float32Array(CURVE_SAMPLES * 3));
    this.lutTex1 = this.dataTexture2D(2, 1, new Float32Array(6));
    this.lutTex3 = this.dataTexture3D(2, new Float32Array(24));

    // Full-screen triangle pair.
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const p of [this.point, this.blur, this.down, this.final, this.cropProg]) {
      const loc = gl.getAttribLocation(p.prog, "a_pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
  }

  get size() {
    return { width: this.width, height: this.height };
  }

  /**
   * Uploads the 8-bit sRGB preview (ImageBitmap or decoded <img>). Pixels are
   * used exactly as stored: no color-space conversion, no premultiplication.
   */
  setImage(image: TexImageSource, width: number, height: number) {
    const gl = this.gl;
    this.width = width;
    this.height = height;
    if (this.src) gl.deleteTexture(this.src);
    this.src = this.texture(gl.RGBA8, this.width, this.height, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.allocTargets();
  }

  /** Same as setImage, from raw RGBA bytes (tests). */
  setPixels(rgba: Uint8Array, width: number, height: number) {
    const gl = this.gl;
    this.width = width;
    this.height = height;
    if (this.src) gl.deleteTexture(this.src);
    this.src = this.texture(gl.RGBA8, width, height, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    this.allocTargets();
  }

  /** LUT referenced by the recipe (parsed `.cube`), or null. */
  setLut(lut: Lut | null) {
    if (lut === this.lut) return;
    this.lut = lut;
    this.lutVersion++;
    if (!lut) return;
    const gl = this.gl;
    if (lut.kind === "3d") {
      gl.deleteTexture(this.lutTex3);
      this.lutTex3 = this.dataTexture3D(lut.size, lut.data);
    } else {
      gl.deleteTexture(this.lutTex1);
      this.lutTex1 = this.dataTexture2D(lut.size, 1, lut.data);
    }
  }

  /** Crop shown for these options. */
  cropFor(recipe: Recipe, opts: RenderOptions = {}): CropView {
    if (opts.bypass) return NO_CROP;
    return opts.crop ?? recipe.crop;
  }

  /** Output size in pixels (after crop) for these options. */
  outputSize(recipe: Recipe, opts: RenderOptions = {}): [number, number] {
    return cropSize(this.cropFor(recipe, opts), this.width, this.height);
  }

  /** Renders to the canvas (drawing buffer sized to the cropped output). */
  render(recipe: Recipe, opts: RenderOptions = {}) {
    if (!this.src) return;
    const { canvas } = this;
    const [w, h] = this.outputSize(recipe, opts);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    this.runPasses(recipe, opts);
    this.drawCrop(this.cropFor(recipe, opts), null, w, h, true);
  }

  /**
   * Renders into an offscreen 8-bit target and returns its pixels, top row
   * first. `maxSide` subsamples the output (cheap histograms).
   */
  readPixels(recipe: Recipe, opts: RenderOptions = {}, maxSide?: number): {
    pixels: Uint8Array;
    width: number;
    height: number;
  } {
    const gl = this.gl;
    let [w, h] = this.outputSize(recipe, opts);
    if (maxSide && Math.max(w, h) > maxSide) {
      const s = maxSide / Math.max(w, h);
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
    }
    this.runPasses(recipe, opts);
    const key = `out${w}x${h}`;
    const t = (this.targets[key] ??= this.target(gl.RGBA8, w, h, gl.NEAREST));
    this.drawCrop(this.cropFor(recipe, opts), t, w, h, false);
    const pixels = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { pixels, width: w, height: h };
  }

  dispose() {
    const gl = this.gl;
    for (const t of Object.values(this.targets)) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    this.targets = {};
    if (this.src) gl.deleteTexture(this.src);
    this.src = null;
    // No loseContext(): the same canvas may get a new renderer (React remounts),
    // and getContext() would hand back the lost context.
  }

  // ── passes ──────────────────────────────────────────────────────────────

  private lastPassKey = "";

  /** Steps 1–12 into P (whole photo). Skipped when nothing relevant changed. */
  private runPasses(recipe: Recipe, opts: RenderOptions) {
    const { crop: _crop, ...rest } = recipe;
    const key = JSON.stringify([rest, !!opts.bypass, this.width, this.height, this.lutVersion]);
    if (key === this.lastPassKey) return;
    this.lastPassKey = key;

    const gl = this.gl;
    const { light, color, presence } = recipe;
    const bypass = !!opts.bypass;
    const A = this.targets.A;

    // Curve table (only rebuilt when the curve changes).
    const curveOn = !curvesIdentity(recipe.curve);
    const curveKey = JSON.stringify(recipe.curve);
    if (curveOn && curveKey !== this.curveKey) {
      this.curveKey = curveKey;
      const rgba = curveTable(recipe.curve, CURVE_SAMPLES);
      const rgb = new Float32Array(CURVE_SAMPLES * 3);
      for (let i = 0; i < CURVE_SAMPLES; i++) rgb.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, CURVE_SAMPLES, 1, gl.RGB, gl.FLOAT, rgb);
    }
    const hslOn = !hslIsNeutral(recipe.hsl);

    // Pass A
    this.use(this.point, A);
    this.bindTex(0, this.src!);
    this.bindTex(1, this.curveTex);
    const u = this.point.u;
    gl.uniform1i(u.u_src, 0);
    gl.uniform1i(u.u_curve, 1);
    gl.uniform3fv(u.u_gains, whiteBalanceGains(color.temperature, color.tint));
    gl.uniform1f(u.u_exposure, light.exposure);
    gl.uniform1f(u.u_whites, light.whites);
    gl.uniform1f(u.u_blacks, light.blacks);
    gl.uniform1f(u.u_shadows, light.shadows);
    gl.uniform1f(u.u_highlights, light.highlights);
    gl.uniform1f(u.u_contrast, light.contrast);
    gl.uniform1f(u.u_vibrance, color.vibrance);
    gl.uniform1f(u.u_saturation, color.saturation);
    gl.uniform1i(u.u_bypass, bypass ? 1 : 0);
    gl.uniform1i(u.u_encoded8, this.floatTargets ? 0 : 1);
    gl.uniform1i(u.u_hslOn, hslOn ? 1 : 0);
    gl.uniform3fv(u.u_hsl, hslVectors(recipe.hsl).flat());
    gl.uniform1i(u.u_curveOn, curveOn ? 1 : 0);
    this.draw();

    if (!bypass) {
      const side = Math.max(this.width, this.height);
      if (presence.sharpness !== 0) {
        this.gaussian(A, true, this.targets.S1, this.targets.S2, (1 * side) / 2048);
      }
      if (presence.clarity !== 0) {
        const D = this.targets.D;
        this.use(this.down, D);
        this.bindTex(0, A.tex);
        gl.uniform1i(this.down.u.u_in, 0);
        gl.uniform1i(this.down.u.u_factor, this.factor);
        gl.uniform2i(this.down.u.u_srcSize, this.width, this.height);
        this.draw();
        this.gaussian(D, false, this.targets.D1, this.targets.D2, (20 * side) / 2048 / this.factor);
      }
    }

    // Final pass → P
    const f = this.final.u;
    this.use(this.final, this.targets.P);
    this.bindTex(0, A.tex);
    this.bindTex(1, this.targets.S2.tex);
    this.bindTex(2, this.targets.D2.tex);
    this.bindTex(3, this.lutTex1);
    this.bindTex(4, this.lutTex3, gl.TEXTURE_3D);
    gl.uniform1i(f.u_a, 0);
    gl.uniform1i(f.u_sharpBlur, 1);
    gl.uniform1i(f.u_clarBlur, 2);
    gl.uniform1i(f.u_lut1, 3);
    gl.uniform1i(f.u_lut3, 4);
    gl.uniform2f(f.u_srcSize, this.width, this.height);
    gl.uniform1i(f.u_bypass, bypass ? 1 : 0);
    gl.uniform1i(f.u_encoded8, this.floatTargets ? 0 : 1);
    gl.uniform1f(f.u_sharpness, presence.sharpness);
    gl.uniform1f(f.u_clarity, presence.clarity);
    gl.uniform1f(f.u_vignette, presence.vignette);
    const lut = recipe.lut && this.lut ? this.lut : null;
    gl.uniform1i(f.u_lutMode, lut ? (lut.kind === "3d" ? 3 : 1) : 0);
    gl.uniform1i(f.u_lutSize, lut?.size ?? 2);
    gl.uniform3fv(f.u_lutMin, lut?.domainMin ?? [0, 0, 0]);
    gl.uniform3fv(f.u_lutMax, lut?.domainMax ?? [1, 1, 1]);
    gl.uniform1f(f.u_lutIntensity, recipe.lut?.intensity ?? 0);
    this.draw();
  }

  private gaussian(input: Target, fromAlpha: boolean, tmp: Target, out: Target, sigma: number) {
    const gl = this.gl;
    const radius = Math.min(MAX_RADIUS, Math.ceil(3 * sigma));
    const u = this.blur.u;
    for (const [src, dst, dir] of [
      [input, tmp, [1, 0]],
      [tmp, out, [0, 1]],
    ] as const) {
      this.use(this.blur, dst);
      this.bindTex(0, src.tex);
      gl.uniform1i(u.u_in, 0);
      gl.uniform1i(u.u_fromAlpha, src === input && fromAlpha ? 1 : 0);
      gl.uniform2i(u.u_dir, dir[0], dir[1]);
      gl.uniform2i(u.u_size, src.w, src.h);
      gl.uniform1f(u.u_sigma, sigma);
      gl.uniform1i(u.u_radius, radius);
      this.draw();
    }
  }

  /** Step 13 from P into the canvas (`target` null) or an offscreen target. */
  private drawCrop(crop: CropView, target: Target | null, w: number, h: number, flipY: boolean) {
    const gl = this.gl;
    gl.useProgram(this.cropProg.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    this.bindTex(0, this.targets.P.tex);
    const u = this.cropProg.u;
    const t = (crop.angle * Math.PI) / 180;
    gl.uniform1i(u.u_p, 0);
    gl.uniform2f(u.u_srcSize, this.width, this.height);
    gl.uniform4f(u.u_rect, crop.x, crop.y, crop.w, crop.h);
    gl.uniform2f(u.u_rot, Math.cos(t), Math.sin(t));
    gl.uniform2f(u.u_outSize, w, h);
    gl.uniform1i(u.u_flipY, flipY ? 1 : 0);
    this.draw();
  }

  // ── plumbing ────────────────────────────────────────────────────────────

  private allocTargets() {
    const gl = this.gl;
    for (const t of Object.values(this.targets)) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    const { width: w, height: h } = this;
    const rgba = this.floatTargets ? gl.RGBA16F : gl.RGBA8;
    const one = this.floatTargets ? gl.R16F : gl.RGBA8;
    this.factor = clarityFactor(Math.max(w, h));
    const dw = Math.ceil(w / this.factor);
    const dh = Math.ceil(h / this.factor);
    this.targets = {
      A: this.target(rgba, w, h, gl.NEAREST),
      S1: this.target(one, w, h, gl.NEAREST),
      S2: this.target(one, w, h, gl.NEAREST),
      D: this.target(one, dw, dh, gl.NEAREST),
      D1: this.target(one, dw, dh, gl.NEAREST),
      D2: this.target(one, dw, dh, gl.LINEAR),
      P: this.target(gl.RGBA8, w, h, gl.NEAREST),
    };
    this.lastPassKey = "";
  }

  private texture(format: number, w: number, h: number, filter: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private target(format: number, w: number, h: number, filter: number): Target {
    const gl = this.gl;
    const tex = this.texture(format, w, h, filter);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex, w, h };
  }

  private program(fragment: string, uniforms: string[]): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(`Erro ao compilar o shader: ${gl.getShaderInfoLog(s) ?? "sem detalhes"}. ${this.describe()}`);
      }
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`Erro ao ligar o programa: ${gl.getProgramInfoLog(prog) ?? "sem detalhes"}. ${this.describe()}`);
    }
    const u: Uniforms = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
    return { prog, u };
  }

  /** WebGL details for error messages. */
  private describe(): string {
    const gl = this.gl;
    if (gl.isContextLost()) return "O contexto WebGL foi perdido (driver de vídeo).";
    return `WebGL: ${gl.getParameter(gl.VERSION)}, ${gl.getParameter(gl.RENDERER)}.`;
  }

  private use(p: Program, target: Target) {
    const gl = this.gl;
    gl.useProgram(p.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
  }

  private bindTex(unit: number, tex: WebGLTexture, kind?: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(kind ?? gl.TEXTURE_2D, tex);
  }

  /** RGB32F texture of `w`×`h` texels from RGB triples. */
  private dataTexture2D(w: number, h: number, rgb: Float32Array): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, w, h, 0, gl.RGB, gl.FLOAT, rgb);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    return tex;
  }

  /** RGB32F 3D texture of n³ texels (x = red, y = green, z = blue). */
  private dataTexture3D(n: number, rgb: Float32Array): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F, n, n, n, 0, gl.RGB, gl.FLOAT, rgb);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, gl.NEAREST);
    return tex;
  }

  private draw() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
