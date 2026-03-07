#![deny(clippy::all)]

mod asset_watcher;
mod scene_manager;

use anyhow::Result;
use darkiron_transport::DarkIronTransport;
use std::path::PathBuf;
use tracing::info;
use uuid::Uuid;

use asset_watcher::AssetWatcher;
use scene_manager::{build_cube_scene, hot_reload, load_and_publish_assets, publish_scene};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,darkiron=debug".into()),
        )
        .init();

    info!("=== DarkIron Engine Runtime v0.1.0 ===");

    // Connect to NATS
    let nats_url = std::env::var("NATS_URL").unwrap_or_else(|_| "nats://localhost:4222".into());
    info!(url = %nats_url, "Connecting to NATS...");
    let transport = DarkIronTransport::connect(&nats_url).await?;
    info!("Connected to NATS");

    let session_id = Uuid::new_v4().to_string();
    info!(session = %session_id, "Session started");

    // TODO: Replace with proper readiness handshake (editor publishes
    // "client_ready", runtime waits for it before sending scene data).
    let startup_delay_ms: u64 = std::env::var("DARKIRON_STARTUP_DELAY_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1000);
    info!(delay_ms = startup_delay_ms, "Waiting for editor connections...");
    tokio::time::sleep(std::time::Duration::from_millis(startup_delay_ms)).await;

    // Ensure assets directory exists
    let assets_dir = PathBuf::from(
        std::env::var("DARKIRON_ASSETS").unwrap_or_else(|_| "assets".into()),
    );
    if !assets_dir.exists() {
        std::fs::create_dir_all(&assets_dir)?;
        info!(path = %assets_dir.display(), "Created assets directory");
    }

    // Load scene files from assets, or publish default cube
    let scene_loaded = load_and_publish_assets(&transport, &assets_dir, &session_id).await;
    if !scene_loaded {
        let cube = build_cube_scene(&session_id);
        let subject = format!("scene.{session_id}.loaded");
        publish_scene(&transport, &subject, &cube).await?;
        info!("Published default cube");
    }

    // Start file watcher for hot reload
    let mut watcher = AssetWatcher::start(&assets_dir)?;

    // Subscribe to editor commands
    let edit_subject = format!("scene.{session_id}.edit.>");
    let mut subscriber = transport.subscribe(&edit_subject).await?;
    info!(subject = %edit_subject, "Listening for editor commands");
    info!("=== Runtime ready ===");

    // Main event loop
    loop {
        tokio::select! {
            Some(msg) = subscriber.next() => {
                info!(subject = %msg.subject, bytes = msg.payload.len(), "Editor command");
            }
            Some(changed_path) = watcher.rx.recv() => {
                info!(file = %changed_path.display(), "Asset changed — hot reloading...");
                // Debounce: wait briefly, then drain queued duplicate events
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                watcher.drain_pending();
                hot_reload(&transport, &changed_path, &session_id).await;
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Shutting down...");
                break;
            }
        }
    }

    Ok(())
}

