export interface MaterialInfo {
  name?: string;
  base_color_tex?: string;  // relative path e.g. "Bishop/tex/bishop_black_base_color.jpg"
}

/** Vertex data: pos(3) + normal(3) + color(3) = 9 floats per vertex. */
type VertexArray = Float32Array | number[];
/** Index data: uint32 per index. */
type IndexArray = Uint32Array | number[];

export interface MeshData {
  name: string;
  vertices: VertexArray;
  indices: IndexArray;
  uvs?: Float32Array | number[];       // flat u,v pairs — 2 floats per vertex
  material?: MaterialInfo;
  transform?: { position?: number[]; rotation?: number[]; scale?: number[] };
}

export interface RendererConfig {
  canvas: HTMLCanvasElement;
  textureBasePath?: string;  // default: "/textures/OpenChessSet/"
}

import { createMat4, lookAt, perspective, mat4Mul, mat4Identity, mat4FromTRS } from "./utils/mat4";

class OrbitalCamera {
  theta = Math.PI * 0.25;
  phi = Math.PI * 0.35;
  radius = 0.8;
  target = [0, 0.03, 0];
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

// ─── Shaders ─────────────────────────────────────────────────────

const MESH_SHADER = `
struct Uniforms { viewProj: mat4x4f, model: mat4x4f }
@group(0) @binding(0) var<uniform> u: Uniforms;

struct MaterialFlags { use_base_color_tex: u32 }
@group(1) @binding(0) var<uniform> mat: MaterialFlags;
@group(1) @binding(1) var base_color_tex: texture_2d<f32>;
@group(1) @binding(2) var base_color_sampler: sampler;

struct VI {
  @location(0) p: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) c: vec3f,
}
struct VO {
  @builtin(position) p: vec4f,
  @location(0) n: vec3f,
  @location(1) uv: vec2f,
  @location(2) c: vec3f,
}

@vertex fn vs(i: VI) -> VO {
  var o: VO;
  let wp = u.model * vec4f(i.p, 1.0);
  o.p = u.viewProj * wp;
  o.n = normalize((u.model * vec4f(i.n, 0.0)).xyz);
  o.uv = i.uv;
  o.c = i.c;
  return o;
}

@fragment fn fs(i: VO) -> @location(0) vec4f {
  var bc: vec3f;
  if (mat.use_base_color_tex == 1u) {
    bc = textureSample(base_color_tex, base_color_sampler, i.uv).rgb;
  } else {
    bc = i.c;
  }
  let ld = normalize(vec3f(0.5, 1.0, 0.8));
  let lit = 0.15 + max(dot(normalize(i.n), ld), 0.0) * 0.85;
  return vec4f(bc * lit, 1.0);
}`;

const LINE_SHADER = `
struct Uniforms{viewProj:mat4x4f,model:mat4x4f}
@group(0)@binding(0)var<uniform> u:Uniforms;
struct VI{@location(0)p:vec3f,@location(1)c:vec3f}
struct VO{@builtin(position)p:vec4f,@location(0)c:vec3f}
@vertex fn vs(i:VI)->VO{var o:VO;o.p=u.viewProj*vec4f(i.p,1.0);o.c=i.c;return o;}
@fragment fn fs(i:VO)->@location(0)vec4f{return vec4f(i.c,1.0);}`;

// ─── Types ───────────────────────────────────────────────────────

interface GPUMesh {
  name: string;
  vBuf: GPUBuffer;
  iBuf: GPUBuffer;
  iCount: number;
  model: Float32Array;
  matBindGroup: GPUBindGroup;
}

// ─── Renderer ────────────────────────────────────────────────────

export class DarkIronRenderer {
  private dev: GPUDevice | null = null;
  private ctx: GPUCanvasContext | null = null;
  private meshPipe: GPURenderPipeline | null = null;
  private linePipe: GPURenderPipeline | null = null;
  private depthTex: GPUTexture | null = null;
  private uBuf: GPUBuffer | null = null;
  private camBG: GPUBindGroup | null = null;
  private meshes: GPUMesh[] = [];
  private gridBuf: GPUBuffer | null = null;
  private gridN = 0;
  private axisBuf: GPUBuffer | null = null;
  private axisN = 0;
  private cam = new OrbitalCamera();

