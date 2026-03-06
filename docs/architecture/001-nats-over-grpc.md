# ADR-001: NATS Message Bus over gRPC for Cross-Tier Communication

**Status:** Accepted
**Date:** March 2026
**Context PR:** Initial architecture

## Context

DarkIron's split-brain architecture requires communication between a native Rust runtime and a browser-based WebGPU renderer. The system must work identically on a single Windows dev machine and in a multi-node data center cluster.

Options considered:

1. **Direct gRPC** — Runtime exposes gRPC services, browser calls via gRPC-Web
2. **WebSocket RPC** — Custom request/response protocol over WebSocket
3. **NATS Message Bus** — Pub/sub + streaming via NATS with JetStream

## Decision

We chose **NATS** as the sole communication transport between all engine tiers.

## Rationale

- **Location transparency:** NATS connection is a URL. Switching from localhost to data center requires only a config change.
- **Event sourcing native:** JetStream provides persistent, replayable event streams — enabling undo/redo, crash recovery, and session replay as emergent features.
- **Multi-user ready:** Pub/sub naturally supports multiple subscribers. Adding a second editor instance to a session requires zero protocol changes.
- **WebSocket native:** NATS server supports WebSocket listeners, so the browser connects directly without a proxy.
- **Single binary:** The NATS server is a single executable with no dependencies, making local development trivial.

gRPC was rejected because it imposes a request/response model that doesn't fit event streaming, and gRPC-Web requires a proxy. Direct WebSocket was rejected because it would require building session management, reconnection, and streaming from scratch.

## Consequences

- All cross-tier communication is asynchronous. No synchronous function calls between runtime and browser.
- We depend on the NATS ecosystem for client libraries (Rust: `async-nats`, JS: `nats.ws`).
- Debugging requires NATS CLI and familiarity with pub/sub patterns.
- FlatBuffers schemas must be kept in sync across Rust and TypeScript.
