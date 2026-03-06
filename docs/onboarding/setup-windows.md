# DarkIron — Windows Setup Guide

## Step 1: Prerequisites

### Already installed (confirmed)
- [x] Rust (via rustup)
- [x] Node.js 22 LTS

### Need to install

**Docker Desktop:**
1. Download from https://www.docker.com/products/docker-desktop
2. Install with WSL 2 backend (recommended)
3. After install, verify: `docker --version`

**Task (task runner):**
```powershell
# Option A: Chocolatey
choco install go-task

# Option B: Scoop
scoop install task

# Option C: Direct download
# https://taskfile.dev/installation/#binary
```

**pnpm (if not installed):**
```powershell
npm install -g pnpm
```

**NATS CLI (optional, for debugging):**
```powershell
choco install nats
# Or download from: https://github.com/nats-io/natscli/releases
```

## Step 2: Clone and Setup

```powershell
git clone <repo-url>
cd darkiron
task setup
```

This installs Rust and Node dependencies, pulls the NATS Docker image, and verifies the toolchain.

## Step 3: Start Developing

```powershell
task dev
```

This starts:
- **NATS** on ports 4222 (client), 9222 (WebSocket), 8222 (monitor)
- **Rust runtime** — builds and runs `darkiron-runtime`
- **Editor** — Vite dev server at http://localhost:5173

Open http://localhost:5173 in Chrome or Edge to see the editor.

## Step 4: Verify Everything Works

1. **NATS Dashboard:** Open http://localhost:8222 — should show server info
2. **Editor:** Open http://localhost:5173 — should show DarkIron header with green status dot
3. **Runtime logs:** Should show "Published golden triangle scene" in terminal

## WebGPU Notes (NVIDIA RTX)

Your RTX GPU has full WebGPU support. Use:
- **Chrome 113+** (recommended) — WebGPU enabled by default
- **Edge 113+** — WebGPU enabled by default
- **Firefox Nightly** — partial support, may need `dom.webgpu.enabled` flag

To verify WebGPU is working, open Chrome DevTools console and type:
```js
navigator.gpu ? "WebGPU available" : "WebGPU NOT available"
```

## Claude Code Setup

```powershell
# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Start a session in the repo
cd darkiron
claude
```

Claude Code reads `CLAUDE.md` automatically and understands the project structure.

## Troubleshooting

**Docker not running:**
```
Error: Cannot connect to the Docker daemon
```
→ Start Docker Desktop from the Start menu. Wait for it to fully initialize.

**NATS port already in use:**
```
Error: bind: address already in use
```
→ Run `docker compose down` then `task nats` again.

**Rust build fails (USD crate):**
The `darkiron-usd` crate requires the OpenUSD SDK. For Phase 1, it's a stub — if it fails, check that you're not trying to build with USD features enabled.
