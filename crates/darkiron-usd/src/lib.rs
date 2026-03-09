#![deny(clippy::all)]

//! darkiron-usd — USD stage reader for DarkIron Engine.
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
}

fn color_for_path(path: &str) -> [f32; 3] {
    if path.contains("Black") { [0.12, 0.10, 0.08] }
    else if path.contains("White") { [0.92, 0.89, 0.84] }
    else if path.contains("Chessboard") { [0.45, 0.35, 0.25] }
    else { [0.5, 0.5, 0.5] }
}

fn mesh_name_from_path(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() >= 3 { parts[1..].join("_") }
    else { parts.last().unwrap_or(&"mesh").to_string() }
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
    reader.get(&prop_path, "default").ok().map(|v| v.into_owned())
}

/// Accumulate translations from ancestor prims.
///
/// LIMITATION: Only handles xformOp:translate. Does NOT handle rotations,
/// scales, pivot points, or full xformOpOrder stacks. This will cause
/// incorrect placement for USD assets with complex transforms.
/// TODO(phase2-followup): Implement full 4x4 matrix composition from
/// xformOpOrder (translate, rotateXYZ, scale, transform) to support
/// arbitrary USD transform stacks.
fn collect_translation(reader: &mut dyn AbstractData, mesh_path: &str) -> [f32; 3] {
    let mut total = [0.0_f64; 3];
    let parts: Vec<&str> = mesh_path.split('/').filter(|p| !p.is_empty()).collect();
    for i in 1..parts.len() {
        let ancestor = format!("/{}", parts[..i].join("/"));
        if let Some(val) = get_property(reader, &ancestor, "xformOp:translate") {
            if let Some(t) = get_double3(&val) {
                total[0] += t[0];
                total[1] += t[1];
                total[2] += t[2];
            }
        }
    }
    [total[0] as f32, total[1] as f32, total[2] as f32]
}

/// Extract mesh geometry from a prim path.
fn extract_mesh(reader: &mut dyn AbstractData, path: &str) -> Option<ExtractedMesh> {
    let points = get_property(reader, path, "points").and_then(|v| get_f32_array(&v))?;
    if points.len() < 3 { return None; }

    let fvc = get_property(reader, path, "faceVertexCounts").and_then(|v| get_i32_array(&v))?;
    let fvi = get_property(reader, path, "faceVertexIndices").and_then(|v| get_i32_array(&v))?;
    let normals = get_property(reader, path, "normals").and_then(|v| get_f32_array(&v));

    let t = collect_translation(reader, path);
    let color = color_for_path(path);
    let name = mesh_name_from_path(path);

    let mut vertices: Vec<f32> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    let mut fvi_off: usize = 0;

    for &count in &fvc {
        let count = count as usize;
        let face_start = (vertices.len() / 9) as u32;

        for j in 0..count {
            if fvi_off + j >= fvi.len() { break; }
            let vi = fvi[fvi_off + j] as usize;
            if vi * 3 + 2 >= points.len() { continue; }

            let px = points[vi * 3] + t[0];
            let py = points[vi * 3 + 1] + t[1];
            let pz = points[vi * 3 + 2] + t[2];

            let (nx, ny, nz) = if let Some(ref n) = normals {
                let ni = fvi_off + j;
                if ni * 3 + 2 < n.len() { (n[ni*3], n[ni*3+1], n[ni*3+2]) }
                else if vi * 3 + 2 < n.len() { (n[vi*3], n[vi*3+1], n[vi*3+2]) }
                else { (0.0, 1.0, 0.0) }
            } else { (0.0, 1.0, 0.0) };

            vertices.extend_from_slice(&[px, py, pz, nx, ny, nz, color[0], color[1], color[2]]);
        }

        for tri in 1..(count as u32 - 1) {
            indices.push(face_start);
            indices.push(face_start + tri);
            indices.push(face_start + tri + 1);
        }
        fvi_off += count;
    }

    if indices.is_empty() { return None; }
    debug!(name = %name, tris = indices.len() / 3, "Extracted mesh");
    Some(ExtractedMesh { name, vertices, indices })
}

/// Recursively find all Mesh prims.
fn find_meshes(
    reader: &mut dyn AbstractData,
    parent_path: &str,
    mesh_paths: &mut Vec<String>,
    depth: usize,
) {
    if depth > 20 { return; }

    // Check if this prim is a Mesh
    if let Some(sdf::Value::Token(ref t)) = get_prim_field(reader, parent_path, "typeName") {
        if t == "Mesh" {
            mesh_paths.push(parent_path.to_string());
            return;
        }
    }

    // Clone children list to avoid borrow conflict
    let children: Vec<String> = get_prim_field(reader, parent_path, "primChildren")
        .and_then(|v| if let sdf::Value::TokenVec(c) = v { Some(c) } else { None })
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

/// Load a pre-flattened USD file and extract all mesh geometry.
pub fn load_stage(path: &Path) -> Result<Vec<ExtractedMesh>> {
    info!(path = %path.display(), "Loading USD stage");

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mut reader: Box<dyn AbstractData> = match ext {
        "usdc" | "usd" => {
            openusd::usdc::read_file(path).context("Failed to open USDC")?
        }
        "usda" => {
            Box::new(openusd::usda::TextReader::read(path).context("Failed to read USDA")?)
        }
        _ => anyhow::bail!("Unsupported USD format: {ext}"),
    };

    let mut mesh_paths = Vec::new();
    find_meshes(reader.as_mut(), "/", &mut mesh_paths, 0);
    info!(count = mesh_paths.len(), "Found mesh prims");

    let mut meshes = Vec::new();
    for mp in &mesh_paths {
        if let Some(mesh) = extract_mesh(reader.as_mut(), mp) {
            info!(name = %mesh.name, tris = mesh.indices.len() / 3, "Loaded mesh");
            meshes.push(mesh);
        } else {
            warn!(path = %mp, "Failed to extract mesh");
        }
    }

    info!(total = meshes.len(), "USD stage loaded");
    Ok(meshes)
}

