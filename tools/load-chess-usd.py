"""
DarkIron USD Loader - Chess Set (v5 — FlatBuffers)
Parses USD, extracts meshes, publishes as FlatBuffers over NATS.
"""
import asyncio, sys, os, struct, time, array
from pxr import Usd, UsdGeom, Gf
import nats

# Add generated Python bindings to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "schemas", "generated", "python"))

import flatbuffers
from darkiron.schema import MeshData as MeshDataFB
from darkiron.schema import SceneLoaded as SceneLoadedFB
from darkiron.schema import SceneEvent as SceneEventFB
from darkiron.schema import SceneEventPayload


def build_scene_event_fb(meshes_data):
    """Build a FlatBuffers SceneEvent containing SceneLoaded with meshes."""
    builder = flatbuffers.Builder(1024 * 1024 * 4)  # 4MB initial

    # Build mesh offsets (must be created before SceneLoaded)
    mesh_offsets = []
    for mesh in meshes_data:
        name_off = builder.CreateString(mesh["name"])

        # Create vertices vector (float32)
        verts = mesh["vertices"]
        MeshDataFB.StartVerticesVector(builder, len(verts))
        for v in reversed(verts):
            builder.PrependFloat32(v)
        verts_off = builder.EndVector()

        # Create indices vector (uint32)
        idxs = mesh["indices"]
        MeshDataFB.StartIndicesVector(builder, len(idxs))
        for idx in reversed(idxs):
            builder.PrependUint32(idx)
        idxs_off = builder.EndVector()

        MeshDataFB.Start(builder)
        MeshDataFB.AddName(builder, name_off)
        MeshDataFB.AddVertices(builder, verts_off)
        MeshDataFB.AddIndices(builder, idxs_off)
        mesh_offsets.append(MeshDataFB.End(builder))

    # Build meshes vector
    SceneLoadedFB.StartMeshesVector(builder, len(mesh_offsets))
    for off in reversed(mesh_offsets):
        builder.PrependUOffsetTRelative(off)
    meshes_vec = builder.EndVector()

    sid_off = builder.CreateString("python-loader")

    SceneLoadedFB.Start(builder)
    SceneLoadedFB.AddSessionId(builder, sid_off)
    SceneLoadedFB.AddMeshes(builder, meshes_vec)
    scene_off = SceneLoadedFB.End(builder)

    timestamp = int(time.time() * 1000)

    SceneEventFB.Start(builder)
    SceneEventFB.AddPayloadType(builder, SceneEventPayload.SceneEventPayload.SceneLoaded)
    SceneEventFB.AddPayload(builder, scene_off)
    SceneEventFB.AddTimestampMs(builder, timestamp)
    event_off = SceneEventFB.End(builder)

    builder.Finish(event_off)
    return bytes(builder.Output())


def extract_mesh(mesh_prim, world_mat, color, name_prefix=""):
    """Extract mesh vertices transformed by world_mat."""
    mesh = UsdGeom.Mesh(mesh_prim)
    points = mesh.GetPointsAttr().Get()
    fvc = mesh.GetFaceVertexCountsAttr().Get()
    fvi = mesh.GetFaceVertexIndicesAttr().Get()
    if not points or not fvc or not fvi:
        return None

    normals = mesh.GetNormalsAttr().Get()
    ninterp = mesh.GetNormalsInterpolation() if normals else None
    normal_mat = world_mat.GetInverse().GetTranspose()

    vert_map = {}
    vertices = []
    indices = []
    fvi_off = 0

    for count in fvc:
        face_idx = []
        for j in range(count):
            vi = fvi[fvi_off + j]
            p = points[vi]
            wp = world_mat.Transform(Gf.Vec3d(float(p[0]), float(p[1]), float(p[2])))
            px, py, pz = round(wp[0], 5), round(wp[1], 5), round(wp[2], 5)

            nx, ny, nz = 0.0, 1.0, 0.0
            if normals:
                ni = fvi_off + j if ninterp == "faceVarying" else vi
                if ni < len(normals):
                    n = normals[ni]
                    tn = normal_mat.TransformDir(Gf.Vec3d(float(n[0]), float(n[1]), float(n[2])))
                    ln = max(tn.GetLength(), 1e-8)
                    nx, ny, nz = round(tn[0]/ln, 4), round(tn[1]/ln, 4), round(tn[2]/ln, 4)

            r, g, b = color
            key = (px, py, pz, nx, ny, nz)
            if key not in vert_map:
                vert_map[key] = len(vertices) // 9
                vertices.extend([px, py, pz, nx, ny, nz, r, g, b])
            face_idx.append(vert_map[key])

        for t in range(1, len(face_idx) - 1):
            indices.extend([face_idx[0], face_idx[t], face_idx[t + 1]])
        fvi_off += count

    if not indices:
        return None
    name = f"{name_prefix}{mesh_prim.GetPath().name}"
    return {"name": name, "vertices": vertices, "indices": indices}


