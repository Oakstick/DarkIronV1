//! Scene loading, building, and publishing.
//!
//! Builds scene data as FlatBuffers and publishes to NATS.
//! Supports JSON scene files and USD (usdc/usda) via darkiron-usd.

use anyhow::Result;
use darkiron_transport::DarkIronTransport;
use std::path::Path;
use tracing::{debug, error, info, warn};

// Include the generated FlatBuffers code
#[path = "../../../schemas/generated/rust/scene_generated.rs"]
#[allow(warnings, clippy::all)]
mod schema;

use schema::darkiron::schema as fb;

/// Face definition: (normal, color, 4 vertex positions).
type CubeFace = ([f32; 3], [f32; 3], [[f32; 3]; 4]);

/// Build a colored unit cube scene as FlatBuffers bytes.
pub fn build_cube_scene(session_id: &str) -> Vec<u8> {
    let s: f32 = 0.5;
    let faces: Vec<CubeFace> = vec![
        (
            [0.0, 0.0, 1.0],
            [1.0, 0.2, 0.2],
            [[-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]],
        ),
        (
            [0.0, 0.0, -1.0],
            [0.2, 1.0, 1.0],
            [[s, -s, -s], [-s, -s, -s], [-s, s, -s], [s, s, -s]],
        ),
        (
            [1.0, 0.0, 0.0],
            [0.2, 1.0, 0.2],
            [[s, -s, s], [s, -s, -s], [s, s, -s], [s, s, s]],
        ),
        (
            [-1.0, 0.0, 0.0],
            [1.0, 0.2, 1.0],
            [[-s, -s, -s], [-s, -s, s], [-s, s, s], [-s, s, -s]],
        ),
        (
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 0.2],
            [[-s, s, s], [s, s, s], [s, s, -s], [-s, s, -s]],
        ),
        (
            [0.0, -1.0, 0.0],
            [0.2, 0.2, 1.0],
            [[-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s]],
        ),
    ];

    let mut vertices: Vec<f32> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    let mut vi: u32 = 0;
    for (normal, color, verts) in &faces {
        for v in verts {
            vertices.extend_from_slice(v);
            vertices.extend_from_slice(normal);
            vertices.extend_from_slice(color);
        }
        indices.extend_from_slice(&[vi, vi + 1, vi + 2, vi, vi + 2, vi + 3]);
        vi += 4;
    }
    meshes_to_flatbuffers(
        session_id,
        &[("default_cube", &vertices, &indices, &[], &[], None)],
    )
}

/// Mesh data tuple: (name, vertices, indices, uvs, base_color_tex_bytes, material)
type MeshTuple<'a> = (
    &'a str,
    &'a [f32],
    &'a [u32],
    &'a [f32],
    &'a [u8],
    Option<&'a darkiron_usd::MaterialInfo>,
);

