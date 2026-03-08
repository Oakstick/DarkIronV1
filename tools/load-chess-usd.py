"""
DarkIron USD Loader - Chess Set (v4)

Fixes:
1. PointInstancer: use ComputeInstanceTransformsAtTime correctly
2. Remove arbitrary SCALE — use metersPerUnit from stage
3. Pass metersPerUnit so camera can auto-adjust
"""
import asyncio, json, sys
from pxr import Usd, UsdGeom, Gf
import nats


def extract_mesh(mesh_prim, world_mat, color, name_prefix=""):
    """Extract mesh vertices transformed by world_mat. No extra scaling."""
    mesh = UsdGeom.Mesh(mesh_prim)
    points = mesh.GetPointsAttr().Get()
    fvc = mesh.GetFaceVertexCountsAttr().Get()
    fvi = mesh.GetFaceVertexIndicesAttr().Get()
    if not points or not fvc or not fvi:
        return None

    normals = mesh.GetNormalsAttr().Get()
    ninterp = mesh.GetNormalsInterpolation() if normals else None

    # Normal transform = inverse transpose of upper 3x3
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
    tris = len(indices) // 3
    verts = len(vertices) // 9
    return {"name": name, "vertices": vertices, "indices": indices, "_tris": tris, "_verts": verts}


def resolve_point_instancer(instancer_prim, color, team):
    """Resolve PointInstancer instances into individual meshes."""
    pi_schema = UsdGeom.PointInstancer(instancer_prim)
    proto_indices = pi_schema.GetProtoIndicesAttr().Get()
    proto_paths = pi_schema.GetPrototypesRel().GetTargets()
    if not proto_indices or not proto_paths:
        return []

    # ComputeInstanceTransformsAtTime returns transforms in WORLD space
    # when the instancer itself has a world transform.
    # We get instance transforms in instancer-local space and manually
    # combine with the instancer's world transform.
    xforms = pi_schema.ComputeInstanceTransformsAtTime(
        Usd.TimeCode.Default(), Usd.TimeCode.Default()
    )
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

        # Instance world transform = instance_local * instancer_world
        instance_world = Gf.Matrix4d(xforms[i]) * instancer_world

        # Find all meshes under the prototype
        for child in Usd.PrimRange(proto_prim):
            if not child.IsA(UsdGeom.Mesh):
                continue

            # Get child's transform relative to prototype root
            child_world = UsdGeom.XformCache().GetLocalToWorldTransform(child)
            proto_world = UsdGeom.XformCache().GetLocalToWorldTransform(proto_prim)
            child_in_proto = child_world * proto_world.GetInverse()

            # Final world transform: child_in_proto * instance_world
            final_mat = child_in_proto * instance_world

            child_parent = child.GetParent().GetName() if child.GetParent() else ""
            mesh = extract_mesh(child, final_mat, color,
                                name_prefix=f"{team}_Pawn{i}_{child_parent}_")
            if mesh:
                print(f"    [{i}] {child.GetPath().name}: {mesh['_tris']} tris")
                meshes.append(mesh)

    return meshes


def load_chess_set(usd_path):
    stage = Usd.Stage.Open(usd_path)
    if not stage:
        print(f"Failed to open: {usd_path}")
        return [], 1.0

    mpu = UsdGeom.GetStageMetersPerUnit(stage)
    up = UsdGeom.GetStageUpAxis(stage)
    print(f"Stage: {usd_path}")
    print(f"  metersPerUnit={mpu}, upAxis={up}")

    colors = {
        "Black": (0.12, 0.10, 0.08),
        "White": (0.92, 0.89, 0.84),
    }
    board_color = (0.45, 0.35, 0.25)

    all_meshes = []

    # Collect PointInstancer paths so we skip their children
    instancer_paths = set()
    for prim in stage.TraverseAll():
        if prim.IsA(UsdGeom.PointInstancer):
            instancer_paths.add(str(prim.GetPath()))

    for prim in stage.TraverseAll():
        path = str(prim.GetPath())

        # Skip children of instancers (handled by resolve)
        if any(path.startswith(ip + "/") for ip in instancer_paths):
            continue

        # Determine color from path
        if "Black" in path:
            color, team = colors["Black"], "Black"
        elif "White" in path:
            color, team = colors["White"], "White"
        elif "Chessboard" in path:
            color, team = board_color, "Board"
        else:
            color, team = (0.5, 0.5, 0.5), "Other"

        # Handle PointInstancers
        if prim.IsA(UsdGeom.PointInstancer):
            meshes = resolve_point_instancer(prim, color, team)
            all_meshes.extend(meshes)
            continue

        # Handle regular meshes
        if not prim.IsA(UsdGeom.Mesh):
            continue

        world_mat = UsdGeom.XformCache().GetLocalToWorldTransform(prim)
        # Use grandparent name for uniqueness (King/Geom/Render -> King_Render)
        gp = prim.GetParent().GetParent().GetName() if prim.GetParent() and prim.GetParent().GetParent() else prim.GetParent().GetName() if prim.GetParent() else ""
        mesh = extract_mesh(prim, world_mat, color, name_prefix=f"{team}_{gp}_")
        if mesh:
            print(f"  Mesh: {path} ({mesh['_tris']} tris)")
            all_meshes.append(mesh)

    # Clean up internal keys
    for m in all_meshes:
        m.pop("_tris", None)
        m.pop("_verts", None)

    print(f"\nTotal: {len(all_meshes)} meshes")
    return all_meshes, mpu


async def publish_to_nats(meshes, meters_per_unit):
    nc = await nats.connect("nats://localhost:4222")
    print(f"NATS connected. Publishing {len(meshes)} meshes...")

    # First send scene metadata so camera can auto-adjust
    meta = json.dumps({
        "meshes": [],
        "meta": {"metersPerUnit": meters_per_unit}
    })
    await nc.publish("scene.chess.loaded", meta.encode())

    for i, mesh in enumerate(meshes):
        payload = json.dumps({"meshes": [mesh]})
        await nc.publish("scene.chess.loaded", payload.encode())
        kb = len(payload) // 1024
        print(f"  [{i+1}/{len(meshes)}] {mesh['name']} ({kb}KB)")
        await asyncio.sleep(0.05)

    await nc.flush()
    await nc.close()
    print("Done!")


if __name__ == "__main__":
    usd_path = r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set.usda"
    meshes, mpu = load_chess_set(usd_path)
    if meshes:
        asyncio.run(publish_to_nats(meshes, mpu))

