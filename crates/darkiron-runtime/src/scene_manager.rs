//! Scene loading, building, and publishing.
//!
//! Handles reading scene JSON files from disk, generating default geometry,
//! and publishing scene data to the NATS transport layer.

use anyhow::Result;
use darkiron_transport::DarkIronTransport;
use std::path::Path;
use tracing::{info, warn, error};

/// Face definition: (normal, color, 4 vertex positions).
type CubeFace = ([f64; 3], [f64; 3], [[f64; 3]; 4]);

/// Build a colored unit cube as the default fallback scene.
pub fn build_cube_scene(session_id: &str) -> serde_json::Value {
    let s: f64 = 0.5;
    let faces: Vec<CubeFace> = vec![
        ([0.0, 0.0, 1.0], [1.0, 0.2, 0.2], [[-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]]),
        ([0.0, 0.0, -1.0], [0.2, 1.0, 1.0], [[s, -s, -s], [-s, -s, -s], [-s, s, -s], [s, s, -s]]),
        ([1.0, 0.0, 0.0], [0.2, 1.0, 0.2], [[s, -s, s], [s, -s, -s], [s, s, -s], [s, s, s]]),
        ([-1.0, 0.0, 0.0], [1.0, 0.2, 1.0], [[-s, -s, -s], [-s, -s, s], [-s, s, s], [-s, s, -s]]),
        ([0.0, 1.0, 0.0], [1.0, 1.0, 0.2], [[-s, s, s], [s, s, s], [s, s, -s], [-s, s, -s]]),
        ([0.0, -1.0, 0.0], [0.2, 0.2, 1.0], [[-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s]]),
    ];

    let mut vertices: Vec<f64> = Vec::new();
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

    serde_json::json!({
        "type": "SceneLoaded",
        "session_id": session_id,
        "meshes": [{ "name": "default_cube", "vertices": vertices, "indices": indices }]
    })
}

/// Load a scene from a JSON file, injecting session metadata.
pub fn load_scene_file(path: &Path, session_id: &str) -> Result<serde_json::Value> {
    let content = std::fs::read_to_string(path)?;
    let mut scene: serde_json::Value = serde_json::from_str(&content)?;

    if let Some(obj) = scene.as_object_mut() {
        obj.insert("session_id".to_string(), serde_json::json!(session_id));
        if !obj.contains_key("type") {
            obj.insert("type".to_string(), serde_json::json!("SceneLoaded"));
        }
    }

    Ok(scene)
}

/// Serialize and publish a scene value to NATS.
///
/// Returns `Ok(())` on success. Logs and returns errors instead of
/// silently swallowing them (fixes the `unwrap_or_default` bug).
pub async fn publish_scene(
    transport: &DarkIronTransport,
    subject: &str,
    scene: &serde_json::Value,
) -> Result<()> {
    let payload = serde_json::to_vec(scene)?;
    transport.publish(subject, &payload).await?;
    Ok(())
}

/// Scan an assets directory for `.json` scene files and publish them.
///
/// Returns `true` if at least one scene was published.
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
                Ok(scene) => {
                    let subject = format!("scene.{session_id}.loaded");
                    match publish_scene(transport, &subject, &scene).await {
                        Ok(()) => {
                            info!(file = %path.display(), "Published scene from file");
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

/// Handle a hot-reload event: re-read a changed file and publish it.
pub async fn hot_reload(
    transport: &DarkIronTransport,
    changed_path: &Path,
    session_id: &str,
) {
    match load_scene_file(changed_path, session_id) {
        Ok(scene) => {
            let subject = format!("scene.{session_id}.loaded");
            match publish_scene(transport, &subject, &scene).await {
                Ok(()) => info!(file = %changed_path.display(), "Hot reload complete"),
                Err(e) => error!(file = %changed_path.display(), error = %e, "Failed to publish reloaded scene"),
            }
        }
        Err(e) => warn!(file = %changed_path.display(), error = %e, "Failed to reload scene"),
    }
}

