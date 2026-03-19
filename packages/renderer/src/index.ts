export interface MeshMaterial {
  name?: string | null;
  baseColorPath?: string | null;
  normalPath?: string | null;
  roughnessPath?: string | null;
  metallicPath?: string | null;
}

export interface MeshData {
  name: string;
  vertices: number[];
  indices: number[];
  uvs?: number[];
  baseColorTex?: Uint8Array | null;
  material?: MeshMaterial | null;
  transform?: { position?: number[]; rotation?: number[]; scale?: number[] };
}
export interface RendererConfig {
  canvas: HTMLCanvasElement;
}

import { createMat4, lookAt, mat4FromTRS, mat4Identity, mat4Mul, perspective } from "./utils/mat4";

class OrbitalCamera {
  theta = Math.PI * 0.25;
  phi = Math.PI * 0.35;
  radius = 0.8;
  target: [number, number, number] = [0, 0.03, 0];
  // Pre-allocated matrices to avoid per-frame allocations
  private _proj = createMat4();
  private _view = createMat4();
  private _vp = createMat4();
  get eye(): [number, number, number] {
    const sp = Math.sin(this.phi);
    const cp = Math.cos(this.phi);
    const st = Math.sin(this.theta);
    const ct = Math.cos(this.theta);
    return [
      this.target[0] + this.radius * sp * ct,
      this.target[1] + this.radius * cp,
      this.target[2] + this.radius * sp * st,
    ];
  }
  orbit(dx: number, dy: number) {
    this.theta -= dx * 0.01;
    this.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.phi - dy * 0.01));
  }
  pan(dx: number, dy: number) {
    const s = this.radius * 0.002;
    const st = Math.sin(this.theta);
    const ct = Math.cos(this.theta);
    this.target[0] += -st * dx * s;
    this.target[1] += dy * s;
    this.target[2] += ct * dx * s;
  }
  zoom(d: number) {
    this.radius = Math.max(0.1, Math.min(20, this.radius * (1 + d * 0.001)));
  }
  viewProj(a: number): Float32Array {
    perspective(this._proj, Math.PI / 6, a, 0.001, 50);
    lookAt(this._view, this.eye, this.target, [0, 1, 0]);
    return mat4Mul(this._vp, this._proj, this._view);
  }
}

function genGrid(size: number, div: number): { v: Float32Array; n: number } {
  const step = size / div;
  const half = size / 2;
  const d: number[] = [];
  for (let i = 0; i <= div; i++) {
    const p = -half + i * step;
    if (Math.abs(p) < 0.001) continue;
    const g = 0.25;
    d.push(-half, 0, p, g, g, g, half, 0, p, g, g, g, p, 0, -half, g, g, g, p, 0, half, g, g, g);
  }
  return { v: new Float32Array(d), n: d.length / 6 };
}

function genAxis(len: number): { v: Float32Array; n: number } {
  const d: number[] = [];
  d.push(0, 0, 0, 1, 0.2, 0.2, len, 0, 0, 1, 0.2, 0.2);
  d.push(0, 0, 0, 0.2, 1, 0.2, 0, len, 0, 0.2, 1, 0.2);
  d.push(0, 0, 0, 0.3, 0.3, 1, 0, 0, len, 0.3, 0.3, 1);
  return { v: new Float32Array(d), n: d.length / 6 };
}

