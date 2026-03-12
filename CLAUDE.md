# DarkIron Engine — Claude Code Context

## What Is This Project

DarkIron is a distributed game engine with a split-brain architecture:

- **Native Rust Runtime** — owns the scene graph, USD composition, asset cooking, physics. Runs multithreaded.
- **NATS Message Bus** — all communication between tiers flows through NATS pub/sub + JetStream. No HTTP, no gRPC between tiers.
- **Browser Client** — WebGPU renderer + React editor. Thin client. Never touches USD directly. Receives render-ready data via NATS WebSocket.

The browser is a PRESENTATION LAYER. Scene logic lives exclusively in the runtime.

## Architecture Rules (Non-Negotiable)

1. **ALL cross-tier communication goes through NATS.** No direct imports between `crates/` and `packages/`.
2. **Every NATS subject must be registered** in `schemas/nats-subjects.toml` before use.
3. **FlatBuffers is the wire format.** JSON is never sent over NATS (except during early prototyping — mark with `// TODO: migrate to FlatBuffers`).
4. **The browser never parses USD.** It works with a flattened scene proxy: transforms, mesh handles, material bindings.
5. **Event-sourced model.** Every scene mutation is an immutable event. The JetStream log is the source of truth.

## Monorepo Layout

```
darkiron/
├── crates/                    # Rust workspace (runtime tier)
│   ├── darkiron-runtime/      # Main binary — orchestrates everything
│   ├── darkiron-transport/    # NATS client + FlatBuffers serde
│   ├── darkiron-usd/          # USD stage management (C++ FFI)
│   ├── darkiron-cook/         # Asset cooking pipeline
│   ├── darkiron-presence/     # Multi-user presence service
│   └── darkiron-ai-gateway/   # AI service dispatcher
├── packages/                  # Node/pnpm workspace (browser tier)
│   ├── renderer/              # WebGPU renderer (@darkiron/renderer)
│   ├── editor/                # React editor app (@darkiron/editor)
│   ├── transport/             # NATS WebSocket client (@darkiron/transport)
│   └── shared-types/          # Generated TS types (@darkiron/shared-types)
├── schemas/                   # FlatBuffers schemas + NATS subject registry
│   ├── flatbuffers/           # .fbs source files
│   ├── generated/             # Generated Rust + TS (committed)
│   └── nats-subjects.toml     # Subject namespace registry
├── shaders/                   # .wgsl shader source
├── usd/                       # USD SDK + test assets
└── infra/                     # K8s, Terraform, NATS cluster config
```

## Coding Conventions

### Rust (crates/)
- Edition 2021 (move to 2024 when stable ecosystem catches up)
- `snake_case` for everything except types
- Crate names prefixed with `darkiron_` (hyphenated in Cargo.toml: `darkiron-transport`)
- `#![deny(clippy::all)]` in every crate lib.rs/main.rs
- Use `thiserror` for library errors, `anyhow` for binary crates
- Async runtime: `tokio` (multi-threaded)
- Logging: `tracing` crate with structured fields
- No `unwrap()` in library code. `expect()` only with descriptive message.

### TypeScript (packages/)
- Strict mode: `"strict": true, "noUncheckedIndexedAccess": true`
- **No `any`.** Use `unknown` + type guards.
- Formatting: Biome (not Prettier/ESLint)
- Package names: `@darkiron/renderer`, `@darkiron/editor`, etc.
- State management: Zustand stores hydrated from NATS messages
- React: functional components only, hooks for all state

### FlatBuffers (schemas/)
- Types: `PascalCase` (e.g., `SceneLoaded`, `TransformChanged`)
- Fields: `snake_case` (e.g., `prim_path`, `world_matrix`)
- Namespace: `darkiron.schema`
- Always add new fields at the END of tables (backward compatibility)
- Never remove or reorder fields. Deprecate with comment.

### NATS Subjects
- Dot-separated hierarchy: `scene.{session_id}.delta.transform`
- Session-scoped: most subjects include `{session_id}`
- Registered in `schemas/nats-subjects.toml` — CI validates this

### Shaders (shaders/)
- WGSL only (no GLSL, no HLSL)
- One file per logical shader stage
- Naming: `{pass}_{stage}.wgsl` (e.g., `gbuffer_vertex.wgsl`, `lighting_fragment.wgsl`)

## Common Commands

