#![deny(clippy::all)]

//! darkiron-usd -" USD stage reader for DarkIron Engine.

//!

//! Reads pre-flattened USD files (usda or usdc) and extracts mesh geometry.

use anyhow::{Context, Result};

use openusd::sdf::{self, AbstractData};

use std::path::Path;

use tracing::{debug, info, warn};

/// A mesh extracted from a USD stage.

#[derive(Debug, Clone)]

pub struct ExtractedMesh {
    pub name: String,
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
    pub uvs: Vec<f32>,
    pub base_color_tex: Vec<u8>,
}

fn color_for_path(path: &str) -> [f32; 3] {
    if path.contains("Black") {
        [0.12, 0.10, 0.08]
    } else if path.contains("White") {
        [0.92, 0.89, 0.84]
    } else if path.contains("Chessboard") {
        [0.45, 0.35, 0.25]
    } else {
        [0.5, 0.5, 0.5]
    }
}

fn mesh_name_from_path(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();

    if parts.len() >= 3 {
        parts[1..].join("_")
    } else {
        parts.last().unwrap_or(&"mesh").to_string()
    }
}

fn get_f32_array(value: &sdf::Value) -> Option<Vec<f32>> {
    match value {
        sdf::Value::FloatVec(v) => Some(v.clone()),

        sdf::Value::Vec3f(v) => Some(v.clone()),

        sdf::Value::Vec3d(v) => Some(v.iter().map(|x| *x as f32).collect()),

        sdf::Value::DoubleVec(v) => Some(v.iter().map(|x| *x as f32).collect()),

        _ => None,
    }
}

fn get_i32_array(value: &sdf::Value) -> Option<Vec<i32>> {
    match value {
        sdf::Value::IntVec(v) => Some(v.clone()),

        _ => None,
    }
}

fn get_double3(value: &sdf::Value) -> Option<[f64; 3]> {
    match value {
        sdf::Value::Vec3d(v) if v.len() == 3 => Some([v[0], v[1], v[2]]),

        sdf::Value::Vec3f(v) if v.len() == 3 => Some([v[0] as f64, v[1] as f64, v[2] as f64]),

        _ => None,
    }
}

/// Read a prim-level field (e.g., typeName, primChildren).
fn get_prim_field(reader: &mut dyn AbstractData, prim: &str, field: &str) -> Option<sdf::Value> {
    let path = sdf::Path::new(prim).ok()?;

    reader.get(&path, field).ok().map(|v| v.into_owned())
}

/// Read a property value (e.g., points, normals) using dot-syntax path.
fn get_property(reader: &mut dyn AbstractData, prim: &str, prop: &str) -> Option<sdf::Value> {
    let prop_path = sdf::Path::new(&format!("{prim}.{prop}")).ok()?;

    reader
        .get(&prop_path, "default")
        .ok()
        .map(|v| v.into_owned())
}

/// 4x4 matrix (column-major) identity.
fn mat4_identity() -> [f64; 16] {
    [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ]
}

/// Multiply two 4x4 matrices (column-major).
fn mat4_mul(a: &[f64; 16], b: &[f64; 16]) -> [f64; 16] {
    let mut r = [0.0_f64; 16];

    for col in 0..4 {
        for row in 0..4 {
            r[col * 4 + row] = (0..4).map(|k| a[k * 4 + row] * b[col * 4 + k]).sum();
        }
    }

    r
}

/// Build a translation matrix.
fn mat4_translate(t: [f64; 3]) -> [f64; 16] {
    let mut m = mat4_identity();

    m[12] = t[0];
    m[13] = t[1];
    m[14] = t[2];

    m
}

/// Build a scale matrix.
fn mat4_scale(s: [f64; 3]) -> [f64; 16] {
    let mut m = mat4_identity();

    m[0] = s[0];
    m[5] = s[1];
    m[10] = s[2];

    m
}

