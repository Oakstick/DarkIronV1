# DarkIron Engine

A distributed game engine with a WebGPU browser renderer, native Rust runtime, and NATS event bus.

## Prerequisites

- **Rust** — [rustup.rs](https://rustup.rs) (stable toolchain)
- **Node.js 22 LTS** — [nodejs.org](https://nodejs.org) + pnpm (`npm install -g pnpm`)
- **Docker Desktop** — [docker.com](https://www.docker.com/products/docker-desktop) (for NATS)
- **Task** — [taskfile.dev](https://taskfile.dev/installation) (task runner)

### Optional

- **NATS CLI** — `choco install nats` or download from [github.com/nats-io/natscli](https://github.com/nats-io/natscli/releases)
- **Claude Code** — [docs.anthropic.com](https://docs.anthropic.com) (AI coding assistant)

## Quick Start

```bash
# Clone
git clone <repo-url>
cd darkiron

# Install dependencies
task setup

# Start everything (NATS + runtime + editor)
task dev
```

This will:
1. Start NATS server via Docker (ports 4222, 9222, 8222)
2. Build and run the Rust runtime
3. Start the Vite dev server for the editor at http://localhost:5173

## Architecture

```
┌─────────────────────┐     NATS      ┌─────────────────────┐
│   Native Runtime    │◄────────────►│   Browser Client    │
│   (Rust / C++)      │   (pub/sub)   │   (WebGPU + React)  │
│                     │               │                     │
│  • USD Stage        │  FlatBuffers  │  • WebGPU Renderer  │
│  • Asset Cooking    │  over NATS    │  • React Editor     │
│  • Scene Graph      │               │  • Scene Proxy      │
│  • Physics          │               │  • Gizmos           │
└─────────────────────┘               └─────────────────────┘
```

All communication flows through NATS. The browser never touches USD directly.

## Project Structure

| Directory | Contents |
|-----------|----------|
| `crates/` | Rust workspace — runtime, transport, USD, asset pipeline |
| `packages/` | Node workspace — WebGPU renderer, React editor, transport client |
| `schemas/` | FlatBuffers schemas + NATS subject registry |
| `shaders/` | WGSL shader source |
| `infra/` | Kubernetes, Terraform, NATS cluster config |
| `docs/` | Architecture Decision Records, onboarding guides |

## Common Commands

| Command | Description |
|---------|-------------|
| `task dev` | Start full stack |
| `task nats` | Start NATS only |
| `task runtime` | Build + run Rust runtime |
| `task editor` | Start editor dev server |
| `task test` | Run all tests |
| `task lint` | Lint all code |
| `task schemas` | Regenerate FlatBuffers bindings |

## Working with Claude Code

This repo is optimized for use with Claude Code. Key files:

- **`CLAUDE.md`** — Project context, conventions, and rules
- **`AGENTS.md`** — Subagent roles and scopes for multi-agent tasks

```bash
# Start Claude Code in the repo
claude

# Example prompts:
# "Add a new NATS event type for camera updates"
# "Implement frustum culling in the WebGPU renderer"
# "Write a boundary test for the TransformChanged event"
```

## NATS Monitoring

When NATS is running, the monitoring dashboard is at http://localhost:8222.

Debug with NATS CLI:
```bash
nats sub "scene.>"           # Watch all scene events
nats sub "presence.>"        # Watch presence heartbeats
nats stream ls               # List JetStream streams
```

## License

Proprietary — Distinguisher
