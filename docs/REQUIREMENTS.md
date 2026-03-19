# Requirements: DarkIron Engine

**Status:** Draft
**Author:** Project Owner
**Analyst:** Requirement Analyst Agent
**Date:** 2026-03-19
**Version:** 0.1.0

---

## 1. Overview

DarkIron is a distributed game engine built as an experimental sandbox for exploring
scalable, event-sourced 3D collaboration. The immediate goal is to render a PBR chess
set end-to-end through the Rust → NATS → WebGPU pipeline. The longer-term vision is a
real-time collaborative 3D editor supporting 100+ concurrent developers on a single scene,
with an eventual path to ray-traced rendering.

This is an innovation-first project. Requirements will evolve as we learn. Architecture
decisions should favor extensibility and experimentation over premature optimization.

## 2. Background & Motivation

- **Problem:** Existing game engines couple rendering, scene logic, and collaboration
  tightly. Scaling to large teams editing a single scene requires a fundamentally
  distributed architecture.
- **Trigger:** Desire to explore whether a NATS-based event-sourced architecture can
  serve as the backbone for a scalable game engine.
- **Cost of inaction:** None — this is exploratory. The cost is opportunity cost of
  not learning.

## 3. Actors & Personas

| Actor | Description | Relevant Goals |
|-------|-------------|----------------|
| Solo Developer | Single user running the full stack locally | Render scenes, iterate on renderer, test pipeline |
| Editor User | Future — uses the browser-based 3D editor | Select, transform, edit objects in a scene |
| Collaborator | Future — one of 100+ devs on the same scene | See others' changes in real-time, avoid conflicts |
| Architect (Self) | Project owner experimenting with solutions | Try approaches, evaluate trade-offs, learn |

## 4. Functional Requirements

### Phase 1 — Chess Set Renderer (MVP)

