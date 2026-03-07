//! File system watcher for hot-reloading assets.
//!
//! Watches the assets directory for `.json` file changes and sends
//! changed paths through an unbounded channel for the main loop to process.

use anyhow::Result;
use notify::{recommended_watcher, Event, EventKind, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use tokio::sync::mpsc;
use tracing::info;

/// A handle to the asset file watcher.
///
/// Holds the watcher instance to keep it alive and provides the
/// receiving end of the change notification channel.
pub struct AssetWatcher {
    /// Receive changed file paths from this channel.
    pub rx: mpsc::UnboundedReceiver<PathBuf>,
    /// Keep the watcher alive — it stops when dropped.
    _watcher: notify::RecommendedWatcher,
}

impl AssetWatcher {
    /// Start watching the given directory for `.json` file changes.
    ///
    /// Returns an `AssetWatcher` whose `rx` field yields paths of
    /// created or modified `.json` files.
    pub fn start(assets_dir: &Path) -> Result<Self> {
        let (tx, rx) = mpsc::unbounded_channel::<PathBuf>();

        let watcher = recommended_watcher(move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                match event.kind {
                    EventKind::Create(_) | EventKind::Modify(_) => {
                        for path in event.paths {
                            if path.extension().is_some_and(|e| e == "json") {
                                let _ = tx.send(path);
                            }
                        }
                    }
                    _ => {}
                }
            }
        })?;

        // Note: `watcher` is moved into the struct but watch() takes &self
        // on RecommendedWatcher, so we need to call it before moving.
        // Actually notify's recommended_watcher returns a mutable watcher,
        // and watch() takes &mut self. Let's fix this:
        let mut w = watcher;
        w.watch(assets_dir.as_ref(), RecursiveMode::Recursive)?;
        info!(path = %assets_dir.display(), "Watching assets for hot reload");

        Ok(Self {
            rx,
            _watcher: w,
        })
    }

    /// Drain any queued events (debounce helper).
    ///
    /// Call this after processing a change to skip duplicate
    /// notifications from rapid successive writes.
    pub fn drain_pending(&mut self) {
        while self.rx.try_recv().is_ok() {}
    }
}

