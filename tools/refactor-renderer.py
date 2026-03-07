path = r"D:\DarkIron\darkiron\packages\renderer\src\index.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Replace the math TODO comment + inline functions with imports
# Find everything from the TODO comment to the OrbitalCamera class
import re

# Remove the old TODO + inline math functions (lines before OrbitalCamera)
# The pattern: from the TODO comment or first function through to the class
old_header = content.split("class OrbitalCamera")[0]
new_header = """/**
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

"""

content = new_header + "class OrbitalCamera" + content.split("class OrbitalCamera")[1]

# 2. Remove the old inline MESH_SHADER and LINE_SHADER constants
# Replace references to the const names
content = content.replace(
    "const MESH_SHADER=`\n",
    "// Shaders loaded from external .wgsl files\nconst MESH_SHADER_UNUSED=`\n"
)

# Actually, let's just surgically remove the two shader string blocks
# Find and remove MESH_SHADER block
mesh_start = content.find("const MESH_SHADER")
if mesh_start == -1:
    mesh_start = content.find("// Shaders loaded")
line_start = content.find("const LINE_SHADER")
if line_start == -1:
    line_start = content.find("\nconst LINE_SHADER")

# Find the interface that comes after
iface_pos = content.find("interface GPUMesh")

# Remove everything between the class close and GPUMesh interface that are shaders
# Let me be more precise - find the exact shader blocks

# Actually let me just do a clean approach - find the two shader consts and remove them
lines = content.split('\n')
new_lines = []
skip = False
for i, line in enumerate(lines):
    if 'const MESH_SHADER=' in line or 'const MESH_SHADER_UNUSED=' in line or '// Shaders loaded from external' in line:
        skip = True
        continue
    if 'const LINE_SHADER=' in line:
        skip = True
        continue
    if skip and line.strip().endswith('`;'):
        skip = False
        continue
    if not skip:
        new_lines.append(line)

content = '\n'.join(new_lines)

# 3. Replace shader references in pipeline creation
content = content.replace(
    "this.dev.createShaderModule({code:MESH_SHADER})",
    "this.dev.createShaderModule({code:MESH_SHADER_SRC})"
)
content = content.replace(
    "this.dev.createShaderModule({code:LINE_SHADER})",
    "this.dev.createShaderModule({code:LINE_SHADER_SRC})"
)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Refactored renderer:")
print("  - Replaced inline math with import from utils/mat4.ts")
print("  - Replaced inline WGSL shaders with ?raw imports from shaders/")
print("  - Added module docstring")

