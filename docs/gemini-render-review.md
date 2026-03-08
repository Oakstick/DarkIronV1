# DarkIron Chess Set — Gemini Render Review

As a senior graphics engineer, I've reviewed your WebGPU chess set rendering compared to the reference. Here's a detailed analysis of the visual issues, their root causes in your code, and specific recommendations for fixes.

---

### 1. What's Visually Wrong with the Current Render?

Compared to the reference image, the current render has significant visual deficiencies:

1.  **Flat, Basic Lighting**:
    *   No dynamic shadows (self-shadowing or cast shadows).
    *   Lack of realistic contrast and depth.
    *   Uniform, dull illumination across all surfaces, suggesting a simple diffuse lighting model.
    *   No ambient occlusion.
    *   No specular highlights or reflections.

2.  **Incorrect Materials (No PBR)**:
    *   **No Textures**: Pieces lack wood grain, chessboard lacks checkered pattern and texture.
    *   **Solid, Uniform Colors**: All objects are rendered with flat, hardcoded colors (grey, dark grey, brown).
    *   **Missing Metallic Accents**: The gold bands and cross on the King/Queen are not rendered as metallic; they appear as dull, colored surfaces.
    *   **Incorrect Transparency/Refraction**: The pawns, which are clearly glass-like with refraction and reflections in the reference, are opaque and grey in the current render.
    *   **Chessboard**: The chessboard is a flat, uniform brown plane, not a textured, checkered board with distinct squares as seen in the reference.

3.  **Geometry and Transforms (Scale, Positioning)**:
    *   **Overall Scale**: The pieces appear proportionally larger or the camera is too close/wide-angle compared to the reference.
    *   **Vertical Alignment**: Pieces (especially the black pawns on the left) appear to float slightly above the brown plane, indicating a potential offset or incorrect ground plane.
    *   **Chessboard Thickness**: The brown plane representing the chessboard is very thin, unlike the substantial, detailed board in the reference.

4.  **Camera and Perspective**:
    *   **Wide FOV/Distortion**: The perspective seems wider, causing pieces to appear slightly distorted and less "telephoto" than the reference.
    *   **Lack of Depth of Field (DoF)**: Everything in the scene is in sharp focus, whereas the reference employs a shallow depth of field to draw attention to the middle ground and blur the foreground and background.

5.  **Lack of Advanced Rendering Features**:
    *   **No Bloom/Glare**: The shiny elements (pawns, gold) in the reference have a subtle glow that is entirely absent in the current render.
    *   **No Anti-aliasing**: Edges of objects appear jagged (aliased).
    *   **Basic Background/Environment**: The background is a simple clear color, not the complex architectural environment reflected and visible in the reference image.
    *   **No Reflections**: Surfaces do not reflect the environment or other objects.

---

### 2. Root Cause Analysis

Let's trace these visual issues back to specific parts of your code.

**Issue 1: Flat, Basic Lighting (No Shadows, Basic Diffuse)**

*   **Root Cause 1.1: Simplistic Lighting Model in Shader**
    *   The `MESH_SHADER` implements a very basic Lambertian diffuse model with a fixed ambient term. It lacks specular components, physically based BRDFs, and complex light interactions.
    *   **File**: `packages/renderer/src/index.ts`
    *   **Lines**: 86-91 (`MESH_SHADER` fragment shader `fs`)
        ```wgsl
        @fragment fn fs(i:VO)->@location(0)vec4f{let ld=normalize(vec3f(0.5,1.0,0.8));
          let lit=0.3+max(dot(normalize(i.n),ld),0.0)*0.7;return vec4f(i.c*lit,1.0);}
        ```
        *   `ld=normalize(vec3f(0.5,1.0,0.8))`: Hardcoded, single light direction.
        *   `lit=0.3+max(dot(normalize(i.n),ld),0.0)*0.7`: Fixed ambient (0.3) + basic diffuse (max(N.L,0.0)*0.7). No specular, no Fresnel, no roughness/metallic interaction.

*   **Root Cause 1.2: No Shadow Mapping Implementation**
    *   The renderer pipeline does not include any passes for generating shadow maps or applying them during the main render.
    *   **File**: `packages/renderer/src/index.ts`
    *   **Renderer Logic**: The `render()` method only performs a single pass that draws meshes directly, without any prior depth pre-pass from a light source.

**Issue 2: Incorrect Materials (No PBR, Textures, Transparency, Metallic)**

