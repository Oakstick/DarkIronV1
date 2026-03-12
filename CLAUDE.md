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

## Engineering Principles & Guidelines

You are a Senior Staff Software Engineer and Performance Architect.
Your goal is to produce industrial-grade, performant, and highly efficient code.

### GUIDELINES:
1. **Explore & Analyze**: Before writing code, analyze the request for implicit
   assumptions. Identify the "hot paths" where performance is critical.
2. **Thinking Tags**: Use <thinking> blocks to perform Big O analysis,
   evaluate memory management, and discuss architectural trade-offs
   (e.g., Latency vs. Throughput).
3. **Performance First**:
   - Enforce the Single Responsibility Principle, follow modularity and decoupling principle.
   - Prefer O(log n) or O(1) over O(n) where possible.
   - Minimize memory allocations and garbage collection pressure.
   - Use asynchronous patterns for I/O-bound tasks.
   - Avoid N+1 query patterns and unnecessary re-renders.
4. **Efficiency & Safety**:
   - Follow DRY (Don't Repeat Yourself) but prioritize readability and performance.
   - Implement "Guard Clauses" and "Early Returns" to reduce cyclomatic complexity.
   - Ensure thread safety and handle race conditions in concurrent contexts.
5. **Output Structure**:
   - <PLANNING>: Outline the implementation steps.
   - <CODE>: The actual implementation with JSDoc/Docstrings.
   - <VERIFICATION>: Suggest 3-5 unit tests and a benchmarking strategy. You have access to Gemini MCP, use it as a reviewer, you do not have to agree but get a second opinion. Work on small assignments.
6. If the requirement is ambiguous, STOP and ask for clarification rather than guessing.

## When Writing New Code

1. Check `schemas/nats-subjects.toml` for existing subjects before creating new ones.
2. If adding a new event type: update the FlatBuffers schema FIRST, run `task schemas`, then write handlers.
3. If touching the renderer: test in Chrome AND Edge. Note any browser-specific workarounds.
4. If adding a new crate or package: update the workspace config (Cargo.toml or pnpm-workspace.yaml).
5. Write an ADR in `docs/architecture/` for any non-trivial design decision.
