/**
 * @darkiron/renderer
 *
 * WebGPU-based 3D renderer for the DarkIron Engine.
 * Handles mesh upload, orbital camera, grid/axis helpers, and frame rendering.
 */

import { lookAt, perspective, mat4Mul, mat4Identity, mat4FromTRS } from './utils/mat4';
import MESH_SHADER_SRC from '../../../shaders/mesh.wgsl?raw';
import LINE_SHADER_SRC from '../../../shaders/line.wgsl?raw';

export interface MeshData {
  name: string;
  vertices: number[];
  indices: number[];
  transform?: { position?: number[]; rotation?: number[]; scale?: number[] };
}

export interface RendererConfig {
  canvas: HTMLCanvasElement;
}

class OrbitalCamera{
  theta=Math.PI*0.25;phi=Math.PI*0.35;radius=5.0;target=[0,0.5,0];
  get eye():[number,number,number]{const sp=Math.sin(this.phi),cp=Math.cos(this.phi),st=Math.sin(this.theta),ct=Math.cos(this.theta);
    return[this.target[0]+this.radius*sp*ct,this.target[1]+this.radius*cp,this.target[2]+this.radius*sp*st];}
  orbit(dx:number,dy:number){this.theta-=dx*0.01;this.phi=Math.max(0.1,Math.min(Math.PI-0.1,this.phi-dy*0.01));}
  pan(dx:number,dy:number){const s=this.radius*0.002,st=Math.sin(this.theta),ct=Math.cos(this.theta);
    this.target[0]+=(-st*dx)*s;this.target[1]+=dy*s;this.target[2]+=(ct*dx)*s;}
  zoom(d:number){this.radius=Math.max(0.5,Math.min(50,this.radius*(1+d*0.001)));}
  viewProj(a:number):Float32Array{return mat4Mul(perspective(Math.PI/4,a,0.01,100),lookAt(this.eye,this.target as any,[0,1,0]));}
}

function genGrid(size:number,div:number):{v:Float32Array;n:number}{
  const step=size/div,half=size/2,d:number[]=[];
  for(let i=0;i<=div;i++){const p=-half+i*step;if(Math.abs(p)<0.001)continue;const g=0.25;
    d.push(-half,0,p,g,g,g, half,0,p,g,g,g, p,0,-half,g,g,g, p,0,half,g,g,g);}
  return{v:new Float32Array(d),n:d.length/6};}

function genAxis(len:number):{v:Float32Array;n:number}{const d:number[]=[];
  d.push(0,0,0,1,0.2,0.2, len,0,0,1,0.2,0.2);d.push(0,0,0,0.2,1,0.2, 0,len,0,0.2,1,0.2);
  d.push(0,0,0,0.3,0.3,1, 0,0,len,0.3,0.3,1);return{v:new Float32Array(d),n:d.length/6};}



interface GPUMesh{name:string;vBuf:GPUBuffer;iBuf:GPUBuffer;iCount:number;model:Float32Array;}

