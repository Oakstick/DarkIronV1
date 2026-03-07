import re

path = r"D:\DarkIron\darkiron\crates\darkiron-runtime\src\main.rs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Fix 1: Replace unwrap_or_default() with proper error handling
old = '''match transport.publish(&subject, &serde_json::to_vec(&scene).unwrap_or_default()).await {
                            Ok(()) => info!(file = %changed_path.display(), "Hot reload complete"),
                            Err(e) => error!(error = %e, "Failed to publish reloaded scene"),
                        }'''
new = '''match serde_json::to_vec(&scene) {
                            Ok(payload) => match transport.publish(&subject, &payload).await {
                                Ok(()) => info!(file = %changed_path.display(), "Hot reload complete"),
                                Err(e) => error!(error = %e, "Failed to publish reloaded scene"),
                            },
                            Err(e) => error!(error = %e, file = %changed_path.display(), "Failed to serialize scene — skipping publish"),
                        }'''
content = content.replace(old, new)

# Fix 2: Replace sleep(1s) with configurable wait + comment about proper handshake
old2 = '''    // Wait for editor to connect and subscribe
    info!("Waiting 1s for editor connections...");
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;'''
new2 = '''    // TODO: Replace with proper readiness handshake (editor publishes "client_ready",
    // runtime waits for it). Using configurable delay as interim solution.
    let startup_delay_ms: u64 = std::env::var("DARKIRON_STARTUP_DELAY_MS")
        .ok().and_then(|v| v.parse().ok()).unwrap_or(1000);
    info!(delay_ms = startup_delay_ms, "Waiting for editor connections...");
    tokio::time::sleep(std::time::Duration::from_millis(startup_delay_ms)).await;'''
content = content.replace(old2, new2)

# Fix 3: Remove #![allow(clippy::too_many_lines)] and add a note
content = content.replace(
    '#![allow(clippy::too_many_lines)]',
    '// TODO: Refactor into scene_manager.rs and asset_watcher.rs modules'
)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Fixed main.rs: unwrap_or_default, startup delay, clippy allow")