/// Convert a list of meshes to FlatBuffers SceneEvent bytes.
fn meshes_to_flatbuffers(session_id: &str, meshes: &[MeshTuple<'_>]) -> Vec<u8> {
    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(1024 * 1024);
    let mut mesh_offsets = Vec::new();

    for &(name_str, verts, idxs, uvs, tex, mat) in meshes {
        let name = builder.create_string(name_str);
        let verts_vec = builder.create_vector(verts);
        let idx_vec = builder.create_vector(idxs);
        let uvs_vec = if uvs.is_empty() {
            None
        } else {
            Some(builder.create_vector(uvs))
        };
        let tex_vec = if tex.is_empty() {
            None
        } else {
            Some(builder.create_vector(tex))
        };

        // Build MaterialData if material info is present
        let material = mat.map(|m| {
            let mat_name = builder.create_string(&m.name);
            let bc = m
                .base_color_tex
                .as_deref()
                .map(|s| builder.create_string(s));
            let nm = m.normal_tex.as_deref().map(|s| builder.create_string(s));
            let rg = m.roughness_tex.as_deref().map(|s| builder.create_string(s));
            let mt = m.metallic_tex.as_deref().map(|s| builder.create_string(s));
            fb::MaterialData::create(
                &mut builder,
                &fb::MaterialDataArgs {
                    name: Some(mat_name),
                    base_color_path: bc,
                    normal_path: nm,
                    roughness_path: rg,
                    metallic_path: mt,
                },
            )
        });

        let mesh = fb::MeshData::create(
            &mut builder,
            &fb::MeshDataArgs {
                name: Some(name),
                vertices: Some(verts_vec),
                indices: Some(idx_vec),
                uvs: uvs_vec,
                base_color_tex: tex_vec,
                material,
            },
        );
        mesh_offsets.push(mesh);
    }

    let sid = builder.create_string(session_id);
    let meshes_vec = builder.create_vector(&mesh_offsets);
    let scene = fb::SceneLoaded::create(
        &mut builder,
        &fb::SceneLoadedArgs {
            session_id: Some(sid),
            meshes: Some(meshes_vec),
        },
    );
    let event = fb::SceneEvent::create(
        &mut builder,
        &fb::SceneEventArgs {
            payload_type: fb::SceneEventPayload::SceneLoaded,
            payload: Some(scene.as_union_value()),
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        },
    );
    builder.finish(event, None);
    builder.finished_data().to_vec()
}

/// Load a USD file (usdc/usda) via darkiron-usd, convert to FlatBuffers.
pub fn load_usd_file(path: &Path, session_id: &str) -> Result<Vec<Vec<u8>>> {
    info!(file = %path.display(), "Loading USD via darkiron-usd...");
    let extracted = darkiron_usd::load_stage(path)?;

    let mut payloads = Vec::new();
    for chunk in extracted.chunks(1) {
        let mesh_data: Vec<MeshTuple<'_>> = chunk
            .iter()
            .map(|m| {
                (
                    m.name.as_str(),
                    m.vertices.as_slice(),
                    m.indices.as_slice(),
                    m.uvs.as_slice(),
                    m.base_color_tex.as_slice(),
                    m.material.as_ref(),
                )
            })
            .collect();
        payloads.push(meshes_to_flatbuffers(session_id, &mesh_data));
    }
    info!(batches = payloads.len(), "Built FlatBuffers from USD");
    Ok(payloads)
}

/// Load a scene from a JSON file on disk, convert to FlatBuffers bytes.
pub fn load_scene_file(path: &Path, session_id: &str) -> Result<Vec<u8>> {
    let content = std::fs::read_to_string(path)?;
    let scene: serde_json::Value = serde_json::from_str(&content)?;

    let meshes = scene
        .get("meshes")
        .and_then(|m| m.as_array())
        .ok_or_else(|| anyhow::anyhow!("No meshes array in scene file"))?;

    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(1024 * 1024);
    let mut mesh_offsets = Vec::new();
    for mesh_val in meshes {
        let name_str = mesh_val
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("unknown");
        let name = builder.create_string(name_str);
        let verts: Vec<f32> = mesh_val
            .get("vertices")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_f64().map(|f| f as f32))
                    .collect()
            })
            .unwrap_or_default();
        let idxs: Vec<u32> = mesh_val
            .get("indices")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_u64().map(|i| i as u32))
                    .collect()
            })
            .unwrap_or_default();
        let verts_vec = builder.create_vector(&verts);
        let idx_vec = builder.create_vector(&idxs);
        let mesh = fb::MeshData::create(
            &mut builder,
            &fb::MeshDataArgs {
                name: Some(name),
                vertices: Some(verts_vec),
                indices: Some(idx_vec),
                uvs: None,
                base_color_tex: None,
                material: None,
            },
        );
        mesh_offsets.push(mesh);
    }
    let sid = builder.create_string(session_id);
    let meshes_vec = builder.create_vector(&mesh_offsets);
    let scene_loaded = fb::SceneLoaded::create(
        &mut builder,
        &fb::SceneLoadedArgs {
            session_id: Some(sid),
            meshes: Some(meshes_vec),
        },
    );
    let event = fb::SceneEvent::create(
        &mut builder,
        &fb::SceneEventArgs {
            payload_type: fb::SceneEventPayload::SceneLoaded,
            payload: Some(scene_loaded.as_union_value()),
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        },
    );
    builder.finish(event, None);
    Ok(builder.finished_data().to_vec())
}

/// Publish raw FlatBuffer bytes to NATS.
pub async fn publish_scene(
    transport: &DarkIronTransport,
    subject: &str,
    payload: &[u8],
) -> Result<()> {
    transport.publish(subject, payload).await?;
    Ok(())
}

/// Check if a file extension is a supported scene format (USD binary + JSON).
/// Note: `.usda` (ASCII) is excluded — the openusd crate does not yet support
/// parsing prim properties in text format, and attempting it causes a panic.
fn is_scene_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| matches!(ext, "usdc" | "usd" | "json"))
}

/// Check if a file extension is a supported USD format (binary only).
fn is_usd_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| matches!(ext, "usdc" | "usd"))
}