// PBR mesh shader: Cook-Torrance GGX BRDF with 4-channel textures
const MESH_SHADER = `
struct Uniforms { viewProj: mat4x4f, model: mat4x4f, eye_pos: vec3f }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(0) var base_tex: texture_2d<f32>;
@group(1) @binding(1) var normal_tex: texture_2d<f32>;
@group(1) @binding(2) var mat_samp: sampler;
@group(1) @binding(3) var roughness_tex: texture_2d<f32>;
@group(1) @binding(4) var metallic_tex: texture_2d<f32>;

const PI = 3.14159265359;
const MIN_ROUGHNESS = 0.04;
const DIELECTRIC_F0 = vec3f(0.04, 0.04, 0.04);

struct VI {
  @location(0) p: vec3f, @location(1) n: vec3f,
  @location(2) c: vec3f, @location(3) uv: vec2f,
}
struct VO {
  @builtin(position) clip_pos: vec4f,
  @location(0) color: vec3f,
  @location(1) world_normal: vec3f,
  @location(2) uv: vec2f,
  @location(3) world_pos: vec3f,
}

@vertex fn vs(i: VI) -> VO {
  var o: VO;
  let wp = u.model * vec4f(i.p, 1.0);
  o.clip_pos = u.viewProj * wp;
  o.color = i.c;
  o.world_normal = normalize((u.model * vec4f(i.n, 0.0)).xyz);
  o.uv = i.uv;
  o.world_pos = wp.xyz;
  return o;
}

// GGX/Trowbridge-Reitz normal distribution function
fn D_GGX(NdotH: f32, a2: f32) -> f32 {
  let denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * denom * denom);
}

// Smith's geometry function (Schlick-GGX approximation)
fn G_SchlickGGX(NdotX: f32, k: f32) -> f32 {
  return NdotX / (NdotX * (1.0 - k) + k);
}
fn G_Smith(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
  let r1 = roughness + 1.0;
  let k = (r1 * r1) / 8.0;
  return G_SchlickGGX(NdotV, k) * G_SchlickGGX(NdotL, k);
}

// Fresnel-Schlick approximation
fn F_Schlick(cosTheta: f32, F0: vec3f) -> vec3f {
  let t = clamp(1.0 - cosTheta, 0.0, 1.0);
  let t2 = t * t;
  return F0 + (1.0 - F0) * (t2 * t2 * t);
}

@fragment fn fs(i: VO) -> @location(0) vec4f {
  let albedo = textureSample(base_tex, mat_samp, i.uv).rgb;
  let n_sample = textureSample(normal_tex, mat_samp, i.uv).xyz;
  let roughness = max(textureSample(roughness_tex, mat_samp, i.uv).r, MIN_ROUGHNESS);
  let metallic = textureSample(metallic_tex, mat_samp, i.uv).r;

  // Screen-space TBN: compute tangent frame from position/UV derivatives
  let n = normalize(i.world_normal);
  let dp_dx = dpdx(i.world_pos);
  let dp_dy = dpdy(i.world_pos);
  let duv_dx = dpdx(i.uv);
  let duv_dy = dpdy(i.uv);
  let det = duv_dx.x * duv_dy.y - duv_dx.y * duv_dy.x;
  let inv_det = select(1.0 / det, 0.0, abs(det) < 1e-6);
  let t = normalize((dp_dx * duv_dy.y - dp_dy * duv_dx.y) * inv_det);
  let b = normalize((dp_dy * duv_dx.x - dp_dx * duv_dy.x) * inv_det);
  let tbn = mat3x3f(t, b, n);

  // Decompress normal map [0,1] -> [-1,1] and apply TBN
  let n_map = n_sample * 2.0 - 1.0;
  let N = normalize(tbn * n_map);

  let V = normalize(u.eye_pos - i.world_pos);
  let NdotV = max(dot(N, V), 0.001);

  // F0: reflectance at normal incidence (metallic uses albedo, dielectric uses 0.04)
  let F0 = mix(DIELECTRIC_F0, albedo, metallic);

  // Single directional light
  let light_dir = normalize(vec3f(0.5, 1.0, 0.8));
  let light_color = vec3f(1.0, 0.98, 0.95);
  let light_intensity = 2.5;

  let L = light_dir;
  let H = normalize(V + L);
  let NdotL = max(dot(N, L), 0.0);
  let NdotH = max(dot(N, H), 0.0);
  let HdotV = max(dot(H, V), 0.0);

  // Cook-Torrance specular BRDF
  let a2 = roughness * roughness;
  let D = D_GGX(NdotH, a2);
  let G = G_Smith(NdotV, NdotL, roughness);
  let F = F_Schlick(HdotV, F0);

  let spec_num = D * G * F;
  let spec_denom = 4.0 * NdotV * NdotL + 0.0001;
  let specular = spec_num / spec_denom;

  // Diffuse: energy-conserving Lambert (metals have no diffuse)
  let kD = (vec3f(1.0) - F) * (1.0 - metallic);
  let diffuse = kD * albedo / PI;

  let Lo = (diffuse + specular) * light_color * light_intensity * NdotL;

  // Ambient approximation (hemisphere: upper warm, lower cool)
  let ambient_up = vec3f(0.15, 0.15, 0.18);
  let ambient_down = vec3f(0.05, 0.04, 0.03);
  let ambient = mix(ambient_down, ambient_up, dot(N, vec3f(0.0, 1.0, 0.0)) * 0.5 + 0.5);
  let color = Lo + ambient * albedo;

  // Tone mapping (Reinhard) + gamma correction
  let mapped = color / (color + vec3f(1.0));
  let gamma = pow(mapped, vec3f(1.0 / 2.2));

  return vec4f(gamma, 1.0);
}`;

