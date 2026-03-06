// DarkIron Engine — Golden Triangle Shader
//
// Phase 1 proof-of-concept shader.
// Renders interleaved vertex data (position + normal + color).
// This will be replaced by the full PBR render graph in Phase 3.

struct VertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) color: vec3f,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4f,
    @location(0) world_normal: vec3f,
    @location(1) color: vec3f,
}

// TODO Phase 3: Add uniform buffer for camera matrices
// @group(0) @binding(0) var<uniform> camera: CameraUniforms;

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    // Phase 1: Direct passthrough (clip space)
    // Phase 3: Multiply by model-view-projection matrix
    out.clip_position = vec4f(in.position, 1.0);
    out.world_normal = in.normal;
    out.color = in.color;

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    // Phase 1: Direct vertex color output
    // Phase 3: PBR lighting calculation using normal + material
    return vec4f(in.color, 1.0);
}
