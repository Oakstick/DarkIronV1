//! Scene loading, building, and publishing.
//!
//! Builds scene data as FlatBuffers and publishes to NATS.
//! JSON is only used for reading scene files from disk.

use anyhow::Result;
use darkiron_transport::DarkIronTransport;
use std::path::Path;
use tracing::{info, warn, error};

// Include the generated FlatBuffers code
#[path = "../../../schemas/generated/rust/scene_generated.rs"]
#[allow(unused_imports, dead_code, clippy::all)]
mod schema;

use schema::darkiron::schema as fb;

/// Build a colored unit cube scene as FlatBuffers bytes.
pub fn build_cube_scene(session_id: &str) -> Vec<u8> {
    let s: f32 = 0.5;
    let faces: Vec<([f32; 3], [f32; 3], [[f32; 3]; 4])> = vec![
        ([0.0, 0.0, 1.0], [1.0, 0.2, 0.2], [[-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]]),
        ([0.0, 0.0, -1.0], [0.2, 1.0, 1.0], [[s, -s, -s], [-s, -s, -s], [-s, s, -s], [s, s, -s]]),
        ([1.0, 0.0, 0.0], [0.2, 1.0, 0.2], [[s, -s, s], [s, -s, -s], [s, s, -s], [s, s, s]]),
        ([-1.0, 0.0, 0.0], [1.0, 0.2, 1.0], [[-s, -s, -s], [-s, -s, s], [-s, s, s], [-s, s, -s]]),
        ([0.0, 1.0, 0.0], [1.0, 1.0, 0.2], [[-s, s, s], [s, s, s], [s, s, -s], [-s, s, -s]]),
        ([0.0, -1.0, 0.0], [0.2, 0.2, 1.0], [[-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s]]),
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

    // Build FlatBuffer
    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(1024);

    let name = builder.create_string("default_cube");
    let verts_vec = builder.create_vector(&vertices);
    let idx_vec = builder.create_vector(&indices);

    let mesh = fb::MeshData::create(&mut builder, &fb::MeshDataArgs {
        name: Some(name),
        vertices: Some(verts_vec),
        indices: Some(idx_vec),
    });

    let sid = builder.create_string(session_id);
    let meshes_vec = builder.create_vector(&[mesh]);
    let scene = fb::SceneLoaded::create(&mut builder, &fb::SceneLoadedArgs {
        session_id: Some(sid),
        meshes: Some(meshes_vec),
    });

    let event = fb::SceneEvent::create(&mut builder, &fb::SceneEventArgs {
        payload_type: fb::SceneEventPayload::SceneLoaded,
        payload: Some(scene.as_union_value()),
        timestamp_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    });

    builder.finish(event, None);
    builder.finished_data().to_vec()
}

/// Load a scene from a JSON file on disk, convert to FlatBuffers bytes.
pub fn load_scene_file(path: &Path, session_id: &str) -> Result<Vec<u8>> {
    let content = std::fs::read_to_string(path)?;
    let scene: serde_json::Value = serde_json::from_str(&content)?;

    let meshes = scene.get("meshes")
        .and_then(|m| m.as_array())
        .ok_or_else(|| anyhow::anyhow!("No meshes array in scene file"))?;

    let mut builder = flatbuffers::FlatBufferBuilder::with_capacity(1024 * 1024);

    let mut mesh_offsets = Vec::new();
    for mesh_val in meshes {
        let name_str = mesh_val.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
        let name = builder.create_string(name_str);

        let verts: Vec<f32> = mesh_val.get("vertices")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect())
            .unwrap_or_default();

        let idxs: Vec<u32> = mesh_val.get("indices")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_u64().map(|i| i as u32)).collect())
            .unwrap_or_default();

        let verts_vec = builder.create_vector(&verts);
        let idx_vec = builder.create_vector(&idxs);

        let mesh = fb::MeshData::create(&mut builder, &fb::MeshDataArgs {
            name: Some(name),
            vertices: Some(verts_vec),
            indices: Some(idx_vec),
        });
        mesh_offsets.push(mesh);
    }

    let sid = builder.create_string(session_id);
    let meshes_vec = builder.create_vector(&mesh_offsets);
    let scene_loaded = fb::SceneLoaded::create(&mut builder, &fb::SceneLoadedArgs {
        session_id: Some(sid),
        meshes: Some(meshes_vec),
    });

    let event = fb::SceneEvent::create(&mut builder, &fb::SceneEventArgs {
        payload_type: fb::SceneEventPayload::SceneLoaded,
        payload: Some(scene_loaded.as_union_value()),
        timestamp_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    });

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

/// Scan assets directory for `.json` scene files, convert to FlatBuffers, publish.
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
        if path.extension().is_some_and(|e| e == "json") {
            match load_scene_file(&path, session_id) {
                Ok(payload) => {
                    let subject = format!("scene.{session_id}.loaded");
                    match publish_scene(transport, &subject, &payload).await {
                        Ok(()) => {
                            info!(file = %path.display(), bytes = payload.len(), "Published FlatBuffers scene");
                            any_loaded = true;
                        }
                        Err(e) => error!(file = %path.display(), error = %e, "Failed to publish scene"),
                    }
                }
                Err(e) => warn!(file = %path.display(), error = %e, "Failed to load scene"),
            }
        }
    }

    any_loaded
}

/// Hot-reload a changed file: re-read, convert to FlatBuffers, publish.
pub async fn hot_reload(
    transport: &DarkIronTransport,
    changed_path: &Path,
    session_id: &str,
) {
    match load_scene_file(changed_path, session_id) {
        Ok(payload) => {
            let subject = format!("scene.{session_id}.loaded");
            match publish_scene(transport, &subject, &payload).await {
                Ok(()) => info!(file = %changed_path.display(), bytes = payload.len(), "Hot reload complete (FlatBuffers)"),
                Err(e) => error!(file = %changed_path.display(), error = %e, "Failed to publish reloaded scene"),
            }
        }
        Err(e) => warn!(file = %changed_path.display(), error = %e, "Failed to reload scene"),
    }
}

