// DarkIron Line Shader — unlit lines for grid, axes, wireframes
//
// Vertex format: position (vec3f) + color (vec3f)
// Uniforms:      viewProj (mat4x4f) + model (mat4x4f)

struct Uniforms {
  viewProj: mat4x4f,
  model: mat4x4f,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) color: vec3f,
}

struct VertexOutput {
  @builtin(position) clip_position: vec4f,
  @location(0) color: vec3f,
}

@vertex
fn vs(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.clip_position = u.viewProj * vec4f(input.position, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}