const LINE_SHADER = `
struct Uniforms{viewProj:mat4x4f,model:mat4x4f}
@group(0)@binding(0)var<uniform> u:Uniforms;
struct VI{@location(0)p:vec3f,@location(1)c:vec3f}
struct VO{@builtin(position)p:vec4f,@location(0)c:vec3f}
@vertex fn vs(i:VI)->VO{var o:VO;o.p=u.viewProj*vec4f(i.p,1.0);o.c=i.c;return o;}
@fragment fn fs(i:VO)->@location(0)vec4f{return vec4f(i.c,1.0);}`;

interface GPUMesh {
  name: string;
  vBuf: GPUBuffer;
  iBuf: GPUBuffer;
  iCount: number;
  model: Float32Array;
  texBg: GPUBindGroup; // per-mesh texture bind group (group 1)
  tex?: GPUTexture; // owned texture (destroyed on cleanup)
}

/** Cast typed array to satisfy TS 5.7+ GPUAllowSharedBufferSource constraint.
 *  @webgpu/types defines writeBuffer(data: GPUAllowSharedBufferSource) which
 *  requires ArrayBufferView<ArrayBuffer>, but TS 5.7+ typed arrays use
 *  ArrayBufferView<ArrayBufferLike>. This is a safe narrowing cast. */
// biome-ignore lint/suspicious/noExplicitAny: WebGPU GPUAllowSharedBufferSource requires ArrayBuffer but TS 5.7+ typed arrays use ArrayBufferLike
const gpuData = (data: Float32Array | Uint32Array | Uint16Array): any => data;

/** Interleave pos(3)+normal(3)+color(3) vertices with uv(2) into 11-float stride */
function interleaveWithUVs(vertices: number[], uvs: number[]): Float32Array {
  const vertCount = vertices.length / 9;
  const out = new Float32Array(vertCount * 11);
  for (let i = 0; i < vertCount; i++) {
    // Copy pos + normal + color (9 floats)
    out[i * 11] = vertices[i * 9] as number;
    out[i * 11 + 1] = vertices[i * 9 + 1] as number;
    out[i * 11 + 2] = vertices[i * 9 + 2] as number;
    out[i * 11 + 3] = vertices[i * 9 + 3] as number;
    out[i * 11 + 4] = vertices[i * 9 + 4] as number;
    out[i * 11 + 5] = vertices[i * 9 + 5] as number;
    out[i * 11 + 6] = vertices[i * 9 + 6] as number;
    out[i * 11 + 7] = vertices[i * 9 + 7] as number;
    out[i * 11 + 8] = vertices[i * 9 + 8] as number;
    // Append UV (2 floats)
    if (uvs.length > 0 && i * 2 + 1 < uvs.length) {
      out[i * 11 + 9] = uvs[i * 2] as number;
      out[i * 11 + 10] = uvs[i * 2 + 1] as number;
    }
    // else 0,0 from Float32Array initialization
  }
  return out;
}

export class DarkIronRenderer {
  private dev: GPUDevice | null = null;
  private ctx: GPUCanvasContext | null = null;
  private meshPipe: GPURenderPipeline | null = null;
  private linePipe: GPURenderPipeline | null = null;
  private depthTex: GPUTexture | null = null;
  private uBuf: GPUBuffer | null = null;
  private uniformBg: GPUBindGroup | null = null;
  private texBgl: GPUBindGroupLayout | null = null;
  private defaultTexBg: GPUBindGroup | null = null;
  private defaultTex: GPUTexture | null = null;
  private defaultNormalTex: GPUTexture | null = null;
  private defaultRoughnessTex: GPUTexture | null = null;
  private defaultMetallicTex: GPUTexture | null = null;
  private sampler: GPUSampler | null = null;
  private meshes: GPUMesh[] = [];
  private texCache: Map<string, GPUTexture> = new Map();
  private gridBuf: GPUBuffer | null = null;
  private gridN = 0;
  private axisBuf: GPUBuffer | null = null;
  private axisN = 0;
  private cam = new OrbitalCamera();
  constructor(private config: RendererConfig) {}