*   **Root Cause 2.1: USD Loader Extracts Only Basic Vertex Color**
    *   The Python loader reads mesh geometry and assigns a single `r, g, b` color per vertex based on the prim's path. It completely ignores USD's material definitions (e.g., MaterialX, UsdPreviewSurface, variants like `shadingVariant`), UV coordinates, or texture references.
    *   **File**: `tools/load-chess-usd.py`
    *   **Lines**:
        *   122-127 (`colors` dictionary and conditional assignment): Hardcodes basic colors based on path string.
        *   21, 38 (`extract_mesh_with_transform`): Only `r, g, b` are appended to vertex data.
        *   The USD file `chess_set.usda` clearly defines `references` to individual piece USDs (e.g., `King.usd`, `Pawn.usd`) and `variants` for `shadingVariant = "Black"`/`"White"`. These are ignored for material properties.

*   **Root Cause 2.2: Renderer Lacks PBR Material Support and Texture Loading**
    *   The `MeshData` interface, vertex buffer layout, and shader inputs are limited to position, normal, and a single vertex color. There's no provision for UV coordinates, material IDs, metallic/roughness values, or texture samplers.
    *   **File**: `packages/renderer/src/index.ts`
    *   **Lines**:
        *   1-2 (`MeshData` interface): No fields for material properties or texture paths.
        *   112-115 (`meshPipe` vertex attributes): Defines attributes for position, normal, and *color*, but no UVs, tangents, or other material data.
        *   `uploadMesh` function: Only creates vertex buffer with `v.byteLength` based on `[px, py, pz, nx, ny, nz, r, g, b]`.
        *   The `MESH_SHADER` does not have `texture_2d` or `sampler` bindings, nor does it perform PBR calculations.
        *   `primitive:{topology:"triangle-list",cullMode:"none"}`: `cullMode:"none"` is suitable for glass, but without proper transparency rendering (blending, order, refraction), it's not effective.

**Issue 3: Geometry and Transforms (Scale, Positioning)**

*   **Root Cause 3.1: Arbitrary Global Scale Factor**
    *   An arbitrary `SCALE = 5.0` is applied to all vertex positions during loading, which can lead to incorrect scene scale if not matched with camera settings or the intended asset scale.
    *   **File**: `tools/load-chess-usd.py`
    *   **Lines**:
        *   12: `SCALE = 5.0`
        *   28: `px, py, pz = round(wp[0]*SCALE, 4), round(wp[1]*SCALE, 4), round(wp[2]*SCALE, 4)`