#### FR-001: End-to-end PBR chess set rendering
**Priority:** Must
**Description:** The Rust runtime parses the USD chess set, extracts geometry and
PBR material data (base color, normal, roughness, metallic textures), serializes
via FlatBuffers, publishes over NATS, and the browser renders the scene using a
physically-based shading model.
**Acceptance Criteria:**
- [ ] Chess set renders in browser with all pieces visible and correctly positioned
- [ ] Base color textures applied per piece
- [ ] Normal maps applied and visually correct (surface detail visible)
- [ ] Roughness and metallic textures applied
- [ ] Fragment shader implements Cook-Torrance BRDF (or equivalent PBR model)
- [ ] No JSON payloads on NATS for scene data — all FlatBuffers
**Notes:** Current state has base color + normals working (PR #21). Roughness and
metallic remain.

#### FR-002: Migrate all NATS subjects to FlatBuffers
**Priority:** Must
**Description:** All NATS subjects currently using JSON payloads must be migrated
to FlatBuffers. This includes edit commands (create_prim, delete_prim, select),
asset reload, and presence subjects.
**Acceptance Criteria:**
- [ ] Every subject in `nats-subjects.toml` with `schema = "json"` is migrated
- [ ] FlatBuffers schema (`scene.fbs`) updated with new table definitions
- [ ] Rust and TypeScript generated code updated and committed
- [ ] No `// TODO: migrate to FlatBuffers` comments remain
**Notes:** This establishes FlatBuffers as the single wire format, eliminating
format inconsistency and providing type safety across languages.

#### FR-003: Automated FlatBuffers code generation
**Priority:** Should
**Description:** The `task schemas` command should invoke `flatc` to generate
Rust, TypeScript, and Python bindings from `.fbs` source files automatically.
**Acceptance Criteria:**
- [ ] `task schemas` generates code for all target languages
- [ ] Generated output lands in `schemas/generated/{rust,ts,python}/`
- [ ] CI validates that generated code is up-to-date with schema source
**Notes:** Currently a stub in Taskfile.yml. Open to tooling suggestions.

#### FR-004: Camera auto-framing on scene load
**Priority:** Should
**Description:** When a scene loads, the orbital camera should automatically
position itself to frame the entire scene (all meshes visible, reasonable zoom).
**Acceptance Criteria:**
- [ ] Camera computes bounding box of all loaded meshes
- [ ] Camera distance and target set to frame the bounding box with padding
- [ ] Works for scenes of varying scale (not hardcoded to chess set dimensions)

### Phase 2 — Editor

#### FR-005: Object selection
**Priority:** Must (Phase 2)
**Description:** Users can click on objects in the 3D viewport to select them.
Selected objects are visually highlighted. Selection state is published over NATS.
**Acceptance Criteria:**
- [ ] Click on mesh → mesh is selected (visual highlight: outline or tint)
- [ ] Click on empty space → deselects current selection
- [ ] Selection event published to `scene.{session_id}.edit.select`
- [ ] Selection uses GPU picking or ray casting (not screen-space hacks)

#### FR-006: Transform gizmos
**Priority:** Must (Phase 2)
**Description:** Selected objects can be translated, rotated, and scaled via
interactive 3D gizmos in the viewport.
**Acceptance Criteria:**
- [ ] Translate gizmo (3-axis + planes)
- [ ] Rotate gizmo (3-axis rings)
- [ ] Scale gizmo (3-axis + uniform)
- [ ] Transform deltas published as `TransformChanged` events over NATS
- [ ] Gizmo interaction feels responsive (< 16ms input-to-visual feedback)

#### FR-007: Property panel
**Priority:** Should (Phase 2)
**Description:** A side panel displays properties of the selected object
(name, transform values, material bindings). Properties are editable.
**Acceptance Criteria:**
- [ ] Panel shows object name, position, rotation, scale
- [ ] Panel shows material name and texture paths
- [ ] Editing a numeric field publishes a delta event over NATS
- [ ] Panel updates when selection changes

#### FR-008: Undo/redo
**Priority:** Should (Phase 2)
**Description:** Users can undo and redo scene mutations. Built on the
event-sourced JetStream log.
**Acceptance Criteria:**
- [ ] Ctrl+Z undoes the last mutation
- [ ] Ctrl+Shift+Z (or Ctrl+Y) redoes
- [ ] Undo/redo works for transform changes, prim creation, prim deletion
- [ ] Undo stack persists across browser refresh (via JetStream replay)
**Notes:** The event-sourced architecture makes this feasible by design.
JetStream stores the immutable event log.

#### FR-009: Scene hierarchy panel
**Priority:** Could (Phase 2)
**Description:** A tree view showing the scene graph hierarchy (prims, their
parent-child relationships). Clicking a prim in the tree selects it in the viewport.
**Acceptance Criteria:**
- [ ] Tree reflects the USD prim hierarchy
- [ ] Click prim in tree → selects in viewport (and vice versa)
- [ ] Drag-and-drop reparenting publishes appropriate events

### Phase 3 — Multi-User Collaboration

#### FR-010: Real-time presence
**Priority:** Must (Phase 3)
**Description:** Each connected user's cursor position, selection, and identity
are visible to all other users in the same session.
**Acceptance Criteria:**
- [ ] Each user sees colored indicators for other users' selections
- [ ] User avatars/names shown near their selected objects
- [ ] Presence updates within 200ms of action
- [ ] Presence works for 100+ concurrent users without UI degradation

#### FR-011: Concurrent editing with conflict resolution
**Priority:** Must (Phase 3)
**Description:** Multiple users can edit the same scene simultaneously. When two
users edit the same property, the system resolves the conflict deterministically.
**Acceptance Criteria:**
- [ ] Two users can move different objects simultaneously without interference
- [ ] Same-property conflicts resolved via last-write-wins with visual indicator
- [ ] Users see who last modified a property
- [ ] No data loss — all edits are captured in the event log
**Notes:** Last-write-wins is the starting strategy. CRDTs or OT may be explored
later if the use case demands it. The event log ensures nothing is lost regardless
of resolution strategy.

#### FR-012: Session management
**Priority:** Must (Phase 3)
**Description:** Users can create, join, and leave editing sessions. Sessions are
scoped to a scene. The system tracks who is connected.
**Acceptance Criteria:**
- [ ] User can create a new session (generates session_id)
- [ ] User can join an existing session by ID or link
- [ ] Joining a session replays current scene state from JetStream
- [ ] Disconnected users are cleaned up from presence after timeout

#### FR-013: Scalable subject partitioning
**Priority:** Should (Phase 3)
**Description:** NATS subject hierarchy supports 100+ concurrent users without
message fan-out becoming a bottleneck. Subjects may need to be partitioned by
scene region, object group, or edit domain.
**Acceptance Criteria:**
- [ ] Define partitioning strategy in an ADR
- [ ] Benchmark: 100 simulated users publishing transforms at 30Hz
- [ ] No single subject becomes a bottleneck (< 10ms publish latency at scale)
**Notes:** This may require NATS queue groups, subject filtering, or hierarchical
subscriptions. Architecture should be explored and benchmarked.

### Future / North Star

#### FR-014: Ray-traced rendering
**Priority:** Won't (future)
**Description:** Upgrade the renderer to support ray tracing for global
illumination, reflections, and shadows. Likely via WebGPU ray tracing extensions
or a hybrid rasterization + ray tracing approach.
**Acceptance Criteria:**
- [ ] Define target hardware requirements and API availability
- [ ] Evaluate WebGPU ray tracing extension timeline
- [ ] Prototype hybrid approach (rasterize primary, ray trace secondary)
**Notes:** WebGPU ray tracing extensions are not yet standardized. This is a
north-star goal. Architecture should not preclude it (e.g., keep geometry
data accessible for BVH construction).

#### FR-015: Asset cooking pipeline
**Priority:** Won't (future)
**Description:** Automated pipeline to convert source assets (USD, textures,
materials) into optimized runtime formats (compressed textures, LODs, baked
lighting).
**Acceptance Criteria:**
- [ ] `darkiron-cook` crate processes source assets into runtime format
- [ ] Cooked assets published via `asset.{session_id}.cooked` subject
- [ ] Incremental cooking (only re-cook changed assets)

#### FR-016: AI gateway integration
**Priority:** Won't (future)
**Description:** AI services accessible through the engine for tasks like
procedural generation, material suggestion, scene analysis, or natural
language scene editing.
**Acceptance Criteria:**
- [ ] `darkiron-ai-gateway` dispatches tasks to AI backends
- [ ] Results flow back through NATS event system
- [ ] At least one proof-of-concept AI task demonstrated

## 5. Non-Functional Requirements

### NFR-001: Type-safe wire format
**Category:** Reliability
**Priority:** Must
**Description:** All cross-tier communication uses FlatBuffers with generated
type-safe bindings in both Rust and TypeScript. No untyped JSON on NATS.
**Target:** 0 JSON subjects in `nats-subjects.toml` by end of Phase 1.

### NFR-002: Renderer frame rate
**Category:** Performance
**Priority:** Must
**Description:** The WebGPU renderer maintains interactive frame rates for the
chess set scene.
**Target:** 60 FPS for scenes with < 100 meshes and < 500K triangles on
mid-range hardware (integrated GPU).

### NFR-003: Event latency (local)
**Category:** Performance
**Priority:** Should
**Description:** Scene events published by the runtime are received and rendered
by the browser within acceptable latency on localhost.
**Target:** < 50ms end-to-end (publish → render) for transform events on localhost.

### NFR-004: Multi-user scalability
**Category:** Scalability
**Priority:** Must (Phase 3)
**Description:** The system supports 100+ concurrent developers editing the
same scene without degradation.
**Target:** 100 concurrent users, each publishing at up to 30Hz, with < 200ms
presence update latency and < 10ms NATS publish latency.

### NFR-005: Event durability
**Category:** Reliability
**Priority:** Should
**Description:** Scene events are durably stored in NATS JetStream. A newly
joining client can replay the full scene state from the log.
**Target:** All scene mutation events persisted in JetStream. Replay reconstructs
current scene state within 5 seconds for scenes with < 10K events.

### NFR-006: Hot reload
**Category:** Developer Experience
**Priority:** Must
**Description:** Changes to USD assets on disk are automatically detected and
pushed to the browser without manual restart.
**Target:** Asset change → browser update in < 2 seconds.

### NFR-007: Cross-browser support
**Category:** Compatibility
**Priority:** Could
**Description:** Renderer works in Chrome and Edge. Firefox is best-effort.
**Target:** Chrome 113+ and Edge 113+ fully supported. Firefox partial.

### NFR-008: Code quality enforcement
**Category:** Maintainability
**Priority:** Must
**Description:** All code passes strict linting and formatting checks.
**Target:** `#![deny(clippy::all)]` for Rust, `noExplicitAny` for TypeScript,
Biome formatting enforced in CI.

## 6. Integration Points

| System/Component | Direction | Protocol/Format | Notes |
|------------------|-----------|-----------------|-------|
| NATS Server | Runtime ↔ Browser | FlatBuffers over NATS (TCP + WebSocket) | Port 4222 (TCP), 9222 (WS) |
| USD SDK (`openusd` crate) | Runtime reads | C++ FFI via Rust bindings | Platform-specific SDK |
| WebGPU | Browser renders | GPU API | Chrome/Edge required |
| File system (assets/) | Runtime watches | File notify events | Hot reload via `notify` crate |
| JetStream | Runtime writes, Browser replays | NATS JetStream API | Event log persistence |
| flatc compiler | Build-time codegen | CLI → generated source | Rust, TS, Python targets |

## 7. Constraints

- **Technical:**
  - WebGPU is required — no WebGL fallback
  - USD parsing happens only in Rust (browser never touches USD)
  - NATS is the sole transport — no HTTP/gRPC between tiers
  - FlatBuffers is the wire format — no Protobuf, no JSON on NATS
  - WGSL is the only shader language
- **Organizational:**
  - Solo developer + AI assistant collaboration model
  - No external team dependencies
  - Sandbox/experimental — free to try and discard approaches
- **Regulatory:** None

## 8. Out of Scope

- **Production deployment** — K8s/Terraform scaffolding exists but is not a current goal
- **Physics simulation** — No physics engine integration planned for MVP or Phase 2
- **Game logic / scripting** — No scripting runtime (Lua, WASM, etc.)
- **Mobile / VR** — Desktop browsers only
- **WebGL fallback** — WebGPU is a hard requirement
- **GLSL / HLSL shaders** — WGSL only
- **Authentication / authorization** — No user auth for Phase 1–2; Phase 3 may require it
- **Monetization / licensing** — Not considered

## 9. Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| 1 | What PBR shading model to implement? Cook-Torrance GGX is standard — confirm or explore alternatives | Architect | Open |
| 2 | Conflict resolution strategy at scale: LWW vs CRDTs vs OT? | Architect | Open — deferred to Phase 3 |
| 3 | NATS subject partitioning strategy for 100+ users: by region, by object group, by edit domain? | Architect | Open — deferred to Phase 3 |
| 4 | Ray tracing path: WebGPU RT extensions vs compute shader RT vs hybrid? | Architect | Open — deferred to future |
| 5 | Should `task schemas` use flatc directly or a wrapper tool (e.g., buf, FlatBuffers compiler plugin)? | Architect | Open |
| 6 | How should the editor handle large scenes (>100K prims)? Virtualization, LOD, spatial partitioning? | Architect | Open — deferred to Phase 3 |
| 7 | Client handshake: replace the 1s startup delay with a proper ready signal — what protocol? | Architect | Open |

## 10. Glossary

| Term | Definition |
|------|------------|
| **USD** | Universal Scene Description — Pixar's scene format used as the source-of-truth for 3D scene data |
| **PBR** | Physically-Based Rendering — shading model that simulates real-world light interaction using base color, normal, roughness, and metallic properties |
| **FlatBuffers** | Google's zero-copy serialization library — the wire format for all NATS messages |
| **NATS** | Cloud-native messaging system used as the event bus between all engine tiers |
| **JetStream** | NATS persistence layer that stores events durably and enables replay |
| **Cook-Torrance** | A microfacet BRDF model commonly used for PBR — handles specular reflections based on roughness and metallic properties |
| **Prim** | A USD primitive — the fundamental unit in the scene graph (mesh, xform, material, etc.) |
| **BRDF** | Bidirectional Reflectance Distribution Function — defines how light reflects off a surface |
| **BVH** | Bounding Volume Hierarchy — spatial acceleration structure used for ray tracing |
| **CRDT** | Conflict-free Replicated Data Type — a data structure that can be merged without conflicts across distributed nodes |
| **OT** | Operational Transform — an algorithm for resolving concurrent edits (used by Google Docs) |
| **LWW** | Last-Write-Wins — simplest conflict resolution: most recent write takes precedence |
| **Session** | A scoped editing context identified by a UUID — all NATS subjects include the session_id |
| **Hot reload** | Automatic detection and propagation of asset changes without restarting the engine |

## 11. Revision History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-03-19 | Initial draft — MVP through Phase 3 requirements captured |
