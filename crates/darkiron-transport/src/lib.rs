#![deny(clippy::all)]

//! DarkIron Transport Layer
//!
//! Wraps the NATS client to provide a consistent interface for all
//! engine communication. All cross-tier messaging MUST go through this crate.
//!
//! Current implementation: NATS with JSON payloads.
//! Future: NATS with FlatBuffers payloads.

use thiserror::Error;
use tracing::{debug, instrument};

#[derive(Error, Debug)]
pub enum TransportError {
    #[error("Failed to connect to NATS: {0}")]
    Connection(#[from] async_nats::ConnectError),

    #[error("Failed to publish message: {0}")]
    Publish(#[from] async_nats::PublishError),

    #[error("Failed to subscribe: {0}")]
    Subscribe(#[from] async_nats::SubscribeError),
}

pub type Result<T> = std::result::Result<T, TransportError>;

/// Re-export message type for consumers
pub use async_nats::Message;

/// Subscriber wrapper
pub struct Subscriber {
    inner: async_nats::Subscriber,
}

impl Subscriber {
    /// Receive the next message. Returns None if the subscription is closed.
    pub async fn next(&mut self) -> Option<Message> {
        use futures::StreamExt;
        self.inner.next().await
    }
}

/// Main transport client for DarkIron.
///
/// Wraps NATS client and provides the interface through which all
/// runtime <-> browser communication flows.
pub struct DarkIronTransport {
    client: async_nats::Client,
}

impl DarkIronTransport {
    /// Connect to a NATS server.
    ///
    /// # Arguments
    /// * `url` - NATS server URL (e.g., "nats://localhost:4222")
    #[instrument(skip_all, fields(url = %url))]
    pub async fn connect(url: &str) -> Result<Self> {
        let client = async_nats::connect(url).await?;
        debug!("NATS connection established");
        Ok(Self { client })
    }

    /// Publish a message to a NATS subject.
    ///
    /// # Arguments
    /// * `subject` - Dot-separated NATS subject (e.g., "scene.abc123.loaded")
    /// * `payload` - Raw bytes to publish (JSON or FlatBuffers)
    #[instrument(skip(self, payload), fields(subject = %subject, bytes = payload.len()))]
    pub async fn publish(&self, subject: &str, payload: &[u8]) -> Result<()> {
        self.client
            .publish(subject.to_string(), payload.to_vec().into())
            .await?;
        debug!("Message published");
        Ok(())
    }

    /// Subscribe to a NATS subject pattern.
    ///
    /// Supports wildcards:
    /// - `*` matches a single token: `scene.*.loaded`
    /// - `>` matches one or more tokens: `scene.abc123.edit.>`
    #[instrument(skip(self), fields(subject = %subject))]
    pub async fn subscribe(&self, subject: &str) -> Result<Subscriber> {
        let inner = self.client.subscribe(subject.to_string()).await?;
        debug!("Subscribed");
        Ok(Subscriber { inner })
    }

    /// Get the underlying NATS client for advanced operations.
    /// Prefer using the typed methods above when possible.
    pub fn nats_client(&self) -> &async_nats::Client {
        &self.client
    }
}

#[cfg(test)]
mod tests {
    // Integration tests require a running NATS server.
    // Run with: cargo test -- --ignored
    // Or use: task test:rust (which starts NATS first)

    #[tokio::test]
    #[ignore = "requires running NATS server"]
    async fn test_publish_subscribe_roundtrip() {
        use super::*;

        let transport = DarkIronTransport::connect("nats://localhost:4222")
            .await
            .expect("Failed to connect to NATS");

        let mut sub = transport
            .subscribe("test.roundtrip")
            .await
            .expect("Failed to subscribe");

        let payload = b"hello darkiron";
        transport
            .publish("test.roundtrip", payload)
            .await
            .expect("Failed to publish");

        let msg = tokio::time::timeout(std::time::Duration::from_secs(2), sub.next())
            .await
            .expect("Timeout waiting for message")
            .expect("Subscription closed");

        assert_eq!(msg.payload.as_ref(), payload);
    }
}