def resolve_point_instancer(instancer_prim, color, team):
    """Resolve PointInstancer instances into individual meshes."""
    pi_schema = UsdGeom.PointInstancer(instancer_prim)
    proto_indices = pi_schema.GetProtoIndicesAttr().Get()
    proto_paths = pi_schema.GetPrototypesRel().GetTargets()
    if not proto_indices or not proto_paths:
        return []

    xforms = pi_schema.ComputeInstanceTransformsAtTime(Usd.TimeCode.Default(), Usd.TimeCode.Default())
    if not xforms:
        return []

    instancer_world = UsdGeom.XformCache().GetLocalToWorldTransform(instancer_prim)
    stage = instancer_prim.GetStage()
    meshes = []

    print(f"  PointInstancer: {instancer_prim.GetPath()} ({len(xforms)} instances)")

    for i, pi in enumerate(proto_indices):
        if pi >= len(proto_paths) or i >= len(xforms):
            continue
        proto_prim = stage.GetPrimAtPath(proto_paths[pi])
        if not proto_prim:
            continue

        instance_world = Gf.Matrix4d(xforms[i]) * instancer_world

        for child in Usd.PrimRange(proto_prim):
            if not child.IsA(UsdGeom.Mesh):
                continue
            child_world = UsdGeom.XformCache().GetLocalToWorldTransform(child)
            proto_world = UsdGeom.XformCache().GetLocalToWorldTransform(proto_prim)
            child_in_proto = child_world * proto_world.GetInverse()
            final_mat = child_in_proto * instance_world

            child_parent = child.GetParent().GetName() if child.GetParent() else ""
            mesh = extract_mesh(child, final_mat, color, name_prefix=f"{team}_Pawn{i}_{child_parent}_")
            if mesh:
                print(f"    [{i}] {child.GetPath().name}: {len(mesh['indices'])//3} tris")
                meshes.append(mesh)
    return meshes


def load_chess_set(usd_path):
    stage = Usd.Stage.Open(usd_path)
    if not stage:
        return []

    print(f"Stage: {usd_path}")
    print(f"  metersPerUnit={UsdGeom.GetStageMetersPerUnit(stage)}, upAxis={UsdGeom.GetStageUpAxis(stage)}")

    colors = {"Black": (0.12, 0.10, 0.08), "White": (0.92, 0.89, 0.84)}
    all_meshes = []

    instancer_paths = set()
    for prim in stage.TraverseAll():
        if prim.IsA(UsdGeom.PointInstancer):
            instancer_paths.add(str(prim.GetPath()))

    for prim in stage.TraverseAll():
        path = str(prim.GetPath())
        if any(path.startswith(ip + "/") for ip in instancer_paths):
            continue

        if "Black" in path:
            color, team = colors["Black"], "Black"
        elif "White" in path:
            color, team = colors["White"], "White"
        elif "Chessboard" in path:
            color, team = (0.45, 0.35, 0.25), "Board"
        else:
            color, team = (0.5, 0.5, 0.5), "Other"

        if prim.IsA(UsdGeom.PointInstancer):
            meshes = resolve_point_instancer(prim, color, team)
            all_meshes.extend(meshes)
            continue

        if not prim.IsA(UsdGeom.Mesh):
            continue

        world_mat = UsdGeom.XformCache().GetLocalToWorldTransform(prim)
        gp = prim.GetParent().GetParent().GetName() if prim.GetParent() and prim.GetParent().GetParent() else prim.GetParent().GetName() if prim.GetParent() else ""
        mesh = extract_mesh(prim, world_mat, color, name_prefix=f"{team}_{gp}_")
        if mesh:
            print(f"  Mesh: {path} ({len(mesh['indices'])//3} tris)")
            all_meshes.append(mesh)

    print(f"\nTotal: {len(all_meshes)} meshes")
    return all_meshes


async def publish_to_nats(meshes):
    nc = await nats.connect("nats://localhost:4222")
    print(f"NATS connected. Publishing {len(meshes)} meshes as FlatBuffers...")

    # Send meshes in batches to stay under NATS max_payload
    batch_size = 3
    for i in range(0, len(meshes), batch_size):
        batch = meshes[i:i+batch_size]
        fb_bytes = build_scene_event_fb(batch)
        await nc.publish("scene.chess.loaded", fb_bytes)
        names = ", ".join(m["name"] for m in batch)
        print(f"  [{i+1}-{min(i+batch_size, len(meshes))}/{len(meshes)}] {len(fb_bytes)//1024}KB FB — {names}")
        await asyncio.sleep(0.05)

    await nc.flush()
    await nc.close()
    print("Done! All meshes published as FlatBuffers.")


if __name__ == "__main__":
    usd_path = r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set.usda"
    meshes = load_chess_set(usd_path)
    if meshes:
        asyncio.run(publish_to_nats(meshes))

