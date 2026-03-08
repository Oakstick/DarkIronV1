"""Apply FlatBuffers migration: update Cargo.toml, scene_manager, transport, etc."""
import os

BASE = r"D:\DarkIron\darkiron"

def replace_in(rel_path, old, new):
    path = os.path.join(BASE, rel_path)
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    if old in content:
        content = content.replace(old, new)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"  Updated: {rel_path}")
    else:
        print(f"  Skipped (not found): {rel_path}")

# 1. Uncomment flatbuffers in workspace Cargo.toml
print("Step 1: Enable flatbuffers in workspace")
replace_in("Cargo.toml",
    '# flatbuffers = "24.3"  # Enable when FlatBuffers schemas are ready',
    'flatbuffers = "24.3"')

# 2. Add flatbuffers to runtime Cargo.toml
print("Step 2: Add flatbuffers to runtime")
replace_in("crates/darkiron-runtime/Cargo.toml",
    "notify.workspace = true",
    "notify.workspace = true\nflatbuffers.workspace = true")

# 3. Add flatbuffers to transport Cargo.toml
print("Step 3: Add flatbuffers to transport")
replace_in("crates/darkiron-transport/Cargo.toml",
    'bytes = "1"',
    'bytes = "1"\nflatbuffers = "24.3"')

# 4. Install flatbuffers npm package
print("Step 4: Install flatbuffers npm")
os.system(f'cd /d "{BASE}" && pnpm add -w flatbuffers')

# Also add to transport package
os.system(f'cd /d "{BASE}\\packages\\transport" && pnpm add flatbuffers')

print("\nDone! Dependencies added.")