```bash
task dev            # Start everything (NATS + runtime + editor)
task nats           # NATS server only
task runtime        # Build + run native runtime
task editor         # Vite dev server for editor
task schemas        # Regenerate FlatBuffers bindings
task test           # Run all test suites
task test:rust      # Rust unit + integration tests
task test:ts        # TypeScript tests
task bench          # Performance benchmarks
task lint           # Lint everything (clippy + biome)
task fmt            # Format everything (rustfmt + biome)
```

## Known Gotchas

- **NATS WebSocket port is 9222**, not 4222. The browser connects to `ws://localhost:9222`.
- **USD SDK must match platform.** The pre-built SDK in `usd/sdk/` is platform-specific. Dev container handles this automatically. If building natively on Windows, download from OpenUSD releases.
- **WebGPU requires Chrome Canary or Edge 113+** for full feature support. Firefox has partial support.
- **FlatBuffers generated code is committed.** After changing a `.fbs` file, run `task schemas` and commit the generated output in `schemas/generated/`.
- **Docker Desktop must be running** before `task dev` or `task nats`.

## Testing Expectations

- Every new NATS message handler needs a boundary test: publish from one language, consume in the other.
- Every new WebGPU pipeline needs a screenshot comparison test fixture.
- Rust crates: `cargo nextest run` (parallel). TypeScript: `vitest`.
- Integration tests require NATS running — they are skipped if NATS is unavailable.

## When Writing New Code

1. Check `schemas/nats-subjects.toml` for existing subjects before creating new ones.
2. If adding a new event type: update the FlatBuffers schema FIRST, run `task schemas`, then write handlers.
3. If touching the renderer: test in Chrome AND Edge. Note any browser-specific workarounds.
4. If adding a new crate or package: update the workspace config (Cargo.toml or pnpm-workspace.yaml).
5. Write an ADR in `docs/architecture/` for any non-trivial design decision.


## Current State (updated March 11, 2026)

### Branch: `feature/pbr-step2-materials`

### Recent Commits (this session)
- `6f8b3fe` — perf: pass typed arrays through transport/renderer pipeline (~350MB alloc savings)
- `1f8dceb` — feat: decode UVs and MaterialData in transport FlatBuffers decoder
- `00c03b9` — feat: replace startup sleep with client_ready handshake
- `fac287d` — fix: recursive asset directory scanning with symlink safety

### What Works
- Full chess set renders: 49 meshes, ~1.1M triangles, vertex color shading
- PointInstancer resolved: all 8 pawns per side
- FlatBuffers end-to-end (Rust → NATS → Browser), typed arrays (no boxing)
- Client readiness handshake (editor publishes `darkiron.client.ready`, runtime waits)
- Recursive asset discovery (`collect_scene_files`, max_depth=4, skips symlinks)
- Hot reload on file changes (asset_watcher with debounce)
- Dev tooling: `scripts/dev-start.bat`, `scripts/kill.bat`
- 112 PBR textures served from `packages/editor/public/textures/OpenChessSet/`

### What's Next (PBR Materials — plumbing is done)
1. Commit remaining dirty files (generated schemas, darkiron-usd material changes, shaders)
2. Test PBR base_color textures end-to-end (all wiring connected, needs restart test)
3. Normal map support (add to shader bind group, needs tangent generation)
4. Roughness + metallic (extend shader to Cook-Torrance BRDF)
5. Camera auto-framing on scene load

### Uncommitted Dirty Files
- `crates/darkiron-usd/src/lib.rs` — material extraction from USD bindings
- `schemas/flatbuffers/scene.fbs` — MaterialData table added
- `schemas/generated/` — regenerated TS/Rust/Python bindings
- `shaders/mesh_pbr.wgsl` — experimental PBR shader
- `docs/gemini-*.md` — Gemini code review docs
- `dev-setup.ps1` — PowerShell health check script
- `packages/editor/public/textures/` — 112 PBR texture files (untracked)

### Dev Environment (Windows)
- Machine: DESKTOP-1OLJ79H, D:\DarkIron\darkiron
- Docker Desktop for NATS (nats:2.10-alpine on ports 4222/9222/8222)
- `GEMINI_API_KEY` in process env for code reviews
- Python 3.12 + usd-core 26.3 + nats-py 2.14 for `tools/load-chess-usd.py`

### Pre-existing TS Errors (not blockers, ignore)
- `packages/renderer/src/utils/mat4.ts` — strict null checks on array indexing
- `packages/renderer/src/index.ts:473-474` — Object possibly undefined

### Workflow Convention
- Fix one thing at a time
- Send diff to Gemini (via API + GEMINI_API_KEY) for code review
- Wait for user "merge" command before committing
- Conventional commits with "Reviewed-by: Gemini 2.5 Flash (APPROVED)"