/// Build a rotation matrix from Euler angles (XYZ order, degrees).
fn mat4_rotate_xyz(angles: [f64; 3]) -> [f64; 16] {
    let (rx, ry, rz) = (
        angles[0].to_radians(),
        angles[1].to_radians(),
        angles[2].to_radians(),
    );

    let (sx, cx) = (rx.sin(), rx.cos());

    let (sy, cy) = (ry.sin(), ry.cos());

    let (sz, cz) = (rz.sin(), rz.cos());

    // Combined XYZ rotation matrix (column-major)

    [
        cy * cz,
        cy * sz,
        -sy,
        0.0,
        sx * sy * cz - cx * sz,
        sx * sy * sz + cx * cz,
        sx * cy,
        0.0,
        cx * sy * cz + sx * sz,
        cx * sy * sz - sx * cz,
        cx * cy,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
    ]
}

/// Transform a 3D point by a 4x4 matrix (with w=1 perspective divide).
fn mat4_transform_point(m: &[f64; 16], p: [f64; 3]) -> [f64; 3] {
    let w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];

    let w = if w.abs() < 1e-10 { 1.0 } else { w };

    [
        (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
        (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
        (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w,
    ]
}

/// Transform a 3D direction by the upper-left 3x3 of a matrix (no translation).
fn mat4_transform_dir(m: &[f64; 16], d: [f64; 3]) -> [f64; 3] {
    [
        m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
        m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
        m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
    ]
}

/// Normalize a 3D vector.
fn vec3_normalize(v: [f64; 3]) -> [f64; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();

    if len < 1e-10 {
        [0.0, 1.0, 0.0]
    } else {
        [v[0] / len, v[1] / len, v[2] / len]
    }
}

/// Compute the local transform matrix for a single prim from its xformOps.
fn compute_prim_transform(reader: &mut dyn AbstractData, prim_path: &str) -> [f64; 16] {
    let mut m = mat4_identity();

    // Check for xformOp:transform (full 4x4 matrix)

    if let Some(val) = get_property(reader, prim_path, "xformOp:transform") {
        if let Some(sdf::Value::DoubleVec(ref dv)) = Some(val) {
            if dv.len() == 16 {
                let mut mat = [0.0_f64; 16];

                // USD stores row-major, we need column-major

                for row in 0..4 {
                    for col in 0..4 {
                        mat[col * 4 + row] = dv[row * 4 + col];
                    }
                }

                return mat;
            }
        }
    }

    // Build from individual ops: translate, rotateXYZ, scale

    if let Some(val) = get_property(reader, prim_path, "xformOp:translate") {
        if let Some(t) = get_double3(&val) {
            m = mat4_mul(&m, &mat4_translate(t));
        }
    }

    if let Some(val) = get_property(reader, prim_path, "xformOp:rotateXYZ") {
        if let Some(r) = get_double3(&val) {
            m = mat4_mul(&m, &mat4_rotate_xyz(r));
        }
    }

    if let Some(val) = get_property(reader, prim_path, "xformOp:scale") {
        if let Some(s) = get_double3(&val) {
            m = mat4_mul(&m, &mat4_scale(s));
        }
    }

    m
}

/// Compute the transform matrix for a prim relative to a given ancestor.
/// Only composes transforms from (but not including) `from_path` down to `prim_path`.
#[allow(dead_code)]
fn compute_relative_matrix(
    reader: &mut dyn AbstractData,
    prim_path: &str,
    from_path: &str,
) -> [f64; 16] {
    let mut rel = mat4_identity();
    let parts: Vec<&str> = prim_path.split('/').filter(|p| !p.is_empty()).collect();
    let from_parts: Vec<&str> = from_path.split('/').filter(|p| !p.is_empty()).collect();

    // Start composing from the level after from_path
    for i in (from_parts.len() + 1)..=parts.len() {
        let ancestor = format!("/{}", parts[..i].join("/"));
        let local = compute_prim_transform(reader, &ancestor);
        rel = mat4_mul(&rel, &local);
    }

    rel
}

/// Compute the world transform matrix for a prim by composing ancestor transforms.
fn compute_world_matrix(reader: &mut dyn AbstractData, mesh_path: &str) -> [f64; 16] {
    let mut world = mat4_identity();

    let parts: Vec<&str> = mesh_path.split('/').filter(|p| !p.is_empty()).collect();

    // Walk from root to the prim, composing transforms

    for i in 1..=parts.len() {
        let ancestor = format!("/{}", parts[..i].join("/"));

        let local = compute_prim_transform(reader, &ancestor);

        world = mat4_mul(&world, &local);
    }

    world
}

/// Try to read `material:binding` relationship and resolve a base_color texture path.
fn resolve_material_texture(
    reader: &mut dyn AbstractData,
    mesh_path: &str,
    usd_dir: &Path,
) -> Option<Vec<u8>> {
    // Try reading material:binding relationship target
    let binding_path = sdf::Path::new(&format!("{mesh_path}.material:binding")).ok()?;
    let val = reader.get(&binding_path, "targetPaths").ok()?;
    let material_path = match val.into_owned() {
        sdf::Value::PathListOp(list_op) => {
            // Relationship targets are typically in explicit_items or prepended_items
            list_op
                .explicit_items
                .first()
                .or_else(|| list_op.prepended_items.first())
                .map(|p| p.to_string())
        }
        _ => None,
    }?;

    debug!(mesh = %mesh_path, material = %material_path, "Found material:binding");

    // Walk the material network to find a texture file asset path.
    // Look for UsdPreviewSurface inputs:diffuseColor or standard_surface base_color
    // connected to a UsdUVTexture with inputs:file.
    let tex_path = find_texture_in_material(reader, &material_path, usd_dir);
    if let Some(ref p) = tex_path {
        debug!(texture = %p.display(), "Resolved base_color texture path");
        match std::fs::read(p) {
            Ok(bytes) => {
                info!(texture = %p.display(), bytes = bytes.len(), "Read base_color texture");
                return Some(bytes);
            }
            Err(e) => warn!(texture = %p.display(), error = %e, "Failed to read texture file"),
        }
    }
    None
}

/// Walk a material prim's shader network to find the base_color texture file.
fn find_texture_in_material(
    reader: &mut dyn AbstractData,
    material_path: &str,
    usd_dir: &Path,
) -> Option<std::path::PathBuf> {
    // Look for shader children of the material
    let children: Vec<String> = get_prim_field(reader, material_path, "primChildren")
        .and_then(|v| {
            if let sdf::Value::TokenVec(c) = v {
                Some(c)
            } else {
                None
            }
        })
        .unwrap_or_default();

    for child in &children {
        let shader_path = format!("{material_path}/{child}");

        // Check for inputs:file (UsdUVTexture node) — this is the texture asset path
        if let Some(sdf::Value::AssetPath(ref asset)) =
            get_property(reader, &shader_path, "inputs:file")
        {
            let resolved = usd_dir.join(asset.trim_start_matches("./"));
            if resolved.exists() {
                return Some(resolved);
            }
        }

        // Check for inputs:diffuseColor connection that leads to a texture
        // Recurse into child shader nodes
        if let Some(path) = find_texture_in_material(reader, &shader_path, usd_dir) {
            return Some(path);
        }
    }
    None
}

/// Convention-based fallback: find base_color texture by scanning known directories.
fn find_texture_by_convention(mesh_name: &str, usd_dir: &Path) -> Option<Vec<u8>> {
    // Determine piece type and color from mesh name
    let name_lower = mesh_name.to_lowercase();

    let pieces = [
        "king",
        "queen",
        "bishop",
        "knight",
        "rook",
        "pawn",
        "chessboard",
    ];
    let piece = pieces.iter().find(|p| name_lower.contains(*p))?;

    let color = if name_lower.contains("black") {
        "black"
    } else if name_lower.contains("white") {
        "white"
    } else if *piece == "chessboard" {
        "" // chessboard has no color variant
    } else {
        return None; // Can't determine color
    };

    // Build texture filename
    let tex_name = if color.is_empty() {
        format!("{piece}_base_color.jpg")
    } else {
        format!("{piece}_{color}_base_color.jpg")
    };

    // Capitalize piece name for directory
    let piece_cap = {
        let mut c = piece.chars();
        match c.next() {
            None => String::new(),
            Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        }
    };

    // Search in OpenChessSet directory structure
    let search_paths = [
        usd_dir.join(format!("OpenChessSet/assets/{piece_cap}/tex/{tex_name}")),
        usd_dir.join(format!("tex/{tex_name}")),
        usd_dir.join(&tex_name),
    ];

    for path in &search_paths {
        if path.exists() {
            match std::fs::read(path) {
                Ok(bytes) => {
                    info!(mesh = %mesh_name, texture = %path.display(), bytes = bytes.len(),
                          "Found base_color texture by convention");
                    return Some(bytes);
                }
                Err(e) => warn!(path = %path.display(), error = %e, "Failed to read texture"),
            }
        }
    }

    debug!(mesh = %mesh_name, "No base_color texture found by convention");
    None
}

/// Extract mesh geometry from a prim path with an optional additional transform.
fn extract_mesh_with_transform(
    reader: &mut dyn AbstractData,

    path: &str,

    extra_transform: Option<&[f64; 16]>,

    name_override: Option<&str>,

    usd_dir: &Path,
) -> Option<ExtractedMesh> {
    let points = get_property(reader, path, "points").and_then(|v| get_f32_array(&v))?;

    if points.len() < 3 {
        return None;
    }

    let fvc = get_property(reader, path, "faceVertexCounts").and_then(|v| get_i32_array(&v))?;

    let fvi = get_property(reader, path, "faceVertexIndices").and_then(|v| get_i32_array(&v))?;

    let normals = get_property(reader, path, "normals").and_then(|v| get_f32_array(&v));

    // Texture coordinates (faceVarying: one UV per face-vertex)
    let uvs_raw = get_property(reader, path, "primvars:st").and_then(|v| get_f32_array(&v));

    let base_world = compute_world_matrix(reader, path);

    let world = match extra_transform {
        Some(extra) => mat4_mul(extra, &base_world),

        None => base_world,
    };

    let color = color_for_path(path);

    let name = match name_override {
        Some(n) => n.to_string(),

        None => mesh_name_from_path(path),
    };

    let mut vertices: Vec<f32> = Vec::new();
    let mut uvs: Vec<f32> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();

    let mut fvi_off: usize = 0;

    for &count in &fvc {
        let count = count as usize;

        let face_start = (vertices.len() / 9) as u32;

        for j in 0..count {
            if fvi_off + j >= fvi.len() {
                break;
            }

            let vi = fvi[fvi_off + j] as usize;

            if vi * 3 + 2 >= points.len() {
                continue;
            }

            // Transform position by world matrix

            let wp = mat4_transform_point(
                &world,
                [
                    points[vi * 3] as f64,
                    points[vi * 3 + 1] as f64,
                    points[vi * 3 + 2] as f64,
                ],
            );

            let px = wp[0] as f32;

            let py = wp[1] as f32;

            let pz = wp[2] as f32;

            // Transform normal by world matrix (direction only, then normalize)

            let (nx, ny, nz) = if let Some(ref n) = normals {
                let ni = fvi_off + j;

                let raw = if ni * 3 + 2 < n.len() {
                    [n[ni * 3] as f64, n[ni * 3 + 1] as f64, n[ni * 3 + 2] as f64]
                } else if vi * 3 + 2 < n.len() {
                    [n[vi * 3] as f64, n[vi * 3 + 1] as f64, n[vi * 3 + 2] as f64]
                } else {
                    [0.0, 1.0, 0.0]
                };

                let tn = vec3_normalize(mat4_transform_dir(&world, raw));

                (tn[0] as f32, tn[1] as f32, tn[2] as f32)
            } else {
                (0.0, 1.0, 0.0)
            };

            // Extract UV (faceVarying: indexed by fvi_off + j)
            let (u, v) = if let Some(ref st) = uvs_raw {
                let ui = (fvi_off + j) * 2;
                if ui + 1 < st.len() {
                    (st[ui], st[ui + 1])
                } else {
                    (0.0, 0.0)
                }
            } else {
                (0.0, 0.0)
            };
            uvs.extend_from_slice(&[u, v]);

            vertices.extend_from_slice(&[px, py, pz, nx, ny, nz, color[0], color[1], color[2]]);
        }

        for tri in 1..(count as u32 - 1) {
            indices.push(face_start);

            indices.push(face_start + tri);

            indices.push(face_start + tri + 1);
        }

        fvi_off += count;
    }

    if indices.is_empty() {
        return None;
    }

    // Resolve base_color texture: try material:binding first, then convention fallback
    let base_color_tex = resolve_material_texture(reader, path, usd_dir)
        .or_else(|| find_texture_by_convention(&name, usd_dir));

    debug!(name = %name, tris = indices.len() / 3,
           has_texture = base_color_tex.is_some(), "Extracted mesh");

    Some(ExtractedMesh {
        name,
        vertices,
        indices,
        uvs,
        base_color_tex: base_color_tex.unwrap_or_default(),
    })
}

/// Extract mesh geometry from a prim path (no extra transform).
fn extract_mesh(
    reader: &mut dyn AbstractData,
    path: &str,
    usd_dir: &Path,
) -> Option<ExtractedMesh> {
    extract_mesh_with_transform(reader, path, None, None, usd_dir)
}

/// Resolve a PointInstancer: clone prototype meshes at each instance position.
fn resolve_point_instancer(
    reader: &mut dyn AbstractData,

    instancer_path: &str,

    usd_dir: &Path,
) -> Vec<ExtractedMesh> {
    let mut meshes = Vec::new();

    // Read instance positions (Vec3f array)

    let positions = match get_property(reader, instancer_path, "positions") {
        Some(val) => match get_f32_array(&val) {
            Some(arr) if arr.len() >= 3 => arr,

            _ => return meshes,
        },

        None => return meshes,
    };

    let num_instances = positions.len() / 3;

    // Read prototype paths from primChildren - prototypes are child prims

    let proto_children: Vec<String> = get_prim_field(reader, instancer_path, "primChildren")
        .and_then(|v| {
            if let sdf::Value::TokenVec(c) = v {
                Some(c)
            } else {
                None
            }
        })
        .unwrap_or_default();

    if proto_children.is_empty() {
        warn!(path = %instancer_path, "PointInstancer has no prototype children");

        return meshes;
    }

    // Get the instancer's world transform

    let instancer_world = compute_world_matrix(reader, instancer_path);

    // Find mesh prims under each prototype

    for proto_name in &proto_children {
        let proto_path = format!("{instancer_path}/{proto_name}");

        let mut proto_mesh_paths = Vec::new();

        find_meshes(reader, &proto_path, &mut proto_mesh_paths, 0);

        if proto_mesh_paths.is_empty() {
            continue;
        }

        info!(

            instancer = %instancer_path,

            prototype = %proto_path,

            instances = num_instances,

            proto_meshes = proto_mesh_paths.len(),

            "Expanding PointInstancer"

        );

        // For each instance, clone the prototype meshes with position offset

        for i in 0..num_instances {
            let px = positions[i * 3] as f64;

            let py = positions[i * 3 + 1] as f64;

            let pz = positions[i * 3 + 2] as f64;

            // Instance transform = instancer_world * translate(position)

            let instance_mat = mat4_mul(&instancer_world, &mat4_translate([px, py, pz]));

            for mesh_path in &proto_mesh_paths {
                let mesh_leaf = mesh_path.rsplit('/').next().unwrap_or("mesh");

                let parent_leaf = mesh_path.rsplit('/').nth(1).unwrap_or("");

                let team = if instancer_path.contains("Black") {
                    "Black"
                } else if instancer_path.contains("White") {
                    "White"
                } else {
                    ""
                };

                let instance_name = format!("{team}_Pawn{i}_{parent_leaf}_{mesh_leaf}");

                if let Some(mesh) = extract_mesh_with_transform(
                    reader,
                    mesh_path,
                    Some(&instance_mat),
                    Some(&instance_name),
                    usd_dir,
                ) {
                    debug!(name = %mesh.name, tris = mesh.indices.len() / 3, "Instanced mesh");

                    meshes.push(mesh);
                }
            }
        }
    }

    meshes
}

/// Recursively find all Mesh and PointInstancer prims.
fn find_meshes(
    reader: &mut dyn AbstractData,

    parent_path: &str,

    mesh_paths: &mut Vec<String>,

    depth: usize,
) {
    if depth > 20 {
        return;
    }

    if let Some(sdf::Value::Token(ref t)) = get_prim_field(reader, parent_path, "typeName") {
        if t == "Mesh" {
            mesh_paths.push(parent_path.to_string());

            return;
        }

        // Skip PointInstancer children - they are handled by resolve_point_instancer

        if t == "PointInstancer" {
            return;
        }
    }

    let children: Vec<String> = get_prim_field(reader, parent_path, "primChildren")
        .and_then(|v| {
            if let sdf::Value::TokenVec(c) = v {
                Some(c)
            } else {
                None
            }
        })
        .unwrap_or_default();

    for child in &children {
        let child_path = if parent_path == "/" {
            format!("/{child}")
        } else {
            format!("{parent_path}/{child}")
        };

        find_meshes(reader, &child_path, mesh_paths, depth + 1);
    }
}

/// Find all PointInstancer prims.
fn find_point_instancers(
    reader: &mut dyn AbstractData,

    parent_path: &str,

    instancer_paths: &mut Vec<String>,

    depth: usize,
) {
    if depth > 20 {
        return;
    }

    if let Some(sdf::Value::Token(ref t)) = get_prim_field(reader, parent_path, "typeName") {
        if t == "PointInstancer" {
            instancer_paths.push(parent_path.to_string());

            return;
        }
    }

    let children: Vec<String> = get_prim_field(reader, parent_path, "primChildren")
        .and_then(|v| {
            if let sdf::Value::TokenVec(c) = v {
                Some(c)
            } else {
                None
            }
        })
        .unwrap_or_default();

    for child in &children {
        let child_path = if parent_path == "/" {
            format!("/{child}")
        } else {
            format!("{parent_path}/{child}")
        };

        find_point_instancers(reader, &child_path, instancer_paths, depth + 1);
    }
}

/// Load a pre-flattened USD file and extract all mesh geometry.
pub fn load_stage(path: &Path) -> Result<Vec<ExtractedMesh>> {
    info!(path = %path.display(), "Loading USD stage");

    let usd_dir = path.parent().unwrap_or_else(|| Path::new("."));

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    let mut reader: Box<dyn AbstractData> = match ext {
        "usdc" | "usd" => openusd::usdc::read_file(path).context("Failed to open USDC")?,

        "usda" => Box::new(openusd::usda::TextReader::read(path).context("Failed to read USDA")?),

        _ => anyhow::bail!("Unsupported USD format: {ext}"),
    };

    // Find regular meshes (skips PointInstancer children)

    let mut mesh_paths = Vec::new();

    find_meshes(reader.as_mut(), "/", &mut mesh_paths, 0);

    info!(count = mesh_paths.len(), "Found mesh prims");

    let mut meshes = Vec::new();

    for mp in &mesh_paths {
        if let Some(mesh) = extract_mesh(reader.as_mut(), mp, usd_dir) {
            info!(name = %mesh.name, tris = mesh.indices.len() / 3,
                  tex_bytes = mesh.base_color_tex.len(), "Loaded mesh");

            meshes.push(mesh);
        } else {
            warn!(path = %mp, "Failed to extract mesh");
        }
    }

    // Find and expand PointInstancers (pawns)

    let mut instancer_paths = Vec::new();

    find_point_instancers(reader.as_mut(), "/", &mut instancer_paths, 0);

    if !instancer_paths.is_empty() {
        info!(count = instancer_paths.len(), "Found PointInstancers");

        for ip in &instancer_paths {
            let expanded = resolve_point_instancer(reader.as_mut(), ip, usd_dir);

            info!(instancer = %ip, expanded = expanded.len(), "Expanded PointInstancer");

            meshes.extend(expanded);
        }
    }

    info!(total = meshes.len(), "USD stage loaded");

    Ok(meshes)
}
