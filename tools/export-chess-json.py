"""Export chess set meshes to a JSON file that File > Open can load."""
import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))

# Reuse the loader
from importlib.machinery import SourceFileLoader
loader_mod = SourceFileLoader("loader", os.path.join(os.path.dirname(__file__), "load-chess-usd.py")).load_module()

usd_path = r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set.usda"
out_path = r"D:\DarkIron\darkiron\assets\chess-set-scene.json"

meshes, mpu = loader_mod.load_chess_set(usd_path)

# Clean internal keys
for m in meshes:
    m.pop("_tris", None)
    m.pop("_verts", None)

scene = {"type": "SceneLoaded", "meshes": meshes}
with open(out_path, "w") as f:
    json.dump(scene, f)

size_mb = os.path.getsize(out_path) / (1024 * 1024)
print(f"\nExported {len(meshes)} meshes to {out_path} ({size_mb:.1f} MB)")

