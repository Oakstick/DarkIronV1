// DarkIron Mesh Shader — basic lit triangles with per-vertex color
//
// Vertex format: position (vec3f) + normal (vec3f) + color (vec3f)
// Uniforms:      viewProj (mat4x4f) + model (mat4x4f)

struct Uniforms {
  viewProj: mat4x4f,
  model: mat4x4f,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
}

struct VertexOutput {
  @builtin(position) clip_position: vec4f,
  @location(0) color: vec3f,
  @location(1) world_normal: vec3f,
}

@vertex
fn vs(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let world_pos = u.model * vec4f(input.position, 1.0);
  out.clip_position = u.viewProj * world_pos;
  out.color = input.color;
  out.world_normal = normalize((u.model * vec4f(input.normal, 0.0)).xyz);
  return out;
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4f {
  let light_dir = normalize(vec3f(0.5, 1.0, 0.8));
  let diffuse = max(dot(normalize(input.world_normal), light_dir), 0.0);
  let lit = 0.3 + diffuse * 0.7;
  return vec4f(input.color * lit, 1.0);
}

