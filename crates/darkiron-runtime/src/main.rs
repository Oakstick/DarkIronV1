#![deny(clippy::all)]

mod asset_watcher;
mod scene_manager;

use anyhow::Result;
use darkiron_transport::DarkIronTransport;
use std::path::PathBuf;
use tracing::{info, warn};
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

    // Wait for an editor to signal readiness before publishing scene data.
    // The editor subscribes to scene.> first, then publishes darkiron.client.ready.
    // Timeout fallback ensures headless/test scenarios don't hang indefinitely.
    let ready_timeout_ms: u64 = std::env::var("DARKIRON_READY_TIMEOUT_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30_000);
    {
        let mut ready_sub = transport.subscribe("darkiron.client.ready").await?;
        info!(timeout_ms = ready_timeout_ms, "Waiting for editor client_ready signal...");
        match tokio::time::timeout(
            std::time::Duration::from_millis(ready_timeout_ms),
            ready_sub.next(),
        )
        .await
        {
            Ok(Some(_msg)) => info!("Editor ready — proceeding with scene publish"),
            Ok(None) => warn!("client_ready subscription closed unexpectedly"),
            Err(_) => warn!(
                timeout_ms = ready_timeout_ms,
                "No client_ready received — proceeding anyway (headless mode)"
            ),
        }
        // Subscription dropped here — we only needed the first signal.
    }

    // Ensure assets directory exists
    let assets_dir =
        PathBuf::from(std::env::var("DARKIRON_ASSETS").unwrap_or_else(|_| "assets".into()));
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

    // Subscribe to editor commands and late-joining editors
    let edit_subject = format!("scene.{session_id}.edit.>");
    let mut edit_sub = transport.subscribe(&edit_subject).await?;
    let mut ready_sub = transport.subscribe("darkiron.client.ready").await?;
    info!(subject = %edit_subject, "Listening for editor commands");
    info!("=== Runtime ready ===");

    // Main event loop
    loop {
        tokio::select! {
            Some(msg) = edit_sub.next() => {
                info!(subject = %msg.subject, bytes = msg.payload.len(), "Editor command");
            }
            Some(_msg) = ready_sub.next() => {
                // A new editor just connected — re-publish the full scene.
                info!("Late-joining editor detected — re-publishing scene...");
                let subject = format!("scene.{session_id}.loaded");
                let reloaded = load_and_publish_assets(&transport, &assets_dir, &session_id).await;
                if !reloaded {
                    let cube = build_cube_scene(&session_id);
                    if let Err(e) = publish_scene(&transport, &subject, &cube).await {
                        warn!(error = %e, "Failed to re-publish default cube");
                    }
                }
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

