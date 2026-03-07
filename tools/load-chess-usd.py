"""
DarkIron USD Loader - Chess Set
Reads chess USD, extracts meshes, publishes each to NATS individually.
"""
import asyncio, json, sys
from pxr import Usd, UsdGeom, Gf
import nats

SCALE = 5.0  # Scale up (chess set is ~0.5m, we want it visible)

def get_world_transform(prim):
    xfCache = UsdGeom.XformCache()
    return xfCache.GetLocalToWorldTransform(prim)

def extract_mesh(mesh_prim, world_mat, color, decimate=1):
    mesh = UsdGeom.Mesh(mesh_prim)
    points = mesh.GetPointsAttr().Get()
    fvc = mesh.GetFaceVertexCountsAttr().Get()
    fvi = mesh.GetFaceVertexIndicesAttr().Get()
    if not points or not fvc or not fvi:
        return None
    
    normals = mesh.GetNormalsAttr().Get()
    normals_interp = mesh.GetNormalsInterpolation() if normals else None
    
    # Build deduplicated vertex buffer with indexing
    vert_map = {}
    vertices = []
    indices = []
    fvi_offset = 0
    face_count = 0
    
    for face_i, count in enumerate(fvc):
        face_count += 1
        if decimate > 1 and face_count % decimate != 0:
            fvi_offset += count
            continue
            
        face_idx = []
        for j in range(count):
            vi = fvi[fvi_offset + j]
            p = points[vi]
            # Apply world transform and scale
            wp = world_mat.Transform(Gf.Vec3d(p[0], p[1], p[2]))
            px, py, pz = round(wp[0]*SCALE, 3), round(wp[1]*SCALE, 3), round(wp[2]*SCALE, 3)
            
            nx, ny, nz = 0.0, 1.0, 0.0
            if normals:
                ni = fvi_offset + j if normals_interp == "faceVarying" else vi
                if ni < len(normals):
                    n = normals[ni]
                    nx, ny, nz = round(n[0], 3), round(n[1], 3), round(n[2], 3)
            
            r, g, b = color
            key = (px, py, pz, nx, ny, nz)
            if key not in vert_map:
                vert_map[key] = len(vertices) // 9
                vertices.extend([px, py, pz, nx, ny, nz, r, g, b])
            face_idx.append(vert_map[key])
        
        # Triangulate fan
        for t in range(1, len(face_idx) - 1):
            indices.extend([face_idx[0], face_idx[t], face_idx[t + 1]])
        fvi_offset += count
    
    if not indices:
        return None
    
    return {
        "name": mesh_prim.GetPath().name + "_" + str(hash(str(mesh_prim.GetPath())) % 10000),
        "vertices": vertices,
        "indices": indices
    }

def load_chess_set(usd_path):
    stage = Usd.Stage.Open(usd_path)
    if not stage:
        return []
    
    print(f"Stage: {usd_path} (up={UsdGeom.GetStageUpAxis(stage)}, scale={UsdGeom.GetStageMetersPerUnit(stage)})")
    
    colors = {
        "Black": (0.12, 0.10, 0.08),
        "White": (0.9, 0.87, 0.82),
    }
    
    all_meshes = []
    for prim in stage.TraverseAll():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        
        path = str(prim.GetPath())
        world_mat = get_world_transform(prim)
        
        if "Black" in path:
            color = colors["Black"]
        elif "White" in path:
            color = colors["White"]
        elif "Chessboard" in path:
            color = (0.45, 0.32, 0.22)
        else:
            color = (0.5, 0.5, 0.5)
        
        # Decimate high-poly meshes (>50k faces)
        fvc = UsdGeom.Mesh(prim).GetFaceVertexCountsAttr().Get()
        face_count = len(fvc) if fvc else 0
        decimate = 1
        if face_count > 50000:
            decimate = 3
        elif face_count > 20000:
            decimate = 2
        
        mesh_data = extract_mesh(prim, world_mat, color, decimate)
        if mesh_data and len(mesh_data["indices"]) > 0:
            tris = len(mesh_data["indices"]) // 3
            verts = len(mesh_data["vertices"]) // 9
            size_kb = len(json.dumps(mesh_data)) // 1024
            print(f"  {path}: {tris} tris, {verts} verts, ~{size_kb}KB")
            all_meshes.append(mesh_data)
    
    print(f"\nTotal: {len(all_meshes)} meshes")
    return all_meshes

async def publish_to_nats(meshes):
    nc = await nats.connect("nats://localhost:4222")
    print(f"NATS connected. Publishing {len(meshes)} meshes...")
    
    for i, mesh in enumerate(meshes):
        payload = json.dumps({"meshes": [mesh]})
        await nc.publish("scene.chess.loaded", payload.encode())
        print(f"  [{i+1}/{len(meshes)}] {mesh['name']} ({len(payload)//1024}KB)")
        await asyncio.sleep(0.1)
    
    await nc.flush()
    await nc.close()
    print("All meshes published!")

if __name__ == "__main__":
    usd_path = r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set.usda"
    meshes = load_chess_set(usd_path)
    if meshes:
        asyncio.run(publish_to_nats(meshes))

