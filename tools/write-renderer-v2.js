const fs = require('fs');

const code = `/**
 * @darkiron/renderer — WebGPU renderer with orbital camera, grid & axis gizmo
 */

export interface MeshData {
  name: string;
  vertices: number[];
  indices: number[];
}

export interface RendererConfig {
  canvas: HTMLCanvasElement;
}

// ── Math helpers ────────────────────────────────────────────

function lookAt(eye: number[], target: number[], up: number[]): Float32Array {
  const zx = eye[0]-target[0], zy = eye[1]-target[1], zz = eye[2]-target[2];
  const zl = Math.sqrt(zx*zx+zy*zy+zz*zz)||1;
  const z = [zx/zl, zy/zl, zz/zl];
  const xx = up[1]*z[2]-up[2]*z[1], xy = up[2]*z[0]-up[0]*z[2], xz = up[0]*z[1]-up[1]*z[0];
  const xl = Math.sqrt(xx*xx+xy*xy+xz*xz)||1;
  const x = [xx/xl, xy/xl, xz/xl];
  const y = [z[1]*x[2]-z[2]*x[1], z[2]*x[0]-z[0]*x[2], z[0]*x[1]-z[1]*x[0]];
  return new Float32Array([
    x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
    -(x[0]*eye[0]+x[1]*eye[1]+x[2]*eye[2]),
    -(y[0]*eye[0]+y[1]*eye[1]+y[2]*eye[2]),
    -(z[0]*eye[0]+z[1]*eye[1]+z[2]*eye[2]), 1
  ]);
}

function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1/Math.tan(fov/2), nf = 1/(near-far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,far*nf,-1, 0,0,far*near*nf,0]);
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const r = new Float32Array(16);
  for (let i=0;i<4;i++) for(let j=0;j<4;j++)
    r[j*4+i]=a[i]*b[j*4]+a[4+i]*b[j*4+1]+a[8+i]*b[j*4+2]+a[12+i]*b[j*4+3];
  return r;
}

// ── Orbital Camera ──────────────────────────────────────────

class OrbitalCamera {
  theta = Math.PI * 0.25;
  phi = Math.PI * 0.35;
  radius = 3.0;
  target = [0, 0, 0];

  get eye(): [number,number,number] {
    const sp=Math.sin(this.phi), cp=Math.cos(this.phi);
    const st=Math.sin(this.theta), ct=Math.cos(this.theta);
    return [
      this.target[0]+this.radius*sp*ct,
      this.target[1]+this.radius*cp,
      this.target[2]+this.radius*sp*st,
    ];
  }

  orbit(dx: number, dy: number) {
    this.theta -= dx*0.01;
    this.phi = Math.max(0.1, Math.min(Math.PI-0.1, this.phi-dy*0.01));
  }

  pan(dx: number, dy: number) {
    const s = this.radius*0.002;
    const st=Math.sin(this.theta), ct=Math.cos(this.theta);
    this.target[0] += (-st*dx)*s;
    this.target[1] += dy*s;
    this.target[2] += (ct*dx)*s;
  }

  zoom(delta: number) {
    this.radius = Math.max(0.5, Math.min(50, this.radius*(1+delta*0.001)));
  }

  viewProjMatrix(aspect: number): Float32Array {
    return multiply(perspective(Math.PI/4, aspect, 0.01, 100), lookAt(this.eye, this.target as any, [0,1,0]));
  }
}

// ── Grid + Axis geometry generators ─────────────────────────

function generateGrid(size: number, divisions: number): { vertices: Float32Array; count: number } {
  const step = size / divisions;
  const half = size / 2;
  const verts: number[] = [];

  for (let i = 0; i <= divisions; i++) {
    const pos = -half + i * step;
    const isCenter = Math.abs(pos) < 0.001;
    // Skip center lines — axis gizmo covers those
    if (isCenter) continue;

    const gray = 0.25;
    // Line along X (parallel to X axis)
    verts.push(-half, 0, pos, gray, gray, gray);
    verts.push( half, 0, pos, gray, gray, gray);
    // Line along Z (parallel to Z axis)
    verts.push(pos, 0, -half, gray, gray, gray);
    verts.push(pos, 0,  half, gray, gray, gray);
  }

  return { vertices: new Float32Array(verts), count: verts.length / 6 };
}

function generateAxisGizmo(length: number): { vertices: Float32Array; count: number } {
  const verts: number[] = [];
  // X axis — red
  verts.push(0,0,0, 1,0.2,0.2);
  verts.push(length,0,0, 1,0.2,0.2);
  // Y axis — green
  verts.push(0,0,0, 0.2,1,0.2);
  verts.push(0,length,0, 0.2,1,0.2);
  // Z axis — blue
  verts.push(0,0,0, 0.3,0.3,1);
  verts.push(0,0,length, 0.3,0.3,1);

  return { vertices: new Float32Array(verts), count: verts.length / 6 };
}

// ── Shaders ─────────────────────────────────────────────────

const MESH_SHADER = \`
struct Uniforms { viewProj: mat4x4f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VIn { @location(0) pos: vec3f, @location(1) norm: vec3f, @location(2) col: vec3f }
struct VOut { @builtin(position) pos: vec4f, @location(0) col: vec3f, @location(1) norm: vec3f }

@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.pos = uniforms.viewProj * vec4f(i.pos, 1.0);
  o.col = i.col; o.norm = i.norm;
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let ld = normalize(vec3f(0.5, 1.0, 0.8));
  let lit = 0.3 + max(dot(normalize(i.norm), ld), 0.0) * 0.7;
  return vec4f(i.col * lit, 1.0);
}
\`;

const LINE_SHADER = \`
struct Uniforms { viewProj: mat4x4f }
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VIn { @location(0) pos: vec3f, @location(1) col: vec3f }
struct VOut { @builtin(position) pos: vec4f, @location(0) col: vec3f }

@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  o.pos = uniforms.viewProj * vec4f(i.pos, 1.0);
  o.col = i.col;
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  return vec4f(i.col, 1.0);
}
\`;

// ── Renderer ────────────────────────────────────────────────

export class DarkIronRenderer {
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private meshPipeline: GPURenderPipeline | null = null;
  private linePipeline: GPURenderPipeline | null = null;
  private depthTexture: GPUTexture | null = null;
  private uniformBuffer: GPUBuffer | null = null;
  private meshBindGroup: GPUBindGroup | null = null;
  private lineBindGroup: GPUBindGroup | null = null;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private indexCount = 0;
  private gridBuffer: GPUBuffer | null = null;
  private gridVertCount = 0;
  private axisBuffer: GPUBuffer | null = null;
  private axisVertCount = 0;
  private camera = new OrbitalCamera();

  constructor(private config: RendererConfig) {}

  async initialize(): Promise<boolean> {
    if (!navigator.gpu) { console.error("[DarkIron Renderer] WebGPU not supported"); return false; }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return false;
    this.device = await adapter.requestDevice();
    this.context = this.config.canvas.getContext("webgpu") as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format, alphaMode: "premultiplied" });

    this.uniformBuffer = this.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Mesh pipeline (triangles, 9-float stride: pos+norm+col)
    const meshShader = this.device.createShaderModule({ code: MESH_SHADER });
    const meshBGL = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });
    this.meshBindGroup = this.device.createBindGroup({
      layout: meshBGL,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.meshPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [meshBGL] }),
      vertex: {
        module: meshShader, entryPoint: "vs",
        buffers: [{ arrayStride: 36, attributes: [
          { shaderLocation: 0, offset: 0,  format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
          { shaderLocation: 2, offset: 24, format: "float32x3" },
        ]}],
      },
      fragment: { module: meshShader, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });

    // Line pipeline (lines, 6-float stride: pos+col)
    const lineShader = this.device.createShaderModule({ code: LINE_SHADER });
    const lineBGL = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });
    this.lineBindGroup = this.device.createBindGroup({
      layout: lineBGL,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
    this.linePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [lineBGL] }),
      vertex: {
        module: lineShader, entryPoint: "vs",
        buffers: [{ arrayStride: 24, attributes: [
          { shaderLocation: 0, offset: 0,  format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
        ]}],
      },
      fragment: { module: lineShader, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "line-list" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });

    // Generate grid and axis
    const grid = generateGrid(10, 20);
    this.gridBuffer = this.device.createBuffer({ size: grid.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.gridBuffer, 0, grid.vertices);
    this.gridVertCount = grid.count;

    const axis = generateAxisGizmo(1.5);
    this.axisBuffer = this.device.createBuffer({ size: axis.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.axisBuffer, 0, axis.vertices);
    this.axisVertCount = axis.count;

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
      format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private setupMouseControls() {
    const c = this.config.canvas;
    let drag = false, btn = 0, lx = 0, ly = 0;
    c.addEventListener("mousedown", e => { drag=true; btn=e.button; lx=e.clientX; ly=e.clientY; e.preventDefault(); });
    window.addEventListener("mousemove", e => {
      if (!drag) return;
      const dx=e.clientX-lx, dy=e.clientY-ly; lx=e.clientX; ly=e.clientY;
      if (btn===0) this.camera.orbit(dx,dy);
      else if (btn===1) this.camera.pan(dx,dy);
      else if (btn===2) this.camera.pan(dx,dy);
    });
    window.addEventListener("mouseup", () => { drag=false; });
    c.addEventListener("wheel", e => { this.camera.zoom(e.deltaY); e.preventDefault(); }, { passive: false });
    c.addEventListener("contextmenu", e => e.preventDefault());
  }

  uploadMesh(mesh: MeshData): void {
    if (!this.device) throw new Error("Renderer not initialized");
    const vertices = new Float32Array(mesh.vertices);
    const indices = new Uint32Array(mesh.indices);
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
    this.vertexBuffer = this.device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
    this.indexBuffer = this.device.createBuffer({ size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.indexBuffer, 0, indices);
    this.indexCount = indices.length;
    console.log(\\\`[DarkIron Renderer] Uploaded mesh: \\\${mesh.name} (\\\${this.indexCount} indices)\\\`);
  }

  render(): void {
    if (!this.device || !this.context || !this.meshPipeline || !this.linePipeline) return;
    if (!this.depthTexture || !this.uniformBuffer) return;

    const aspect = this.config.canvas.width / this.config.canvas.height;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.camera.viewProjMatrix(aspect));

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(),
        clearValue: { r:0.08, g:0.08, b:0.10, a:1 }, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: this.depthTexture.createView(),
        depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
    });

    // Draw grid
    if (this.gridBuffer && this.lineBindGroup) {
      pass.setPipeline(this.linePipeline);
      pass.setBindGroup(0, this.lineBindGroup);
      pass.setVertexBuffer(0, this.gridBuffer);
      pass.draw(this.gridVertCount);
    }

    // Draw axis gizmo
    if (this.axisBuffer && this.lineBindGroup) {
      pass.setPipeline(this.linePipeline);
      pass.setBindGroup(0, this.lineBindGroup);
      pass.setVertexBuffer(0, this.axisBuffer);
      pass.draw(this.axisVertCount);
    }

    // Draw meshes
    if (this.vertexBuffer && this.indexBuffer && this.meshBindGroup && this.indexCount > 0) {
      pass.setPipeline(this.meshPipeline);
      pass.setBindGroup(0, this.meshBindGroup);
      pass.setVertexBuffer(0, this.vertexBuffer);
      pass.setIndexBuffer(this.indexBuffer, "uint32");
      pass.drawIndexed(this.indexCount);
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.vertexBuffer?.destroy(); this.indexBuffer?.destroy();
    this.uniformBuffer?.destroy(); this.depthTexture?.destroy();
    this.gridBuffer?.destroy(); this.axisBuffer?.destroy();
    this.device?.destroy();
    console.log("[DarkIron Renderer] Destroyed");
  }
}
`;

// Fix template literal escaping
const final = code.replace(/\\\\\\\$/g, '$').replace(/\\\\\\\`/g, '`');
fs.writeFileSync('D:/DarkIron/darkiron/packages/renderer/src/index.ts', final);
console.log('Written:', fs.statSync('D:/DarkIron/darkiron/packages/renderer/src/index.ts').size, 'bytes');

// Verify key features present
const content = fs.readFileSync('D:/DarkIron/darkiron/packages/renderer/src/index.ts', 'utf8');
console.log('Has grid:', content.includes('generateGrid'));
console.log('Has axis:', content.includes('generateAxisGizmo'));
console.log('Has linePipeline:', content.includes('linePipeline'));
console.log('Has line-list:', content.includes('line-list'));

