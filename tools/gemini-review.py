"""
DarkIron Code Review via Gemini API
Gathers core source files and sends them to Gemini for review.
"""
import os
from google import genai

API_KEY = os.environ.get("GEMINI_API_KEY", "")
BASE = r"D:\DarkIron\darkiron"

FILES = [
    "Cargo.toml",
    "package.json",
    "docker-compose.yml",
    "Taskfile.yml",
    "crates/darkiron-runtime/Cargo.toml",
    "crates/darkiron-runtime/src/main.rs",
    "crates/darkiron-transport/Cargo.toml",
    "crates/darkiron-transport/src/lib.rs",
    "crates/darkiron-usd/src/lib.rs",
    "crates/darkiron-cook/src/lib.rs",
    "crates/darkiron-presence/src/lib.rs",
    "crates/darkiron-ai-gateway/src/lib.rs",
    "packages/renderer/src/index.ts",
    "packages/editor/src/App.tsx",
    "packages/editor/src/main.tsx",
    "packages/transport/src/index.ts",
    "packages/shared-types/src/index.ts",
    "schemas/flatbuffers/scene.fbs",
    "schemas/nats-subjects.toml",
    "shaders/golden_triangle.wgsl",
    "tools/load-chess-usd.py",
    "CLAUDE.md",
    "README.md",
]

def gather_sources():
    code = []
    for f in FILES:
        path = os.path.join(BASE, f)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                content = fh.read()
            code.append(f"### FILE: {f}\n```\n{content}\n```\n")
            print(f"  + {f} ({len(content)} chars)")
        else:
            print(f"  - {f} (not found)")
    return "\n".join(code)

def main():
    if not API_KEY:
        print("ERROR: Set GEMINI_API_KEY environment variable")
        return

    print("Gathering DarkIron source files...")
    sources = gather_sources()
    print(f"\nTotal source: {len(sources)} chars ({len(sources)//1024}KB)")

    prompt = f"""You are an expert senior software engineer reviewing a game engine codebase called "DarkIron Engine".

DarkIron is a distributed game engine with:
- Rust backend (runtime, transport, USD scene handling)
- TypeScript/React frontend (WebGPU renderer, editor UI)
- NATS message bus connecting them
- FlatBuffers for serialization
- Docker for infrastructure

Please review the following codebase and provide:

1. **Architecture Assessment** - Is the architecture sound? Any concerns about the Rust + TypeScript + NATS approach?
2. **Code Quality** - Highlight any bugs, anti-patterns, or code smells in both Rust and TypeScript code.
3. **WebGPU Renderer Review** - The renderer is in packages/renderer/src/index.ts. Review the WebGPU code, shaders, and rendering pipeline.
4. **Security Concerns** - Any security issues, especially around NATS configuration, Docker setup, or API handling?
5. **Performance** - Any obvious performance bottlenecks or optimization opportunities?
6. **Recommendations** - Top 5 actionable improvements ranked by priority.

Be specific with file names and line references where possible.

---

{sources}
"""

    print(f"\nSending to Gemini (prompt: {len(prompt)//1024}KB)...")
    client = genai.Client(api_key=API_KEY)
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
    )

    review = response.text
    print("\n" + "="*80)
    print("GEMINI CODE REVIEW - DarkIron Engine")
    print("="*80 + "\n")
    print(review)

    # Save to file
    out = os.path.join(BASE, "docs", "gemini-code-review.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write("# DarkIron Engine - Gemini Code Review\n\n")
        f.write(review)
    print(f"\nReview saved to: {out}")

if __name__ == "__main__":
    main()

