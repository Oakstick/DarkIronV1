const fs = require('fs');

const SHADER = `
struct Uniforms {
  viewProj: mat4x4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) normal: vec3f,
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = uniforms.viewProj * vec4f(in.position, 1.0);
  out.color = in.color;
  out.normal = in.normal;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let lightDir = normalize(vec3f(0.5, 1.0, 0.8));
  let ambient = 0.3;
  let diffuse = max(dot(normalize(in.normal), lightDir), 0.0);
  let lit = ambient + diffuse * 0.7;
  return vec4f(in.color * lit, 1.0);
}
`;

const RENDERER = `/**
 * @darkiron/renderer — WebGPU renderer with orbital camera
 */

export interface MeshData {
  name: string;
  vertices: number[];
  indices: number[];
}

export interface RendererConfig {
  canvas: HTMLCanvasElement;
}

// ── Orbital Camera ──────────────────────────────────────────

class OrbitalCamera {
  theta = Math.PI * 0.25;   // horizontal angle
  phi = Math.PI * 0.35;     // vertical angle
  radius = 3.0;
  target = [0, 0, 0];
  
  get eye(): [number, number, number] {
    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const sinTheta = Math.sin(this.theta);
    const cosTheta = Math.cos(this.theta);
    return [
      this.target[0] + this.radius * sinPhi * cosTheta,
      this.target[1] + this.radius * cosPhi,
      this.target[2] + this.radius * sinPhi * sinTheta,
    ];
  }

  orbit(dx: number, dy: number) {
    this.theta -= dx * 0.01;
    this.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.phi - dy * 0.01));
  }

  pan(dx: number, dy: number) {
    const scale = this.radius * 0.002;
    const sinT = Math.sin(this.theta);
    const cosT = Math.cos(this.theta);
    this.target[0] += (-sinT * dx + cosT * 0) * scale;
    this.target[1] += dy * scale;
    this.target[2] += (cosT * dx + sinT * 0) * scale;
  }

  zoom(delta: number) {
    this.radius = Math.max(0.5, Math.min(50, this.radius * (1 + delta * 0.001)));
  }

  viewProjMatrix(aspect: number): Float32Array {
    const eye = this.eye;
    const view = lookAt(eye, this.target as any, [0, 1, 0]);
    const proj = perspective(Math.PI / 4, aspect, 0.01, 100);
    return multiply(proj, view);
  }
}

// ── Math helpers ────────────────────────────────────────────

function lookAt(eye: number[], target: number[], up: number[]): Float32Array {
  const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  const zl = Math.sqrt(zx*zx + zy*zy + zz*zz) || 1;
  const z = [zx/zl, zy/zl, zz/zl];
  const xx = up[1]*z[2] - up[2]*z[1], xy = up[2]*z[0] - up[0]*z[2], xz = up[0]*z[1] - up[1]*z[0];
  const xl = Math.sqrt(xx*xx + xy*xy + xz*xz) || 1;
  const x = [xx/xl, xy/xl, xz/xl];
  const y = [z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]),
    -(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]),
    -(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]),
    1
  ]);
}

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1.0 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * nf, -1,
    0, 0, far * near * nf, 0
  ]);
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      r[j*4+i] = a[i]*b[j*4]+a[4+i]*b[j*4+1]+a[8+i]*b[j*4+2]+a[12+i]*b[j*4+3];
  return r;
}

// ── Shader ──────────────────────────────────────────────────

const SHADER = \`${SHADER.replace(/`/g, '\\`')}\`;

// ── Renderer ────────────────────────────────────────────────

export class DarkIronRenderer {
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private depthTexture: GPUTexture | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private indexCount = 0;
  private camera = new OrbitalCamera();

  constructor(private config: RendererConfig) {}

  async initialize(): Promise<boolean> {
    if (!navigator.gpu) {
      console.error("[DarkIron Renderer] WebGPU not supported");
      return false;
    }

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return false;

    this.device = await adapter.requestDevice();
    this.context = this.config.canvas.getContext("webgpu") as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format, alphaMode: "premultiplied" });

    // Uniform buffer for camera matrices
    this.uniformBuffer = this.device.createBuffer({
      size: 64, // 4x4 matrix
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shaderModule = this.device.createShaderModule({ code: SHADER });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
        buffers: [{
          arrayStride: 9 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32x3" },
          ],
        }],
      },
      fragment: { module: shaderModule, entryPoint: "fs_main", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });

    this.createDepthTexture();
    this.setupMouseControls();
    console.log("[DarkIron Renderer] Initialized (WebGPU)");
    return true;
  }

  private createDepthTexture() {
    if (!this.device) return;
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: [this.config.canvas.width, this.config.canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private setupMouseControls() {
    const canvas = this.config.canvas;
    let isDragging = false;
    let button = 0;
    let lastX = 0, lastY = 0;

    canvas.addEventListener("mousedown", (e) => {
      isDragging = true;
      button = e.button;
      lastX = e.clientX;
      lastY = e.clientY;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (button === 0) this.camera.orbit(dx, dy);       // Left: orbit
      else if (button === 2) this.camera.pan(dx, dy);     // Right: pan
    });

    window.addEventListener("mouseup", () => { isDragging = false; });

    canvas.addEventListener("wheel", (e) => {
      this.camera.zoom(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  uploadMesh(mesh: MeshData): void {
    if (!this.device) throw new Error("Renderer not initialized");

    const vertices = new Float32Array(mesh.vertices);
    const indices = new Uint32Array(mesh.indices);

    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();

    this.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);

    this.indexBuffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.indexBuffer, 0, indices);

    this.indexCount = indices.length;
    console.log(\`[DarkIron Renderer] Uploaded mesh: \${mesh.name} (\${this.indexCount} indices)\`);
  }

  render(): void {
    if (!this.device || !this.context || !this.pipeline) return;
    if (!this.vertexBuffer || !this.indexBuffer || !this.uniformBuffer || !this.bindGroup) return;
    if (!this.depthTexture) return;

    // Update camera
    const aspect = this.config.canvas.width / this.config.canvas.height;
    const viewProj = this.camera.viewProjMatrix(aspect);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, viewProj);

    const encoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.08, g: 0.08, b: 0.10, a: 1.0 },
        loadOp: "clear",
        storeOp: "store",
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.setIndexBuffer(this.indexBuffer, "uint32");
    renderPass.drawIndexed(this.indexCount);
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy();
    this.depthTexture?.destroy();
    this.device?.destroy();
    console.log("[DarkIron Renderer] Destroyed");
  }
}
`;

fs.writeFileSync('D:/DarkIron/darkiron/packages/renderer/src/index.ts', RENDERER);
console.log('Renderer written:', fs.statSync('D:/DarkIron/darkiron/packages/renderer/src/index.ts').size, 'bytes');

