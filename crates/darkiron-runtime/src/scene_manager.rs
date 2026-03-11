//! Scene loading, building, and publishing.
//!
//! Builds scene data as FlatBuffers and publishes to NATS.
//! Supports JSON scene files and USD (usdc/usda) via darkiron-usd.

use anyhow::Result;
use darkiron_transport::DarkIronTransport;
use std::path::Path;
use tracing::{error, info, warn};

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
    meshes_to_flatbuffers(session_id, &[("default_cube", &vertices, &indices, &[])])
}

/// Convert a list of meshes to FlatBuffers SceneEvent bytes.
fn meshes_to_flatbuffers(session_id: &str, meshes: &[(&str, &[f32], &[u32], &[f32])]) -> Vec<u8> {
    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(1024 * 1024);
    let mut mesh_offsets = Vec::new();

    for &(name_str, verts, idxs, uvs) in meshes {
        let name = builder.create_string(name_str);
        let verts_vec = builder.create_vector(verts);
        let idx_vec = builder.create_vector(idxs);
        let uvs_vec = if uvs.is_empty() { None } else { Some(builder.create_vector(uvs)) };
        let mesh = fb::MeshData::create(
            &mut builder,
            &fb::MeshDataArgs {
                name: Some(name),
                vertices: Some(verts_vec),
                indices: Some(idx_vec),
                uvs: uvs_vec,
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
        let mesh_data: Vec<(&str, &[f32], &[u32], &[f32])> = chunk
            .iter()
            .map(|m| (m.name.as_str(), m.vertices.as_slice(), m.indices.as_slice(), m.uvs.as_slice()))
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

/// Check if a file extension is a supported USD format.
fn is_usd_file(path: &Path) -> bool {
    path.extension()
        .map(|e| matches!(e.to_str(), Some("usdc" | "usda" | "usd")))
        .unwrap_or(false)
}

/// Scan assets directory for scene files (JSON + USD), publish via NATS.
pub async fn load_and_publish_assets(
    transport: &DarkIronTransport,
    assets_dir: &Path,
    session_id: &str,
) -> bool {
    let mut any_loaded = false;

    let entries = match std::fs::read_dir(assets_dir) {
        Ok(e) => e,
        Err(_) => return false,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let subject = format!("scene.{session_id}.loaded");

        if is_usd_file(&path) {
            match load_usd_file(&path, session_id) {
                Ok(payloads) => {
                    for payload in &payloads {
                        if let Err(e) = publish_scene(transport, &subject, payload).await {
                            error!(file = %path.display(), error = %e, "Failed to publish USD batch");
                        }
                    }
                    info!(file = %path.display(), batches = payloads.len(), "Published USD scene");
                    any_loaded = true;
                }
                Err(e) => warn!(file = %path.display(), error = %e, "Failed to load USD"),
            }
        } else if path.extension().is_some_and(|e| e == "json") {
            match load_scene_file(&path, session_id) {
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