  async initialize(): Promise<boolean> {
    if (!navigator.gpu) return false;
    const ad = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!ad) return false;
    this.dev = await ad.requestDevice();
    this.ctx = this.config.canvas.getContext("webgpu") as GPUCanvasContext;
    const fmt = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.dev, format: fmt, alphaMode: "premultiplied" });

    // Uniform buffer: viewProj(64) + model(64) + eye_pos(16) = 144 bytes
    this.uBuf = this.dev.createBuffer({
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Group 0: uniforms
    const uniformBgl = this.dev.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });
    this.uniformBg = this.dev.createBindGroup({
      layout: uniformBgl,
      entries: [{ binding: 0, resource: { buffer: this.uBuf } }],
    });

    // Group 1: PBR textures (per-mesh): base_color + normal + sampler + roughness + metallic
    this.texBgl = this.dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      ],
    });

    // Shared sampler (linear filtering, repeat wrap)
    this.sampler = this.dev.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });

    // Default 1x1 white texture for meshes without base color
    this.defaultTex = this.dev.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.dev.queue.writeTexture(
      { texture: this.defaultTex },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );

    // Default 1x1 flat normal texture (0.5, 0.5, 1.0 = no perturbation in tangent space)
    this.defaultNormalTex = this.dev.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.dev.queue.writeTexture(
      { texture: this.defaultNormalTex },
      new Uint8Array([128, 128, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );

    // Default 1x1 roughness texture (0.5 = mid roughness)
    this.defaultRoughnessTex = this.dev.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.dev.queue.writeTexture(
      { texture: this.defaultRoughnessTex },
      new Uint8Array([128, 128, 128, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );

    // Default 1x1 metallic texture (0.0 = dielectric / non-metal)
    this.defaultMetallicTex = this.dev.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.dev.queue.writeTexture(
      { texture: this.defaultMetallicTex },
      new Uint8Array([0, 0, 0, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );

    this.defaultTexBg = this.dev.createBindGroup({
      layout: this.texBgl,
      entries: [
        { binding: 0, resource: this.defaultTex.createView() },
        { binding: 1, resource: this.defaultNormalTex.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: this.defaultRoughnessTex.createView() },
        { binding: 4, resource: this.defaultMetallicTex.createView() },
      ],
    });

    // Mesh pipeline: 2 bind group layouts (uniform + texture)
    const meshLayout = this.dev.createPipelineLayout({
      bindGroupLayouts: [uniformBgl, this.texBgl],
    });
    const ms = this.dev.createShaderModule({ code: MESH_SHADER });
    this.meshPipe = this.dev.createRenderPipeline({
      layout: meshLayout,
      vertex: {
        module: ms,
        entryPoint: "vs",
        buffers: [
          {
            arrayStride: 44, // 11 floats: pos(3) + normal(3) + color(3) + uv(2)
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" }, // position
              { shaderLocation: 1, offset: 12, format: "float32x3" }, // normal
              { shaderLocation: 2, offset: 24, format: "float32x3" }, // color
              { shaderLocation: 3, offset: 36, format: "float32x2" }, // uv
            ],
          },
        ],
      },
      fragment: { module: ms, entryPoint: "fs", targets: [{ format: fmt }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });

    // Line pipeline: only uniform bind group
    const lineLayout = this.dev.createPipelineLayout({ bindGroupLayouts: [uniformBgl] });
    const ls = this.dev.createShaderModule({ code: LINE_SHADER });
    this.linePipe = this.dev.createRenderPipeline({
      layout: lineLayout,
      vertex: {
        module: ls,
        entryPoint: "vs",
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
            ],
          },
        ],
      },
      fragment: { module: ls, entryPoint: "fs", targets: [{ format: fmt }] },
      primitive: { topology: "line-list" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });

    const grid = genGrid(1, 20);
    this.gridBuf = this.dev.createBuffer({
      size: grid.v.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.dev.queue.writeBuffer(this.gridBuf, 0, gpuData(grid.v));
    this.gridN = grid.n;
    const axis = genAxis(0.2);
    this.axisBuf = this.dev.createBuffer({
      size: axis.v.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.dev.queue.writeBuffer(this.axisBuf, 0, gpuData(axis.v));
    this.axisN = axis.n;
    this.depthTex = this.dev.createTexture({
      size: [this.config.canvas.width, this.config.canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const c = this.config.canvas;
    let drag = false;
    let btn = 0;
    let lx = 0;
    let ly = 0;
    c.addEventListener("mousedown", (e) => {
      drag = true;
      btn = e.button;
      lx = e.clientX;
      ly = e.clientY;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      if (btn === 0) this.cam.orbit(dx, dy);
      else this.cam.pan(dx, dy);
    });
    window.addEventListener("mouseup", () => {
      drag = false;
    });
    c.addEventListener(
      "wheel",
      (e) => {
        this.cam.zoom(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    console.log("[DarkIron Renderer] Initialized (WebGPU)");
    return true;
  }

  get meshCount(): number {
    return this.meshes.length;
  }

  /** Create a GPU texture from raw JPEG/PNG bytes */
  private async createTextureFromBytes(bytes: Uint8Array): Promise<GPUTexture | null> {
    if (!this.dev) return null;
    try {
      const blob = new Blob([new Uint8Array(bytes)]);
      const bitmap = await createImageBitmap(blob);
      const tex = this.dev.createTexture({
        size: [bitmap.width, bitmap.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.dev.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [
        bitmap.width,
        bitmap.height,
      ]);
      bitmap.close();
      return tex;
    } catch (err) {
      console.warn("[DarkIron Renderer] Failed to decode texture:", err);
      return null;
    }
  }

  /** Fetch a texture by URL with caching (shared textures are fetched once) */
  private async getTextureByURL(url: string): Promise<GPUTexture | null> {
    if (!this.dev) return null;
    const cached = this.texCache.get(url);
    if (cached) return cached;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const tex = this.dev.createTexture({
        size: [bitmap.width, bitmap.height],
        format: "rgba8unorm",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.dev.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [
        bitmap.width,
        bitmap.height,
      ]);
      bitmap.close();
      this.texCache.set(url, tex);
      return tex;
    } catch (err) {
      console.warn(`[DarkIron Renderer] Failed to fetch texture ${url}:`, err);
      return null;
    }
  }

  async uploadMesh(mesh: MeshData): Promise<void> {
    if (!this.dev || !this.texBgl || !this.sampler || !this.defaultTexBg)
      throw new Error("Not init");

    // Interleave vertices with UVs into 11-float stride
    const v = interleaveWithUVs(mesh.vertices, mesh.uvs ?? []);
    const idx = new Uint32Array(mesh.indices);

    const vBuf = this.dev.createBuffer({
      size: v.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.dev.queue.writeBuffer(vBuf, 0, gpuData(v));
    const iBuf = this.dev.createBuffer({
      size: idx.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.dev.queue.writeBuffer(iBuf, 0, gpuData(idx));

    const t = mesh.transform || {};
    const pos = t.position || [0, 0, 0];
    const rot = t.rotation || [0, 0, 0];
    const scl = t.scale || [1, 1, 1];
    const model = mat4FromTRS(createMat4(), pos, rot, scl);

    // Create per-mesh texture bind group — prefer material paths over raw bytes
    let tex: GPUTexture | undefined;
    let texBg = this.defaultTexBg;
    let isCachedTex = false;

    // Resolve base color texture
    let baseTex: GPUTexture | null = null;
    if (mesh.material?.baseColorPath) {
      baseTex = await this.getTextureByURL(`/textures/${mesh.material.baseColorPath}`);
      if (baseTex) isCachedTex = true;
    } else if (mesh.baseColorTex && mesh.baseColorTex.byteLength > 0) {
      const gpuTex = await this.createTextureFromBytes(mesh.baseColorTex);
      if (gpuTex) {
        tex = gpuTex;
        baseTex = gpuTex;
      }
    }

    // Resolve normal map texture
    let normalTex: GPUTexture | null = null;
    if (mesh.material?.normalPath) {
      normalTex = await this.getTextureByURL(`/textures/${mesh.material.normalPath}`);
    }

    // Resolve roughness texture
    let roughnessTex: GPUTexture | null = null;
    if (mesh.material?.roughnessPath) {
      roughnessTex = await this.getTextureByURL(`/textures/${mesh.material.roughnessPath}`);
    }

    // Resolve metallic texture
    let metallicTex: GPUTexture | null = null;
    if (mesh.material?.metallicPath) {
      metallicTex = await this.getTextureByURL(`/textures/${mesh.material.metallicPath}`);
    }

    // Build bind group if we have at least a base color texture
    if (baseTex) {
      texBg = this.dev.createBindGroup({
        layout: this.texBgl,
        entries: [
          { binding: 0, resource: baseTex.createView() },
          {
            binding: 1,
            resource: (normalTex ?? (this.defaultNormalTex as GPUTexture)).createView(),
          },
          { binding: 2, resource: this.sampler },
          {
            binding: 3,
            resource: (roughnessTex ?? (this.defaultRoughnessTex as GPUTexture)).createView(),
          },
          {
            binding: 4,
            resource: (metallicTex ?? (this.defaultMetallicTex as GPUTexture)).createView(),
          },
        ],
      });
    }

    const ex = this.meshes.findIndex((m) => m.name === mesh.name);
    if (ex >= 0) {
      const old = this.meshes[ex] as GPUMesh;
      old.vBuf.destroy();
      old.iBuf.destroy();
      old.tex?.destroy(); // Only destroys non-cached textures
      this.meshes[ex] = {
        name: mesh.name,
        vBuf,
        iBuf,
        iCount: idx.length,
        model,
        texBg,
        tex: isCachedTex ? undefined : tex,
      };
    } else {
      this.meshes.push({
        name: mesh.name,
        vBuf,
        iBuf,
        iCount: idx.length,
        model,
        texBg,
        tex: isCachedTex ? undefined : tex,
      });
    }
    const hasTex = tex ? " [textured]" : "";
    console.log(
      `[DarkIron Renderer] Mesh: ${mesh.name} (${idx.length} idx, ${this.meshes.length} total)${hasTex}`,
    );
  }

  clearMeshes(): void {
    for (const m of this.meshes) {
      m.vBuf.destroy();
      m.iBuf.destroy();
      m.tex?.destroy();
    }
    this.meshes = [];
    // Destroy cached textures
    for (const tex of this.texCache.values()) tex.destroy();
    this.texCache.clear();
  }

  render(): void {
    if (
      !this.dev ||
      !this.ctx ||
      !this.meshPipe ||
      !this.linePipe ||
      !this.depthTex ||
      !this.uBuf ||
      !this.uniformBg
    )
      return;
    const vp = this.cam.viewProj(this.config.canvas.width / this.config.canvas.height);
    const enc = this.dev.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          clearValue: { r: 0.08, g: 0.08, b: 0.1, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTex.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    const eye = this.cam.eye;
    this.dev.queue.writeBuffer(this.uBuf, 0, gpuData(vp));
    this.dev.queue.writeBuffer(this.uBuf, 64, gpuData(mat4Identity(createMat4())));
    this.dev.queue.writeBuffer(
      this.uBuf,
      128,
      gpuData(new Float32Array([eye[0], eye[1], eye[2], 0])),
    );
    if (this.gridBuf) {
      pass.setPipeline(this.linePipe);
      pass.setBindGroup(0, this.uniformBg);
      pass.setVertexBuffer(0, this.gridBuf);
      pass.draw(this.gridN);
    }
    if (this.axisBuf) {
      pass.setPipeline(this.linePipe);
      pass.setBindGroup(0, this.uniformBg);
      pass.setVertexBuffer(0, this.axisBuf);
      pass.draw(this.axisN);
    }
    for (const m of this.meshes) {
      this.dev.queue.writeBuffer(this.uBuf, 64, gpuData(m.model));
      pass.setPipeline(this.meshPipe);
      pass.setBindGroup(0, this.uniformBg);
      pass.setBindGroup(1, m.texBg);
      pass.setVertexBuffer(0, m.vBuf);
      pass.setIndexBuffer(m.iBuf, "uint32");
      pass.drawIndexed(m.iCount);
    }
    pass.end();
    this.dev.queue.submit([enc.finish()]);
  }

  destroy(): void {
    this.clearMeshes();
    this.uBuf?.destroy();
    this.depthTex?.destroy();
    this.gridBuf?.destroy();
    this.axisBuf?.destroy();
    this.defaultTex?.destroy();
    this.defaultNormalTex?.destroy();
    this.defaultRoughnessTex?.destroy();
    this.defaultMetallicTex?.destroy();
    this.dev?.destroy();
    console.log("[DarkIron Renderer] Destroyed");
  }
}