  // Material resources
  private matBGL: GPUBindGroupLayout | null = null;
  private sampler: GPUSampler | null = null;
  private fallbackTex: GPUTexture | null = null;
  private fallbackView: GPUTextureView | null = null;
  private fallbackBG: GPUBindGroup | null = null;
  private texCache = new Map<string, GPUTextureView>();
  private texBasePath: string;

  constructor(private config: RendererConfig) {
    this.texBasePath = config.textureBasePath ?? "/textures/OpenChessSet/";
  }

  async initialize(): Promise<boolean> {
    if (!navigator.gpu) return false;
    const ad = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!ad) return false;
    this.dev = await ad.requestDevice();
    this.ctx = this.config.canvas.getContext("webgpu") as GPUCanvasContext;
    const fmt = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.dev, format: fmt, alphaMode: "premultiplied" });

    // ── Uniform buffer (viewProj + model) ──
    this.uBuf = this.dev.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ── Bind group 0: camera uniforms ──
    const camBGL = this.dev.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });
    this.camBG = this.dev.createBindGroup({
      layout: camBGL,
      entries: [{ binding: 0, resource: { buffer: this.uBuf } }],
    });

    // ── Bind group 1: material (flags + texture + sampler) ──
    this.matBGL = this.dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
      ],
    });

    // ── Shared sampler ──
    this.sampler = this.dev.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });

    // ── 1x1 white fallback texture (for meshes without textures) ──
    this.fallbackTex = this.dev.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.dev.queue.writeTexture(
      { texture: this.fallbackTex },
      new Uint8Array([255, 255, 255, 255]),
      { bytesPerRow: 4 },
      [1, 1],
    );
    this.fallbackView = this.fallbackTex.createView();

    // ── Fallback bind group (vertex color mode) ──
    const fallbackFlagBuf = this.dev.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.dev.queue.writeBuffer(fallbackFlagBuf, 0, new Uint32Array([0])); // 0 = use vertex color
    this.fallbackBG = this.dev.createBindGroup({
      layout: this.matBGL,
      entries: [
        { binding: 0, resource: { buffer: fallbackFlagBuf } },
        { binding: 1, resource: this.fallbackView },
        { binding: 2, resource: this.sampler },
      ],
    });

    // ── Pipeline layout (2 bind groups) ──
    const pipeLayout = this.dev.createPipelineLayout({ bindGroupLayouts: [camBGL, this.matBGL] });

    // ── Mesh pipeline (new vertex format: pos3 + normal3 + uv2 + color3 = 44 bytes) ──
    const ms = this.dev.createShaderModule({ code: MESH_SHADER });
    this.meshPipe = this.dev.createRenderPipeline({
      layout: pipeLayout,
      vertex: {
        module: ms,
        entryPoint: "vs",
        buffers: [
          {
            arrayStride: 44,  // 11 floats * 4 bytes
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },   // position
              { shaderLocation: 1, offset: 12, format: "float32x3" },  // normal
              { shaderLocation: 2, offset: 24, format: "float32x2" },  // uv
              { shaderLocation: 3, offset: 32, format: "float32x3" },  // color
            ],
          },
        ],
      },
      fragment: { module: ms, entryPoint: "fs", targets: [{ format: fmt }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });

    // ── Line pipeline (unchanged, uses its own layout) ──
    const lineBGL = this.dev.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });
    const lineLayout = this.dev.createPipelineLayout({ bindGroupLayouts: [lineBGL] });
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

    // ── Grid + Axis ──
    const grid = genGrid(1, 20);
    this.gridBuf = this.dev.createBuffer({
      size: grid.v.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.dev.queue.writeBuffer(this.gridBuf, 0, grid.v);
    this.gridN = grid.n;

    const axis = genAxis(0.2);
    this.axisBuf = this.dev.createBuffer({
      size: axis.v.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.dev.queue.writeBuffer(this.axisBuf, 0, axis.v);
    this.axisN = axis.n;

    // ── Depth ──
    this.depthTex = this.dev.createTexture({
      size: [this.config.canvas.width, this.config.canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // ── Input handlers ──
    const c = this.config.canvas;
    let drag = false;
    let btn = 0;
    let lx = 0;
    let ly = 0;
    c.addEventListener("mousedown", (e) => {
      drag = true; btn = e.button; lx = e.clientX; ly = e.clientY; e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      const dx = e.clientX - lx; const dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (btn === 0) this.cam.orbit(dx, dy); else this.cam.pan(dx, dy);
    });
    window.addEventListener("mouseup", () => { drag = false; });
    c.addEventListener("wheel", (e) => { this.cam.zoom(e.deltaY); e.preventDefault(); }, { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());

    console.log("[DarkIron Renderer] Initialized (WebGPU + PBR base_color)");
    return true;
  }

  // ── Texture loading ──────────────────────────────────────────
  private async loadTexture(relPath: string): Promise<GPUTextureView> {
    if (this.texCache.has(relPath)) return this.texCache.get(relPath)!;
    if (!this.dev) throw new Error("Not init");

    const url = this.texBasePath + relPath;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none" });

      const tex = this.dev.createTexture({
        size: [bitmap.width, bitmap.height],
        format: "rgba8unorm-srgb",  // Gemini: sRGB for base color!
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      this.dev.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: tex },
        [bitmap.width, bitmap.height],
      );
      bitmap.close();

      const view = tex.createView();
      this.texCache.set(relPath, view);
      console.log(`[Renderer] Loaded texture: ${relPath} (${bitmap.width}x${bitmap.height})`);
      return view;
    } catch (e) {
      console.warn(`[Renderer] Failed to load texture: ${url}`, e);
      return this.fallbackView!;
    }
  }

  private createMatBindGroup(flagValue: number, texView: GPUTextureView): GPUBindGroup {
    if (!this.dev || !this.matBGL || !this.sampler) throw new Error("Not init");
    const flagBuf = this.dev.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.dev.queue.writeBuffer(flagBuf, 0, new Uint32Array([flagValue]));
    return this.dev.createBindGroup({
      layout: this.matBGL,
      entries: [
        { binding: 0, resource: { buffer: flagBuf } },
        { binding: 1, resource: texView },
        { binding: 2, resource: this.sampler },
      ],
    });
  }

  // ── Mesh upload ──────────────────────────────────────────────
  get meshCount(): number { return this.meshes.length; }

  async uploadMesh(mesh: MeshData): Promise<void> {
    if (!this.dev) throw new Error("Not init");

    // Interleave vertex data: pos(3)+normal(3)+color(3) + separate UVs -> pos(3)+normal(3)+uv(2)+color(3)
    // Input may be Float32Array (from FlatBuffers) or number[] (from JSON fallback).
    const src = mesh.vertices;
    const uvs = mesh.uvs;
    const hasUVs = uvs != null && uvs.length > 0;
    const vertCount = src.length / 9;
    const interleaved = new Float32Array(vertCount * 11);

    for (let i = 0; i < vertCount; i++) {
      const si = i * 9;
      const di = i * 11;
      // position (3)
      interleaved[di]     = src[si]!;
      interleaved[di + 1] = src[si + 1]!;
      interleaved[di + 2] = src[si + 2]!;
      // normal (3)
      interleaved[di + 3] = src[si + 3]!;
      interleaved[di + 4] = src[si + 4]!;
      interleaved[di + 5] = src[si + 5]!;
      // uv (2)
      if (hasUVs) {
        interleaved[di + 6] = uvs[i * 2]!;
        interleaved[di + 7] = uvs[i * 2 + 1]!;
      }
      // color (3)
      interleaved[di + 8]  = src[si + 6]!;
      interleaved[di + 9]  = src[si + 7]!;
      interleaved[di + 10] = src[si + 8]!;
    }

    // Skip copy if indices are already a Uint32Array (from FlatBuffers path).
    const idx = mesh.indices instanceof Uint32Array ? mesh.indices : new Uint32Array(mesh.indices);
    const vBuf = this.dev.createBuffer({
      size: interleaved.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.dev.queue.writeBuffer(vBuf, 0, interleaved);

    const iBuf = this.dev.createBuffer({
      size: idx.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.dev.queue.writeBuffer(iBuf, 0, idx);

    const t = mesh.transform || {};
    const pos = t.position || [0, 0, 0];
    const rot = t.rotation || [0, 0, 0];
    const scl = t.scale || [1, 1, 1];
    const model = mat4FromTRS(createMat4(), pos, rot, scl);

    // Material bind group
    let matBindGroup: GPUBindGroup;
    if (mesh.material?.base_color_tex) {
      const texView = await this.loadTexture(mesh.material.base_color_tex);
      matBindGroup = this.createMatBindGroup(1, texView);  // 1 = use texture
    } else {
      matBindGroup = this.fallbackBG!;  // 0 = use vertex color
    }

    const ex = this.meshes.findIndex((m) => m.name === mesh.name);
    if (ex >= 0) {
      this.meshes[ex].vBuf.destroy();
      this.meshes[ex].iBuf.destroy();
      this.meshes[ex] = { name: mesh.name, vBuf, iBuf, iCount: idx.length, model, matBindGroup };
    } else {
      this.meshes.push({ name: mesh.name, vBuf, iBuf, iCount: idx.length, model, matBindGroup });
    }
    console.log(
      `[Renderer] Mesh: ${mesh.name} (${idx.length} idx, tex: ${!!mesh.material?.base_color_tex}, ${this.meshes.length} total)`,
    );
  }

  clearMeshes(): void {
    for (const m of this.meshes) {
      m.vBuf.destroy();
      m.iBuf.destroy();
    }
    this.meshes = [];
  }

  // ── Render loop ──────────────────────────────────────────────
  render(): void {
    if (!this.dev || !this.ctx || !this.meshPipe || !this.linePipe ||
        !this.depthTex || !this.uBuf || !this.camBG) return;

    const vp = this.cam.viewProj(this.config.canvas.width / this.config.canvas.height);
    const enc = this.dev.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.ctx.getCurrentTexture().createView(),
        clearValue: { r: 0.08, g: 0.08, b: 0.1, a: 1 },
        loadOp: "clear", storeOp: "store",
      }],
      depthStencilAttachment: {
        view: this.depthTex.createView(),
        depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store",
      },
    });

    // Grid + Axis (line pipeline, group 0 only)
    this.dev.queue.writeBuffer(this.uBuf, 0, vp);
    this.dev.queue.writeBuffer(this.uBuf, 64, mat4Identity(createMat4()));
    if (this.gridBuf) {
      pass.setPipeline(this.linePipe);
      pass.setBindGroup(0, this.camBG);
      pass.setVertexBuffer(0, this.gridBuf);
      pass.draw(this.gridN);
    }
    if (this.axisBuf) {
      pass.setPipeline(this.linePipe);
      pass.setBindGroup(0, this.camBG);
      pass.setVertexBuffer(0, this.axisBuf);
      pass.draw(this.axisN);
    }

    // Meshes (mesh pipeline, group 0 + group 1)
    pass.setPipeline(this.meshPipe);
    for (const m of this.meshes) {
      this.dev.queue.writeBuffer(this.uBuf, 64, m.model);
      pass.setBindGroup(0, this.camBG);
      pass.setBindGroup(1, m.matBindGroup);
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
    this.fallbackTex?.destroy();
    this.dev?.destroy();
    console.log("[DarkIron Renderer] Destroyed");
  }
}
