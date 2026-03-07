path = r"D:\DarkIron\darkiron\packages\renderer\src\index.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Fix 1: Enable backface culling for performance
content = content.replace(
    'primitive:{topology:"triangle-list",cullMode:"none"},',
    'primitive:{topology:"triangle-list",cullMode:"back"},'
)

# Fix 2: Add depth texture resize handling in the render method
# Replace the render method's beginning to check canvas size
old_render = '''render():void{
    if(!this.dev||!this.ctx||!this.meshPipe||!this.linePipe||!this.depthTex||!this.uBuf||!this.bg)return;
    const vp=this.cam.viewProj(this.config.canvas.width/this.config.canvas.height);'''
new_render = '''render():void{
    if(!this.dev||!this.ctx||!this.meshPipe||!this.linePipe||!this.depthTex||!this.uBuf||!this.bg)return;
    // Recreate depth texture if canvas size changed
    const cw=this.config.canvas.width,ch=this.config.canvas.height;
    if(this.depthTex.width!==cw||this.depthTex.height!==ch){
      this.depthTex.destroy();
      this.depthTex=this.dev.createTexture({size:[cw,ch],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT});
    }
    const vp=this.cam.viewProj(cw/ch);'''
content = content.replace(old_render, new_render)

# Fix 3: Add TODO comment about math extraction at the top
old_export = "export interface MeshData"
new_export = """// TODO: Extract lookAt, perspective, mat4Mul, mat4Identity, mat4FromTRS
// into a dedicated math utility module (e.g., utils/mat4.ts) or replace with gl-matrix.
export interface MeshData"""
content = content.replace(old_export, new_export, 1)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Fixed renderer: backface culling, depth resize, math TODO")

