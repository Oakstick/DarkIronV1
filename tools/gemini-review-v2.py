"""Ask Gemini to compare before/after renders."""
import os, base64
from google import genai
from google.genai import types

API_KEY = os.environ.get("GEMINI_API_KEY", "")
BASE = r"D:\DarkIron\darkiron"

def load_img(rel):
    path = os.path.join(BASE, rel)
    with open(path, "rb") as f:
        return f.read()

def main():
    before = load_img("docs/chess-render-screenshot.png")
    after = load_img("docs/chess-render-v4.png")
    reference = load_img("assets/OpenChessSet/teaser.png")

    loader = open(os.path.join(BASE, "tools/load-chess-usd.py"), "r").read()

    print(f"Before: {len(before)//1024}KB, After: {len(after)//1024}KB, Ref: {len(reference)//1024}KB")

    contents = [
        types.Part.from_text(text="IMAGE 1 - BEFORE (original render with issues):"),
        types.Part.from_bytes(data=before, mime_type="image/png"),
        types.Part.from_text(text="IMAGE 2 - AFTER (fixes applied):"),
        types.Part.from_bytes(data=after, mime_type="image/png"),
        types.Part.from_text(text="IMAGE 3 - REFERENCE (target look):"),
        types.Part.from_bytes(data=reference, mime_type="image/png"),
        types.Part.from_text(text=f"""You are a senior graphics engineer reviewing render improvements.

I applied three fixes to the DarkIron Engine chess set renderer:
1. Fixed PointInstancer transforms — pawns now resolve all 8 instances per side
2. Removed arbitrary SCALE=5.0 — using real USD metersPerUnit coordinates
3. Adjusted camera — narrower FOV (30deg), closer radius (0.8m), lower target

Compare BEFORE vs AFTER vs REFERENCE:

1. What improved? List every visual improvement you see.
2. What's still wrong? List remaining issues compared to reference.
3. Rate the AFTER image 1-10 for geometric accuracy (are all pieces present and correctly positioned?)
4. Top 3 next priorities to get closer to the reference render.

Current USD loader code for context:
```python
{loader}
```

Be concise and specific."""),
    ]

    print("Sending to Gemini...")
    client = genai.Client(api_key=API_KEY)
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=contents,
    )

    review = response.text
    print("\n" + "=" * 60)
    print(review)

    out = os.path.join(BASE, "docs", "gemini-render-review-v2.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write("# Gemini Render Review — After Fixes\n\n" + review)
    print(f"\nSaved to: {out}")

if __name__ == "__main__":
    main()

