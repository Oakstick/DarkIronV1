"""
Ask Gemini to review the chess set rendering — send screenshot + code.
"""
import os, base64
from google import genai
from google.genai import types

API_KEY = os.environ.get("GEMINI_API_KEY", "")
BASE = r"D:\DarkIron\darkiron"

def read_file(rel):
    path = os.path.join(BASE, rel)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    return ""

def main():
    if not API_KEY:
        print("ERROR: Set GEMINI_API_KEY")
        return

    # Load screenshot as base64
    img_path = os.path.join(BASE, "docs", "chess-render-screenshot.png")
    with open(img_path, "rb") as f:
        img_data = f.read()
    print(f"Screenshot: {len(img_data)//1024}KB")

    # Load reference teaser image
    teaser_path = os.path.join(BASE, "assets", "OpenChessSet", "teaser.png")
    teaser_data = None
    if os.path.exists(teaser_path):
        with open(teaser_path, "rb") as f:
            teaser_data = f.read()
        print(f"Reference teaser: {len(teaser_data)//1024}KB")

    # Load relevant source files
    files = {
        "USD Loader (Python)": "tools/load-chess-usd.py",
        "WebGPU Renderer": "packages/renderer/src/index.ts",
        "Mesh Shader": "shaders/mesh.wgsl",
        "Chess Set USD": "assets/OpenChessSet/chess_set.usda",
    }
    code_parts = []
    for label, path in files.items():
        content = read_file(path)
        if content:
            code_parts.append(f"### {label} ({path})\n```\n{content}\n```")
            print(f"  + {path} ({len(content)} chars)")

    code_text = "\n\n".join(code_parts)

    # Build the prompt
    prompt_text = """You are a senior graphics engineer reviewing a WebGPU chess set rendering.

I'm showing you TWO images:
1. **Current render** — what our DarkIron Engine WebGPU renderer currently produces
2. **Reference** — how the Open Chess Set should look (from the asset's teaser.png)

And the relevant source code: the USD loader (Python), the WebGPU renderer (TypeScript), the mesh shader (WGSL), and the chess set USD scene file.

Please analyze:

1. **What's visually wrong** with the current render compared to the reference? List every issue you see.
2. **Root cause analysis** — for each visual issue, trace it back to a specific bug in the code (USD loader, renderer, or shader).
3. **Fix recommendations** — provide specific code changes to fix each issue, with file names and what to change.

Be very specific and technical. Reference line numbers and function names where possible.

---

SOURCE CODE:

""" + code_text

    # Build message parts
    contents = [
        types.Part.from_text(text="CURRENT RENDER (what our engine produces):"),
        types.Part.from_bytes(data=img_data, mime_type="image/png"),
    ]
    if teaser_data:
        contents.append(types.Part.from_text(text="REFERENCE IMAGE (how it should look):"))
        contents.append(types.Part.from_bytes(data=teaser_data, mime_type="image/png"))
    contents.append(types.Part.from_text(text=prompt_text))

    print(f"\nSending to Gemini (code: {len(code_text)//1024}KB)...")

    client = genai.Client(api_key=API_KEY)
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=contents,
    )

    review = response.text
    print("\n" + "=" * 80)
    print("GEMINI RENDER REVIEW")
    print("=" * 80 + "\n")
    print(review)

    out = os.path.join(BASE, "docs", "gemini-render-review.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write("# DarkIron Chess Set — Gemini Render Review\n\n")
        f.write(review)
    print(f"\nSaved to: {out}")

if __name__ == "__main__":
    main()