*   **Root Cause 3.2: Potentially Incorrect `PointInstancer` Transform Logic**
    *   The logic for combining instance, instancer, and prototype transforms within `resolve_point_instancer` might be applying transforms in the wrong order or double-counting some transformations.
    *   **File**: `tools/load-chess-usd.py`
    *   **Lines**:
        *   70: `instance_mat = Gf.Matrix4d(xform) * instancer_world`
        *   81: `final_mat = child_in_proto * instance_mat`
        *   `UsdGeom.PointInstancer.ComputeInstanceTransformsAtTime` returns `prototype-local-to-world` matrices for each instance. Multiplying this `xform` again by `instancer_world` (which is the instancer prim's `local-to-world`) and then by `child_in_proto` (which is `mesh-local-to-prototype-local`) leads to `MeshLocal -> PrototypeLocal -> InstanceWorld -> InstancerWorld`. This is likely incorrect, as `InstanceWorld` should already incorporate the instancer's transform. It should be `MeshLocal -> PrototypeLocal -> InstanceWorld`.

*   **Root Cause 3.3: Chessboard Geometry Not Fully Loaded/Rendered**
    *   The Python loader only assigns a single brown color to the "Chessboard" prim. It does not parse the `Chessboard.usd` reference to extract its detailed geometry (e.g., individual squares, thickness) or its materials.
    *   **File**: `tools/load-chess-usd.py`
    *   **Lines**:
        *   125: `elif "Chessboard" in path: color, team = (0.45, 0.32, 0.22), "Board"`: This line overrides any detailed material or sub-geometry defined within `Chessboard.usd`.

**Issue 4: Camera and Perspective (Wide FOV, No DoF)**

*   **Root Cause 4.1: Hardcoded Wide Field of View (FOV)**
    *   The camera uses a fixed 45-degree FOV, which might be too wide for the desired aesthetic, leading to more perspective distortion than the reference.
    *   **File**: `packages/renderer/src/index.ts`
    *   **Line**: 75 (`OrbitalCamera.viewProj`): `perspective(Math.PI/4, a, 0.01, 100)`

*   **Root Cause 4.2: No Depth of Field Implementation**
    *   The renderer doesn't include any post-processing for depth of field.
    *   **File**: `packages/renderer/src/index.ts`
    *   **Renderer Logic**: The `render()` method performs a single pass without storing depth for post-processing or applying any blur effects.

**Issue 5: Lack of Advanced Rendering Features (Bloom, Anti-aliasing, Environment)**

*   **Root Cause 5.1: No Anti-aliasing Configured or Implemented**
    *   The renderer currently doesn't configure Multi-Sample Anti-Aliasing (MSAA) or implement any post-processing anti-aliasing techniques (like FXAA).
    *   **File**: `packages/renderer/src/index.ts`
    *   **Lines**: 104-105 (`ctx.configure`): Does not specify `sampleCount`.
    *   116 (`meshPipe`): No `multisample` field in pipeline descriptor.

*   **Root Cause 5.2: No Bloom/Glare Implementation**
    *   This requires multiple rendering passes (thresholding, blurring, compositing) that are not present.
    *   **File**: `packages/renderer/src/index.ts`
    *   **Renderer Logic**: The `render()` loop is a simple forward pass.

*   **Root Cause 5.3: No Environment Mapping/Skybox/Reflection Probes**
    *   The shader and renderer lack the ability to load and use environment maps for reflections or image-based lighting, and no skybox is drawn. The background is a static clear color.
    *   **File**: `packages/renderer/src/index.ts` (`render` function and `MESH_SHADER`)
    *   **Line**: 154 (`clearValue`): Hardcoded background color.
    *   `MESH_SHADER`: No cubemap texture bindings or reflection calculation logic.

---

### 3. Fix Recommendations

I'll provide specific code changes, focusing on high-impact fixes first, then progressive enhancements.

#### Fix 1: Correct `PointInstancer` Transforms (High Impact)

*   **File**: `tools/load-chess-usd.py`
*   **Change**: Modify the `resolve_point_instancer` function.
    *   **Remove line 70**: `instance_mat = Gf.Matrix4d(xform) * instancer_world`
        *   *Reason*: `ComputeInstanceTransformsAtTime` returns `prototype-local-to-world` matrix, so `instancer_world` should not be applied again.
    *   **Change line 81**: `final_mat = child_in_proto * Gf.Matrix4d(xform)`
        *   *Reason*: The correct transformation chain is `MeshLocalToProtoLocal * ProtoLocalToWorldForInstance`.

#### Fix 2: Remove Arbitrary Global Scale (High Impact)

*   **File**: `tools/load-chess-usd.py`
*   **Change**:
    *   **Remove line 12**: `SCALE = 5.0`
    *   **Change line 28**: `px, py, pz = round(wp[0], 4), round(wp[1], 4), round(wp[2], 4)`
        *   *Reason*: Rely on USD's `metersPerUnit` for correct scaling. Adjust camera distance instead if the scene appears too small.

#### Fix 3: Adjust Camera Parameters (High Impact)

*   **File**: `packages/renderer/src/index.ts`
*   **Change**: Modify the `OrbitalCamera` constructor and `viewProj` method.
    *   **Line 70 (OrbitalCamera constructor)**:
        ```typescript
        // From: theta=Math.PI*0.25;phi=Math.PI*0.35;radius=5.0;target=[0,0.5,0];
        theta=Math.PI*0.4;phi=Math.PI*0.4;radius=8.0;target=[0,0.25,0];
        ```
        *   *Reason*: Increased radius and adjusted angles to frame the scene similar to the reference.
    *   **Line 75 (OrbitalCamera.viewProj method)**:
        ```typescript
        // From: return mat4Mul(perspective(Math.PI/4,a,0.01,100),lookAt(this.eye,this.target as any,[0,1,0]));
        return mat4Mul(perspective(Math.PI/6,a,0.01,200),lookAt(this.eye,this.target as any,[0,1,0]));
        ```
        *   *Reason*: Changed FOV from `Math.PI/4` (45 deg) to `Math.PI/6` (30 deg) for a more telephoto effect, reducing distortion. Increased far plane to `200` to accommodate larger radius.

#### Fix 4: Implement Basic PBR Material System with UVs (Major Rework - Phased Approach)

This is the most complex set of changes. It requires extending the USD loader, renderer, and shader.

**Phase 4.1: Extract UVs and Basic Material Properties (USD Loader)**

*   **File**: `tools/load-chess-usd.py`
*   **Change**:
    1.  **Extract UVs**: In `extract_mesh_with_transform`, get `st` primvars.
        ```python
        # Add after normals extraction (e.g., line 20)
        uvs = mesh.GetPrimvar('st').Get() if mesh.HasPrimvar('st') else None
        uv_interp = mesh.GetPrimvar('st').GetInterpolation() if uvs else None
        # ...
        # Inside the face loop (e.g., after normal calculation, line 37)
        ux, uy = 0.0, 0.0
        if uvs:
            ui = fvi_offset + j if uv_interp == "faceVarying" else vi
            if ui < len(uvs):
                uv = uvs[ui]
                ux, uy = round(uv[0], 4), round(uv[1], 4)

        # Update key and vertices.extend to include UVs
        key = (px, py, pz, nx, ny, nz, ux, uy) # Add ux, uy to key
        if key not in vert_map:
            vert_map[key] = len(vertices) // 11 # 3 pos + 3 norm + 2 uv + 3 color
            vertices.extend([px, py, pz, nx, ny, nz, ux, uy, r, g, b]) # Add ux, uy
        ```
    2.  **Pass Basic PBR Parameters**: The `color` currently passed is a single `(r,g,b)`. To represent metallic/roughness/transmission, the loader needs to parse these. For a start, hardcode them for specific pieces.
        ```python
        # Example for pawns (glass) and other pieces (wood/metallic)
        def resolve_point_instancer(instancer_prim, base_color, team_name): # Renamed color to base_color
            # ...
            if "Pawn" in proto_prim.GetPath().name:
                material = {"baseColor": base_color, "metallic": 0.0, "roughness": 0.1, "transmission": 0.9} # Glass
            else:
                material = {"baseColor": base_color, "metallic": 0.0, "roughness": 0.8, "transmission": 0.0} # Wood-like
            # ... extract_mesh_with_transform(child, final_mat, material) # Pass material dictionary
        
        def extract_mesh_with_transform(mesh_prim, world_mat, material_props): # Renamed color to material_props
            # ...
            r, g, b = material_props["baseColor"]
            metallic = material_props.get("metallic", 0.0)
            roughness = material_props.get("roughness", 0.8)
            transmission = material_props.get("transmission", 0.0)
            # ...
            # Update vertices.extend (add metallic, roughness, transmission as vertex attributes or pass per-mesh)
            # For simplicity, pass as mesh properties for now, not per-vertex
            # The USD material parser will be more complex later.
            mesh_data["material"] = material_props # Store material data with mesh_data
            # ... vertices.extend([px, py, pz, nx, ny, nz, ux, uy, r, g, b])
        ```
        *   *Note*: A full material parser for USD is a large project. For this review, I'm proposing simple attributes passed via the loader's existing color logic for now.

**Phase 4.2: Update Renderer for UVs and PBR Parameters**

*   **File**: `packages/renderer/src/index.ts`
*   **Change**:
    1.  **Extend `MeshData` Interface**:
        ```typescript
        export interface MaterialData {
          baseColor: number[]; // [r, g, b]
          metallic: number;
          roughness: number;
          transmission: number;
          // Add texture paths here later for PBR textures
        }
        export interface MeshData {
          name: string;
          vertices: number[]; // pos, norm, UV, (vertex_color - optional for debug)
          indices: number[];
          material: MaterialData; // New field
          transform?: { position?: number[]; rotation?: number[]; scale?: number[] };
        }
        ```
    2.  **Update Vertex Buffer Layout for UVs**:
        *   **Line 114 (`meshPipe` buffers `arrayStride`)**: Change from `36` to `(3 pos + 3 normal + 2 uv + 3 color) * 4 = 44`.
        *   **Line 115 (`meshPipe` vertex attributes)**: Add UVs.
            ```typescript
            // Existing:
            // {shaderLocation:0,offset:0,format:"float32x3"}, // Position
            // {shaderLocation:1,offset:12,format:"float32x3"}, // Normal
            // {shaderLocation:2,offset:24,format:"float32x3"}] // Color
            // New:
            {shaderLocation:0,offset:0,format:"float32x3"}, // Position
            {shaderLocation:1,offset:12,format:"float32x3"}, // Normal
            {shaderLocation:2,offset:24,format:"float32x2"}, // UV (new)
            {shaderLocation:3,offset:32,format:"float32x3"}] // Vertex Color (optional, for debug or fallback)
            ```
    3.  **Create Material Uniform Buffer and Bind Group**:
        *   Create a separate `GPUBindGroupLayout` and `GPUBindGroup` for per-mesh material properties. This would be `bindGroup(1)`.
        *   Each `GPUMesh` in `this.meshes` would also need a `materialBuf: GPUBuffer` and `materialBG: GPUBindGroup`.
        *   Update `uploadMesh` to create and write the `material` data to a new uniform buffer.
        *   Update `render` loop to `pass.setBindGroup(1, m.materialBG);` for each mesh.

**Phase 4.3: Update WGSL Shader for PBR (No Textures, Basic Model)**

*   **File**: `packages/renderer/src/index.ts` (MESH_SHADER)
*   **Change**:
    1.  **Update `Uniforms` and `VI/VO` structs**:
        ```wgsl
        // Add new Uniform for camera position (needed for specular)
        struct Uniforms{viewProj:mat4x4f,model:mat4x4f, cameraPos:vec3f}
        @group(0)@binding(0)var<uniform> u:Uniforms;

        // New Bind Group for Material properties (per-mesh)
        struct MaterialUniforms {
            baseColor: vec3f;
            metallic: f32;
            roughness: f32;
            transmission: f32;
            // Add other PBR properties here
        };
        @group(1)@binding(0)var<uniform> material:MaterialUniforms;

        struct VI{
            @location(0)p:vec3f,
            @location(1)n:vec3f,
            @location(2)uv:vec2f, // New
            @location(3)c:vec3f // Vertex Color (optional fallback)
        }
        struct VO{
            @builtin(position)p:vec4f,
            @location(0)c:vec3f,
            @location(1)n:vec3f,
            @location(2)worldPos:vec3f, // New: World position for view vector
            @location(3)uv:vec2f // New: Pass UVs
        }
        ```
    2.  **Update Vertex Shader (`vs`)**:
        ```wgsl
        @vertex fn vs(i:VI)->VO{
          var o:VO;
          let wp=u.model*vec4f(i.p,1.0);
          o.p=u.viewProj*wp;
          o.c=i.c; // Pass vertex color
          o.n=normalize((u.model*vec4f(i.n,0.0)).xyz);
          o.worldPos=wp.xyz; // Pass world position
          o.uv=i.uv; // Pass UVs
          return o;
        }
        ```
    3.  **Update Fragment Shader (`fs`) to Basic PBR**: (This is a simplified PBR; a full implementation is much more involved)
        ```wgsl
        @fragment fn fs(i:VO)->@location(0)vec4f{
          let N = normalize(i.n);
          let V = normalize(u.cameraPos - i.worldPos);
          let L = normalize(vec3f(0.5,1.0,0.8)); // Light direction (from Issue 1)

          let baseColor = material.baseColor;
          let metallic = material.metallic;
          let roughness = material.roughness;
          let transmission = material.transmission;

          let NdotL = max(dot(N, L), 0.0);
          let NdotV = max(dot(N, V), 0.0);

          // Simplified Diffuse
          let F0 = mix(vec3f(0.04), baseColor, metallic);
          let kD = (1.0 - F0) * (1.0 - metallic);
          let diffuse = kD * baseColor * NdotL;

          // Simplified Specular (e.g., using Blinn-Phong approx for now)
          let H = normalize(L + V);
          let NdotH = max(dot(N, H), 0.0);
          let shininess = pow(2.0, 10.0 * (1.0 - roughness)); // Map roughness to shininess
          let specular = F0 * pow(NdotH, shininess) * NdotL;

          let ambient = vec3f(0.08,0.08,0.10) * 0.1; // Simple ambient

          var finalColor = (diffuse + specular + ambient);

          // Handle simple transmission (for glass pawns)
          // For real refraction, a separate rendering pass is needed.
          if (transmission > 0.5) {
              // Blend with clear color or a simplified background color based on transmission
              // This is a very basic approximation of transparency.
              finalColor = mix(finalColor, vec3f(0.8, 0.9, 1.0), transmission * 0.5); // Mix with a light color
              return vec4f(finalColor, transmission); // Enable alpha blending
          }

          return vec4f(finalColor, 1.0);
        }
        ```

#### Fix 5: Implement Basic Shadow Mapping (Complex)

This is a significant feature. Here's an outline:

*   **File**: `packages/renderer/src/index.ts` (Renderer Logic and `MESH_SHADER`)
*   **Changes**:
    1.  **Renderer - Shadow Map Setup**:
        *   Create `shadowTexture: GPUTexture` (e.g., `depth32float`) and `shadowSampler: GPUSampler`.
        *   Create `lightViewProj` matrix (transform from light's perspective).
        *   Create a separate `shadowPipe: GPURenderPipeline` (vertex shader only, outputting depth).
        *   Modify `bg` (bind group 0) or create a new `bindGroup(2)` to hold `lightViewProj`, `shadowTexture`, `shadowSampler`.
    2.  **Renderer - Shadow Pass**:
        *   Before the main render pass, create a `shadowPassEncoder` and `beginRenderPass` using `shadowTexture` as `depthStencilAttachment`.
        *   Inside the shadow pass, bind `shadowPipe`, set `lightViewProj` as uniform, and draw all opaque meshes.
        *   `shadowPassEncoder.end()` and `queue.submit`.
    3.  **Renderer - Main Render Pass**:
        *   In `render()`, set the bind group containing shadow map resources (`pass.setBindGroup(2, this.shadowBG)`).
    4.  **WGSL `MESH_SHADER` - Vertex Shader**:
        *   Pass fragment's `worldPos` to fragment shader.
    5.  **WGSL `MESH_SHADER` - Fragment Shader**:
        *   Add `lightViewProj:mat4x4f` to `Uniforms`.
        *   Add `@group(2)@binding(1) var shadowMap: texture_depth_2d;` and `@group(2)@binding(2) var shadowSampler: sampler_comparison;`.
        *   Transform `i.worldPos` to light space (`lightClipPos = lightViewProj * vec4f(i.worldPos, 1.0)`).
        *   Normalize `lightClipPos.xy` to `uv_coords`.
        *   Perform shadow lookup: `let visibility = textureSampleCompare(shadowMap, shadowSampler, uv_coords, lightClipPos.z);`.
        *   Multiply the diffuse/specular terms by `visibility`.

#### Fix 6: Enable Anti-aliasing

*   **File**: `packages/renderer/src/index.ts`
*   **Change**: Configure MSAA for the canvas and render pipelines.
    1.  **Line 105 (`ctx.configure`)**:
        ```typescript
        this.ctx.configure({device:this.dev,format:fmt,alphaMode:"premultiplied", antialias:"prefer"}); // Add antialias
        ```
        *   *Note*: `antialias: "prefer"` is a high-level API setting. For more control or higher quality, you'd configure `sampleCount` explicitly on textures and pipelines (e.g., `sampleCount: 4`).

#### Fix 7: Load Chessboard Geometry and Textures (Requires Phase 4.1-4.3 first)

*   **File**: `tools/load-chess-usd.py`
*   **Change**:
    1.  **Refactor Material Assignment**: Instead of a simple `if "Chessboard" in path:`, the loader needs to traverse into `Chessboard.usd` (which is a referenced asset) and extract *its* meshes and material definitions (including UVs and textures). This means the `load_chess_set` function needs to handle `Usd.Prim.GetReferences()` and recursively process those stages.
    2.  **Texture Loading**: Once material parsing is implemented, the `MaterialData` will contain texture paths. The renderer will need a texture manager to load these.

#### Future Enhancements (Post-processing, Environment)

*   **Depth of Field**: Requires multiple rendering passes, depth buffer access, and a blur shader that varies based on depth.
*   **Bloom**: Requires HDR rendering, thresholding, multiple blur passes, and compositing.
*   **Environment Reflections (IBL/Skybox)**:
    *   Load environment maps (cubemaps).
    *   Render a skybox with a separate pipeline and shader.
    *   Integrate Image-Based Lighting (IBL) into the PBR shader (requires pre-filtered environment maps: irradiance map for diffuse, pre-filtered specular map for reflections).

These recommendations lay out a structured path to achieving a render quality much closer to your reference image. Start with the transform and scale fixes, then iteratively build up the PBR material system, shadow mapping, and finally post-processing and environment.