/// Recursively collect all scene files (USD + JSON) under a directory.
///
/// Uses an iterative stack to avoid deep recursion. Caps traversal at
/// `max_depth` levels to guard against symlink loops or adversarial trees.
/// O(n) in total filesystem entries; allocates one Vec for the result.
fn collect_scene_files(root: &Path, max_depth: usize) -> Vec<std::path::PathBuf> {
    let mut result = Vec::new();
    let mut stack: Vec<(std::path::PathBuf, usize)> = vec![(root.to_path_buf(), 0)];

    while let Some((dir, depth)) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) => {
                warn!(path = %dir.display(), error = %e, "Cannot read directory");
                continue;
            }
        };

        for entry in entries.flatten() {
            // Skip symlinks to avoid cycles and unexpected traversal outside assets_dir.
            let is_symlink = entry.file_type().map(|ft| ft.is_symlink()).unwrap_or(false);
            if is_symlink {
                debug!(path = %entry.path().display(), "Skipping symlink");
                continue;
            }

            let path = entry.path();
            if path.is_dir() {
                if depth < max_depth {
                    stack.push((path, depth + 1));
                }
            } else if is_scene_file(&path) {
                result.push(path);
            }
        }
    }

    // Sort for deterministic load order (alphabetical by full path).
    result.sort();
    result
}

/// Scan assets directory tree for scene files (JSON + USD), publish via NATS.
///
/// Recurses up to 4 levels deep so nested asset packs like
/// `assets/OpenChessSet/chess_set.usdc` are discovered automatically.
pub async fn load_and_publish_assets(
    transport: &DarkIronTransport,
    assets_dir: &Path,
    session_id: &str,
) -> bool {
    let files = collect_scene_files(assets_dir, 4);
    if files.is_empty() {
        info!(dir = %assets_dir.display(), "No scene files found");
        return false;
    }

    info!(dir = %assets_dir.display(), count = files.len(), "Discovered scene files");

    let mut any_loaded = false;
    let subject = format!("scene.{session_id}.loaded");

    for path in &files {
        if is_usd_file(path) {
            // Guard against panics in the USD parser (e.g. unimplemented features).
            let path_clone = path.clone();
            let sid = session_id.to_string();
            let result = std::panic::catch_unwind(|| load_usd_file(&path_clone, &sid));
            match result {
                Ok(Ok(payloads)) => {
                    for payload in &payloads {
                        if let Err(e) = publish_scene(transport, &subject, payload).await {
                            error!(file = %path.display(), error = %e, "Failed to publish USD batch");
                        }
                    }
                    info!(file = %path.display(), batches = payloads.len(), "Published USD scene");
                    any_loaded = true;
                }
                Ok(Err(e)) => warn!(file = %path.display(), error = %e, "Failed to load USD"),
                Err(_) => error!(file = %path.display(), "USD parser panicked — skipping file"),
            }
        } else if path.extension().is_some_and(|e| e == "json") {
            match load_scene_file(path, session_id) {
                Ok(payload) => match publish_scene(transport, &subject, &payload).await {
                    Ok(()) => {
                        info!(file = %path.display(), bytes = payload.len(), "Published JSON scene");
                        any_loaded = true;
                    }
                    Err(e) => error!(file = %path.display(), error = %e, "Failed to publish"),
                },
                Err(e) => warn!(file = %path.display(), error = %e, "Failed to load JSON"),
            }
        }
    }

    any_loaded
}

/// Hot-reload: re-read changed file, convert, publish.
pub async fn hot_reload(transport: &DarkIronTransport, changed_path: &Path, session_id: &str) {
    let subject = format!("scene.{session_id}.loaded");

    if is_usd_file(changed_path) {
        match load_usd_file(changed_path, session_id) {
            Ok(payloads) => {
                for payload in &payloads {
                    if let Err(e) = publish_scene(transport, &subject, payload).await {
                        error!(file = %changed_path.display(), error = %e, "Failed to publish");
                    }
                }
                info!(file = %changed_path.display(), batches = payloads.len(), "Hot reload complete (USD)");
            }
            Err(e) => warn!(file = %changed_path.display(), error = %e, "Failed to reload USD"),
        }
    } else {
        match load_scene_file(changed_path, session_id) {
            Ok(payload) => match publish_scene(transport, &subject, &payload).await {
                Ok(()) => {
                    info!(file = %changed_path.display(), bytes = payload.len(), "Hot reload complete")
                }
                Err(e) => error!(file = %changed_path.display(), error = %e, "Failed to publish"),
            },
            Err(e) => warn!(file = %changed_path.display(), error = %e, "Failed to reload"),
        }
    }
}
