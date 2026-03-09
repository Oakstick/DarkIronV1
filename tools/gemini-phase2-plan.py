"""Send Phase 2 plan to Gemini for review."""
import os
from google import genai

API_KEY = os.environ.get("GEMINI_API_KEY", "")
BASE = r"D:\DarkIron\darkiron"

def read_file(rel):
    path = os.path.join(BASE, rel)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    return ""

def main():
    files = {
        "darkiron-usd stub": "crates/darkiron-usd/src/lib.rs",
        "darkiron-usd Cargo.toml": "crates/darkiron-usd/Cargo.toml",
        "Python USD loader (current)": "tools/load-chess-usd.py",
        "scene_manager.rs": "crates/darkiron-runtime/src/scene_manager.rs",
        "main.rs": "crates/darkiron-runtime/src/main.rs",
        "FlatBuffers schema": "schemas/flatbuffers/scene.fbs",
        "chess_set.usda": "assets/OpenChessSet/chess_set.usda",
        "CLAUDE.md": "CLAUDE.md",
    }

    code_parts = []
    for label, path in files.items():
        content = read_file(path)
        if content:
            code_parts.append(f"### {label} ({path})\n```\n{content}\n```")
            print(f"  + {path} ({len(content)} chars)")
    code_text = "\n\n".join(code_parts)

    plan = """
# Phase 2 Plan: Rust USD Stage Management

## Goal
Replace the external Python USD loader with native Rust USD support in the
`darkiron-usd` crate. The Rust runtime should be able to open USD stages,
traverse the scene graph, extract mesh geometry, resolve PointInstancers,
and publish FlatBuffers scene data to NATS — all without Python.

## Current State
- `darkiron-usd` crate is a stub (just `pub fn init()`)
- USD loading is done by `tools/load-chess-usd.py` (external Python script)
- Python uses `pxr` (OpenUSD C++ bindings via Python) and `nats-py`
- The loader extracts: mesh positions, normals, per-vertex colors, indices
- It handles PointInstancers for pawn instancing
- Output goes through FlatBuffers → NATS (Phase 1 complete)

## Rust USD Library Options

### Option A: `openusd` crate (mxpv) — v0.1.4
- Pure Rust, no C++ dependencies
- Reads usda, usdc, usdz formats
- Low-level API: reads layers and specs
- No built-in scene composition (references, payloads, variants)
- No built-in PointInstancer support
- We'd need to implement composition ourselves

### Option B: `openusd-rs` crate (laurooyen) — v0.1.0
- Pure Rust, no C++ dependencies
- Higher-level API: `Stage::open()`, `usd_geom::Mesh`, `triangulate()`
- Has `mesh.points_attr().get::<vt::Array<gf::Vec3f>>()`
- Newer, less tested, v0.1.0
- May not support complex composition arcs

### Option C: `pxr_rs` (C++ FFI bindings to Pixar's OpenUSD)
- Full OpenUSD feature set
- 50-minute first build, complex C++ dependency chain
- Requires OpenUSD SDK installed or vendored
- Most complete but heaviest

### Recommendation: Option A (`openusd` crate) with custom composition
- Zero C++ dependencies = fast builds, easy CI, cross-platform
- The chess set uses: references, payloads, variants, PointInstancers
- We can implement minimal composition for our specific needs
- If too limited, fall back to Option B or keep Python as backup

## Implementation Plan (6 Steps)

### Step 1: Add `openusd` crate and basic stage reading
- Add `openusd` to `darkiron-usd/Cargo.toml`
- Implement `UsdStage::open(path)` that reads a `.usda` or `.usdc` file
- Implement basic prim traversal: iterate all prims, get types
- Test: open `chess_set.usda`, list all prim paths

### Step 2: Implement mesh extraction
- Read `UsdGeom.Mesh` attributes: points, faceVertexCounts, faceVertexIndices, normals
- Triangulate quads/n-gons (fan triangulation, same as Python)
- Read xformOpOrder + transform matrices
- Test: extract a single piece (e.g., King) geometry

### Step 3: Implement composition resolution
- Follow `references` to load referenced USD files (e.g., `@./assets/King/King.usd@`)
- Follow `payload` directives to load geometry layers
- Follow `subLayers` for material+geometry stacking
- Resolve `variants` (shadingVariant = "Black"/"White") for color assignment
- Test: open chess_set.usda, resolve all references, get full scene graph

### Step 4: Implement PointInstancer resolution
- Read PointInstancer attributes: protoIndices, positions, orientations, scales
- Compute instance transforms (equivalent to ComputeInstanceTransformsAtTime)
- Clone prototype meshes with instance transforms applied
- Test: resolve all 8 black pawns from the PointInstancer

### Step 5: Integrate with runtime + FlatBuffers pipeline
- Add `darkiron-usd` as dependency to `darkiron-runtime`
- New function in `scene_manager.rs`: `load_usd_scene(path, session_id) -> Vec<u8>`
- Builds FlatBuffers SceneEvent from extracted USD meshes
- Runtime auto-detects .usda/.usdc/.usd files in assets directory
- Publishes via NATS same as JSON path, but no Python needed

### Step 6: Hot reload for USD files
- Extend `asset_watcher.rs` to watch `.usda`, `.usdc`, `.usd` extensions
- On change: re-open stage, re-extract, re-publish via FlatBuffers
- Keep JSON hot reload for backward compat

## Scope Boundaries (What Phase 2 Does NOT Do)
- No material/texture extraction (that's Phase 3/4)
- No UV coordinate extraction (Phase 3)
- No animation/time-sampled data
- No camera or light extraction
- Colors are still assigned by path heuristic (Black/White/Board)
- Python loader remains available as a fallback

## Risk Assessment
- The `openusd` crate may not support all composition arcs we need
- The chess set uses complex composition: references → payloads → sublayers → variants
- If the pure Rust crate can't resolve these, we have fallback options:
  1. Pre-flatten the USD with `usdcat --flatten` and load the flat file
  2. Keep Python as a sidecar process called from Rust
  3. Switch to Option B or C

## Estimated Effort
- Step 1: 30 min (add crate, basic reading)
- Step 2: 1-2 hours (mesh extraction + triangulation)
- Step 3: 2-3 hours (composition is the hard part)
- Step 4: 1-2 hours (PointInstancer)
- Step 5: 30 min (integration)
- Step 6: 15 min (file watcher extension)
Total: ~6-8 hours

## Fallback Strategy
If the pure Rust crate can't handle the chess set's composition:
1. Use `usdcat --flatten` to pre-process USD → flat USDA
2. Load the flat USDA in Rust (no composition needed)
3. This is a valid production strategy: cook assets offline, load flat at runtime
"""

    prompt = f"""You are a senior systems architect with deep experience in OpenUSD, Rust, and game engine development.

I'm building the DarkIron Engine — a distributed game engine with a Rust runtime. Phase 1 (FlatBuffers migration) is complete. Now I'm planning Phase 2: native Rust USD support.

Please review my Phase 2 plan and the current codebase, then provide:

1. **Library Recommendation**: Which Rust USD crate should I use? Have you seen real-world usage of any of these?
2. **Composition Complexity**: How hard is it to implement USD composition arcs (references, payloads, sublayers, variants) from scratch?
3. **Plan Assessment**: Is the plan realistic? What's the hardest part? Any missing steps?
4. **Fallback Strategy**: Is the `usdcat --flatten` approach a good fallback? Any concerns?
5. **Architecture Feedback**: Should `darkiron-usd` be a separate crate or merged into the runtime?
6. **Alternative Approach**: Should we consider embedded Python (PyO3) instead of pure Rust USD?
7. **Top 3 Recommendations**: Specific changes to the plan, prioritized.

Be concise and actionable. Focus on what will actually work in practice.

---

## THE PLAN

{plan}

---

## CURRENT CODEBASE

{code_text}
"""

    print(f"\nSending to Gemini ({len(prompt)//1024}KB)...")
    client = genai.Client(api_key=API_KEY)
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
    )

    review = response.text
    print("\n" + "=" * 60)
    print(review)

    out = os.path.join(BASE, "docs", "gemini-phase2-review.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write("# Gemini Review — Phase 2 Rust USD Plan\n\n" + review)
    print(f"\nSaved to: {out}")

if __name__ == "__main__":
    main()

