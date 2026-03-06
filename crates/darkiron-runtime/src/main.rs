#![deny(clippy::all)]
#![allow(clippy::too_many_lines)]

use anyhow::Result;
use darkiron_transport::DarkIronTransport;
use notify::{recommended_watcher, RecursiveMode, Watcher, Event, EventKind};
use std::path::PathBuf;
use tokio::sync::mpsc;
use tracing::{info, warn, error};
use uuid::Uuid;

fn build_cube_scene(session_id: &str) -> serde_json::Value {
    let s: f64 = 0.5;
    let faces: Vec<([f64;3],[f64;3],[[f64;3];4])> = vec![
        ([0.0,0.0,1.0],[1.0,0.2,0.2],[[-s,-s,s],[s,-s,s],[s,s,s],[-s,s,s]]),
        ([0.0,0.0,-1.0],[0.2,1.0,1.0],[[s,-s,-s],[-s,-s,-s],[-s,s,-s],[s,s,-s]]),
        ([1.0,0.0,0.0],[0.2,1.0,0.2],[[s,-s,s],[s,-s,-s],[s,s,-s],[s,s,s]]),
        ([-1.0,0.0,0.0],[1.0,0.2,1.0],[[-s,-s,-s],[-s,-s,s],[-s,s,s],[-s,s,-s]]),
        ([0.0,1.0,0.0],[1.0,1.0,0.2],[[-s,s,s],[s,s,s],[s,s,-s],[-s,s,-s]]),
        ([0.0,-1.0,0.0],[0.2,0.2,1.0],[[-s,-s,-s],[s,-s,-s],[s,-s,s],[-s,-s,s]]),
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
        indices.extend_from_slice(&[vi, vi+1, vi+2, vi, vi+2, vi+3]);
        vi += 4;
    }
    serde_json::json!({
        "type": "SceneLoaded",
        "session_id": session_id,
        "meshes": [{ "name": "default_cube", "vertices": vertices, "indices": indices }]
    })
}

fn load_scene_file(path: &std::path::Path, session_id: &str) -> Result<serde_json::Value> {
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

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "info,darkiron=debug".into()))
        .init();

    info!("=== DarkIron Engine Runtime v0.1.0 ===");

    let nats_url = std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into());
    info!(url = %nats_url, "Connecting to NATS...");
    let transport = DarkIronTransport::connect(&nats_url).await?;
    info!("Connected to NATS");

    let session_id = Uuid::new_v4().to_string();
    info!(session = %session_id, "Session started");

    // Wait for editor to connect and subscribe
    info!("Waiting 1s for editor connections...");
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

    // Assets directory
    let assets_dir = PathBuf::from(std::env::var("DARKIRON_ASSETS").unwrap_or_else(|_| "assets".into()));
    if !assets_dir.exists() {
        std::fs::create_dir_all(&assets_dir)?;
        info!(path = %assets_dir.display(), "Created assets directory");
    }

    // Load scene files from assets, or publish default cube
    let mut scene_loaded = false;
    if let Ok(entries) = std::fs::read_dir(&assets_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "json") {
                match load_scene_file(&path, &session_id) {
                    Ok(scene) => {
                        let subject = format!("scene.{}.loaded", session_id);
                        transport.publish(&subject, &serde_json::to_vec(&scene)?).await?;
                        info!(file = %path.display(), "Published scene from file");
                        scene_loaded = true;
                    }
                    Err(e) => warn!(file = %path.display(), error = %e, "Failed to load scene"),
                }
            }
        }
    }
    if !scene_loaded {
        let cube = build_cube_scene(&session_id);
        let subject = format!("scene.{}.loaded", session_id);
        transport.publish(&subject, &serde_json::to_vec(&cube)?).await?;
        info!("Published default cube");
    }

    // File watcher for hot reload
    let (file_tx, mut file_rx) = mpsc::unbounded_channel::<PathBuf>();
    let mut watcher = recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) => {
                    for path in event.paths {
                        if path.extension().map_or(false, |e| e == "json") {
                            let _ = file_tx.send(path);
                        }
                    }
                }
                _ => {}
            }
        }
    })?;
    watcher.watch(assets_dir.as_ref(), RecursiveMode::Recursive)?;
    info!(path = %assets_dir.display(), "Watching assets for hot reload");

    // Editor commands subscription
    let edit_subject = format!("scene.{}.edit.>", session_id);
    let mut subscriber = transport.subscribe(&edit_subject).await?;
    info!(subject = %edit_subject, "Listening for editor commands");
    info!("=== Runtime ready ===");

    // Main loop: react to editor commands OR file changes OR shutdown
    loop {
        tokio::select! {
            Some(msg) = subscriber.next() => {
                info!(subject = %msg.subject, bytes = msg.payload.len(), "Editor command");
            }
            Some(changed_path) = file_rx.recv() => {
                info!(file = %changed_path.display(), "Asset changed — hot reloading...");
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                while file_rx.try_recv().is_ok() {}
                match load_scene_file(&changed_path, &session_id) {
                    Ok(scene) => {
                        let subject = format!("scene.{}.loaded", session_id);
                        match transport.publish(&subject, &serde_json::to_vec(&scene).unwrap_or_default()).await {
                            Ok(()) => info!(file = %changed_path.display(), "Hot reload complete"),
                            Err(e) => error!(error = %e, "Failed to publish reloaded scene"),
                        }
                    }
                    Err(e) => warn!(file = %changed_path.display(), error = %e, "Failed to reload scene"),
                }
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Shutting down...");
                break;
            }
        }
    }
    Ok(())
}