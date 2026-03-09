"""Flatten a USD file (resolve all references, payloads, variants)."""
import sys
from pxr import Usd, UsdGeom, UsdUtils

src = r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set.usda"
dst = r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set_flat.usda"

stage = Usd.Stage.Open(src)
print(f"Opened: {src}")
print(f"  Prims: {len(list(stage.TraverseAll()))}")

flat = stage.Flatten()
flat.Export(dst)

import os
size = os.path.getsize(dst)
print(f"Exported flat: {dst} ({size // 1024}KB)")

# Verify
stage2 = Usd.Stage.Open(dst)
mesh_count = sum(1 for p in stage2.TraverseAll() if p.IsA(UsdGeom.Mesh))
print(f"Verified: {mesh_count} meshes in flat file")