export class DarkIronRenderer{
  private dev:GPUDevice|null=null;private ctx:GPUCanvasContext|null=null;
  private meshPipe:GPURenderPipeline|null=null;private linePipe:GPURenderPipeline|null=null;
  private depthTex:GPUTexture|null=null;private uBuf:GPUBuffer|null=null;private bg:GPUBindGroup|null=null;
  private meshes:GPUMesh[]=[];
  private gridBuf:GPUBuffer|null=null;private gridN=0;private axisBuf:GPUBuffer|null=null;private axisN=0;
  private cam=new OrbitalCamera();
  constructor(private config:RendererConfig){}
  async initialize():Promise<boolean>{
    if(!navigator.gpu)return false;
    const ad=await navigator.gpu.requestAdapter({powerPreference:"high-performance"});if(!ad)return false;
    this.dev=await ad.requestDevice();this.ctx=this.config.canvas.getContext("webgpu") as GPUCanvasContext;
    const fmt=navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({device:this.dev,format:fmt,alphaMode:"premultiplied"});
    this.uBuf=this.dev.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bgl=this.dev.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"uniform"}}]});
    this.bg=this.dev.createBindGroup({layout:bgl,entries:[{binding:0,resource:{buffer:this.uBuf}}]});
    const lay=this.dev.createPipelineLayout({bindGroupLayouts:[bgl]});
    const ms=this.dev.createShaderModule({code:MESH_SHADER_SRC});
    this.meshPipe=this.dev.createRenderPipeline({layout:lay,vertex:{module:ms,entryPoint:"vs",buffers:[{arrayStride:36,attributes:[
      {shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x3"},{shaderLocation:2,offset:24,format:"float32x3"}]}]},
      fragment:{module:ms,entryPoint:"fs",targets:[{format:fmt}]},primitive:{topology:"triangle-list",cullMode:"back"},
      depthStencil:{format:"depth24plus",depthWriteEnabled:true,depthCompare:"less"}});
    const ls=this.dev.createShaderModule({code:LINE_SHADER_SRC});
    this.linePipe=this.dev.createRenderPipeline({layout:lay,vertex:{module:ls,entryPoint:"vs",buffers:[{arrayStride:24,attributes:[
      {shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x3"}]}]},
      fragment:{module:ls,entryPoint:"fs",targets:[{format:fmt}]},primitive:{topology:"line-list"},
      depthStencil:{format:"depth24plus",depthWriteEnabled:true,depthCompare:"less"}});
    const grid=genGrid(10,20);
    this.gridBuf=this.dev.createBuffer({size:grid.v.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    this.dev.queue.writeBuffer(this.gridBuf,0,grid.v);this.gridN=grid.n;
    const axis=genAxis(1.5);
    this.axisBuf=this.dev.createBuffer({size:axis.v.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    this.dev.queue.writeBuffer(this.axisBuf,0,axis.v);this.axisN=axis.n;
    this.depthTex=this.dev.createTexture({size:[this.config.canvas.width,this.config.canvas.height],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT});
    const c=this.config.canvas;let drag=false,btn=0,lx=0,ly=0;
    c.addEventListener("mousedown",e=>{drag=true;btn=e.button;lx=e.clientX;ly=e.clientY;e.preventDefault();});
    window.addEventListener("mousemove",e=>{if(!drag)return;const dx=e.clientX-lx,dy=e.clientY-ly;lx=e.clientX;ly=e.clientY;
      if(btn===0)this.cam.orbit(dx,dy);else this.cam.pan(dx,dy);});
    window.addEventListener("mouseup",()=>{drag=false;});
    c.addEventListener("wheel",e=>{this.cam.zoom(e.deltaY);e.preventDefault();},{passive:false});
    c.addEventListener("contextmenu",e=>e.preventDefault());
    console.log("[DarkIron Renderer] Initialized (WebGPU)");return true;}
  get meshCount():number{return this.meshes.length;}
  uploadMesh(mesh:MeshData):void{
    if(!this.dev)throw new Error("Not init");
    const v=new Float32Array(mesh.vertices),idx=new Uint32Array(mesh.indices);
    const vBuf=this.dev.createBuffer({size:v.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});
    this.dev.queue.writeBuffer(vBuf,0,v);
    const iBuf=this.dev.createBuffer({size:idx.byteLength,usage:GPUBufferUsage.INDEX|GPUBufferUsage.COPY_DST});
    this.dev.queue.writeBuffer(iBuf,0,idx);
    const t=mesh.transform||{};const pos=t.position||[0,0,0],rot=t.rotation||[0,0,0],scl=t.scale||[1,1,1];
    const model=mat4FromTRS(pos,rot,scl);
    const ex=this.meshes.findIndex(m=>m.name===mesh.name);
    if(ex>=0){this.meshes[ex].vBuf.destroy();this.meshes[ex].iBuf.destroy();
      this.meshes[ex]={name:mesh.name,vBuf,iBuf,iCount:idx.length,model};}
    else{this.meshes.push({name:mesh.name,vBuf,iBuf,iCount:idx.length,model});}
    console.log("[DarkIron Renderer] Mesh: "+mesh.name+" ("+idx.length+" idx, "+this.meshes.length+" total)");}
  clearMeshes():void{for(const m of this.meshes){m.vBuf.destroy();m.iBuf.destroy();}this.meshes=[];}
  render():void{
    if(!this.dev||!this.ctx||!this.meshPipe||!this.linePipe||!this.depthTex||!this.uBuf||!this.bg)return;
    // Recreate depth texture if canvas size changed
    const cw=this.config.canvas.width,ch=this.config.canvas.height;
    if(this.depthTex.width!==cw||this.depthTex.height!==ch){
      this.depthTex.destroy();
      this.depthTex=this.dev.createTexture({size:[cw,ch],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT});
    }
    const vp=this.cam.viewProj(cw/ch);
    const enc=this.dev.createCommandEncoder();
    const pass=enc.beginRenderPass({colorAttachments:[{view:this.ctx.getCurrentTexture().createView(),
      clearValue:{r:0.08,g:0.08,b:0.10,a:1},loadOp:"clear",storeOp:"store"}],
      depthStencilAttachment:{view:this.depthTex.createView(),depthClearValue:1.0,depthLoadOp:"clear",depthStoreOp:"store"}});
    this.dev.queue.writeBuffer(this.uBuf,0,vp);this.dev.queue.writeBuffer(this.uBuf,64,mat4Identity());
    if(this.gridBuf){pass.setPipeline(this.linePipe);pass.setBindGroup(0,this.bg);pass.setVertexBuffer(0,this.gridBuf);pass.draw(this.gridN);}
    if(this.axisBuf){pass.setPipeline(this.linePipe);pass.setBindGroup(0,this.bg);pass.setVertexBuffer(0,this.axisBuf);pass.draw(this.axisN);}
    for(const m of this.meshes){this.dev.queue.writeBuffer(this.uBuf,64,m.model);
      pass.setPipeline(this.meshPipe);pass.setBindGroup(0,this.bg);
      pass.setVertexBuffer(0,m.vBuf);pass.setIndexBuffer(m.iBuf,"uint32");pass.drawIndexed(m.iCount);}
    pass.end();this.dev.queue.submit([enc.finish()]);}
  destroy():void{this.clearMeshes();this.uBuf?.destroy();this.depthTex?.destroy();
    this.gridBuf?.destroy();this.axisBuf?.destroy();this.dev?.destroy();
    console.log("[DarkIron Renderer] Destroyed");}
}