"""Send Phase 1 FlatBuffers migration plan to Gemini for review."""
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
    # Gather current code for context
    files = {
        "FlatBuffers Schema": "schemas/flatbuffers/scene.fbs",
        "NATS Subject Registry": "schemas/nats-subjects.toml",
        "Rust Transport": "crates/darkiron-transport/src/lib.rs",
        "Rust Transport Cargo.toml": "crates/darkiron-transport/Cargo.toml",
        "Rust Scene Manager": "crates/darkiron-runtime/src/scene_manager.rs",
        "Rust Runtime Cargo.toml": "crates/darkiron-runtime/Cargo.toml",
        "TS Transport": "packages/transport/src/index.ts",
        "TS Editor App": "packages/editor/src/App.tsx",
        "Root Cargo.toml": "Cargo.toml",
    }

    code_parts = []
    for label, path in files.items():
        content = read_file(path)
        if content:
            code_parts.append(f"### {label} ({path})\n```\n{content}\n```")
            print(f"  + {path} ({len(content)} chars)")
    code_text = "\n\n".join(code_parts)

    plan = """
# Phase 1 Plan: Migrate NATS Payloads from JSON to FlatBuffers

## Goal
Replace all JSON serialization over NATS with FlatBuffers binary format.
This is Architecture Rule #3 from CLAUDE.md: "FlatBuffers is the wire format."

## Current State
- Rust runtime builds scenes as `serde_json::Value`, serializes with `serde_json::to_vec()`
- TS transport encodes with `JSON.stringify()`, decodes with `JSON.parse()`
- Python USD loader sends JSON via `json.dumps().encode()`
- FlatBuffers schema exists at `schemas/flatbuffers/scene.fbs` but is unused
- `flatbuffers` crate is commented out in Cargo.toml

## Migration Plan (7 Steps)

### Step 1: Install FlatBuffers compiler (flatc)
- Download flatc binary for Windows from GitHub releases
- Add to PATH
- Verify: `flatc --version`

### Step 2: Generate bindings from schema
- Run: `flatc --rust -o schemas/generated/rust/ schemas/flatbuffers/scene.fbs`
- Run: `flatc --ts -o schemas/generated/ts/ schemas/flatbuffers/scene.fbs`
- Commit generated code (per CLAUDE.md convention)
- Create a thin wrapper crate `darkiron-schema` that re-exports the generated types

### Step 3: Update Rust transport layer
- Add `flatbuffers` crate to `darkiron-transport/Cargo.toml`
- Add typed publish/subscribe methods:
  ```rust
  pub async fn publish_fb<T: FlatBufferSerializable>(&self, subject: &str, msg: &T) -> Result<()>
  pub async fn subscribe_fb(&self, subject: &str) -> Result<FbSubscriber>
  ```
- Keep the raw `publish(&[u8])` for backward compatibility
- FbSubscriber yields typed messages with `flatbuffers::root::<T>(payload)`

### Step 4: Update Rust scene_manager
- Replace `serde_json::Value` scene building with FlatBuffers builders
- `build_cube_scene()` → returns `Vec<u8>` (FlatBuffers bytes)
- `load_scene_file()` → reads JSON from disk, converts to FlatBuffers for publish
- `publish_scene()` → publishes raw FlatBuffer bytes directly
- Remove `serde_json` from the NATS publish path (keep for file I/O)

### Step 5: Update TypeScript transport
- Install `flatbuffers` npm package
- Import generated TS types from `schemas/generated/ts/`
- `DarkIronTransport.subscribe()` decodes FlatBuffers instead of JSON.parse()
- `DarkIronTransport.publish()` encodes FlatBuffers instead of JSON.stringify()
- Expose typed message accessors

### Step 6: Update Python USD loader
Two options:
  A) Have the Python loader send FlatBuffers (requires `flatbuffers` pip package)
  B) Keep Python sending JSON, add a JSON→FlatBuffers conversion in the Rust runtime
I recommend Option A for consistency.

### Step 7: Update editor App.tsx
- The editor already uses `@darkiron/transport` (fixed in PR #1)
- Transport layer handles deserialization, so editor just receives typed objects
- Update the `MeshData` type to match FlatBuffers-generated types
- May need adapter if FlatBuffers accessor API differs from plain objects

## Schema Changes Needed
The current `scene.fbs` uses `indices: [uint16]` but our chess set has >65K vertices.
Change to `indices: [uint32]` to match the renderer's `Uint32Array`.

## What We DON'T Change
- NATS subjects stay the same
- Transport layer public API stays the same (callers don't know about FlatBuffers)
- File I/O can stay JSON (scene files on disk)
- Python loader external interface stays the same

## Risk Assessment
- FlatBuffers TS codegen quality varies — may need manual wrappers
- Large meshes (67MB JSON chess set) will be much smaller as FlatBuffers (~20MB)
- Zero-copy access means the browser won't need to allocate large JS objects

## Estimated Effort
- Step 1: 5 min
- Step 2: 15 min
- Step 3: 30 min
- Step 4: 45 min
- Step 5: 45 min
- Step 6: 30 min
- Step 7: 15 min
Total: ~3 hours of focused work
"""

    prompt = f"""You are a senior systems architect reviewing a migration plan.

I'm building DarkIron Engine — a distributed game engine with Rust runtime, NATS message bus, and WebGPU browser editor. We currently use JSON for all NATS payloads and need to migrate to FlatBuffers.

Please review my Phase 1 plan below and the current codebase, then provide:

1. **Plan Assessment**: Is the plan sound? Any missing steps or wrong ordering?
2. **Technical Risks**: What could go wrong? What are the hardest parts?
3. **Schema Review**: Any issues with the .fbs schema? Suggestions?
4. **Architecture Feedback**: Is the transport layer abstraction correct for hiding FlatBuffers from callers?
5. **Alternative Approaches**: Should we consider anything else? (e.g., protobuf, MessagePack, Cap'n Proto)
6. **Recommended Changes**: Specific modifications to the plan, prioritized.

Be concise and actionable.

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

    out = os.path.join(BASE, "docs", "gemini-phase1-review.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write("# Gemini Review — Phase 1 FlatBuffers Migration Plan\n\n" + review)
    print(f"\nSaved to: {out}")

if __name__ == "__main__":
    main()

