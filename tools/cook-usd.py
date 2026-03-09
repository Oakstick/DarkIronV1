"""
DarkIron USD Asset Cooker
Flattens USD, resolves PointInstancers into individual mesh prims,
and exports a fully-expanded USDC binary ready for Rust runtime.
"""
import sys
from pxr import Usd, UsdGeom, Gf, Vt, Sdf

def cook_usd(src_path, dst_path):
    """Cook a USD file into a fully-expanded USDC."""
    stage = Usd.Stage.Open(src_path)
    print(f"Opened: {src_path}")

    # Create output stage
    out = Usd.Stage.CreateNew(dst_path)
    out.SetMetadata("metersPerUnit", UsdGeom.GetStageMetersPerUnit(stage))
    out.SetMetadata("upAxis", UsdGeom.GetStageUpAxis(stage))

    mesh_count = 0

    # First: copy all regular meshes (not inside PointInstancer prototypes)
    instancer_paths = set()
    for prim in stage.TraverseAll():
        if prim.IsA(UsdGeom.PointInstancer):
            instancer_paths.add(str(prim.GetPath()))

    for prim in stage.TraverseAll():
        path = str(prim.GetPath())
        # Skip prims inside instancer prototypes
        if any(path.startswith(ip + "/") for ip in instancer_paths):
            continue

        if prim.IsA(UsdGeom.PointInstancer):
            # Expand this instancer
            pi = UsdGeom.PointInstancer(prim)
            proto_indices = pi.GetProtoIndicesAttr().Get()
            proto_paths = pi.GetPrototypesRel().GetTargets()
            xforms = pi.ComputeInstanceTransformsAtTime(Usd.TimeCode.Default(), Usd.TimeCode.Default())
            instancer_world = UsdGeom.XformCache().GetLocalToWorldTransform(prim)

            if not proto_indices or not proto_paths or not xforms:
                continue

            # Determine team from path
            team = "Black" if "Black" in path else "White" if "White" in path else "Other"
            print(f"  PointInstancer: {path} ({len(xforms)} instances)")

            for i, pi_idx in enumerate(proto_indices):
                if pi_idx >= len(proto_paths) or i >= len(xforms):
                    continue
                proto_prim = stage.GetPrimAtPath(proto_paths[pi_idx])
                if not proto_prim:
                    continue

                instance_world = Gf.Matrix4d(xforms[i]) * instancer_world

                for child in Usd.PrimRange(proto_prim):
                    if not child.IsA(UsdGeom.Mesh):
                        continue

                    mesh = UsdGeom.Mesh(child)
                    child_world = UsdGeom.XformCache().GetLocalToWorldTransform(child)
                    proto_world = UsdGeom.XformCache().GetLocalToWorldTransform(proto_prim)
                    child_in_proto = child_world * proto_world.GetInverse()
                    final_mat = child_in_proto * instance_world

                    # Read geometry
                    points = mesh.GetPointsAttr().Get()
                    fvc = mesh.GetFaceVertexCountsAttr().Get()
                    fvi = mesh.GetFaceVertexIndicesAttr().Get()
                    normals = mesh.GetNormalsAttr().Get()

                    if not points or not fvc or not fvi:
                        continue

                    # Transform points
                    xf_points = Vt.Vec3fArray([
                        Gf.Vec3f(final_mat.Transform(Gf.Vec3d(*p)))
                        for p in points
                    ])

                    # Transform normals
                    normal_mat = final_mat.GetInverse().GetTranspose()
                    xf_normals = None
                    if normals:
                        xf_normals = Vt.Vec3fArray([
                            Gf.Vec3f(normal_mat.TransformDir(Gf.Vec3d(*n)).GetNormalized())
                            for n in normals
                        ])

                    child_parent = child.GetParent().GetName() if child.GetParent() else ""
                    out_name = f"{team}_Pawn{i}_{child_parent}_{child.GetName()}"
                    out_path = f"/Meshes/{out_name}"

                    out_mesh = UsdGeom.Mesh.Define(out, out_path)
                    out_mesh.GetPointsAttr().Set(xf_points)
                    out_mesh.GetFaceVertexCountsAttr().Set(fvc)
                    out_mesh.GetFaceVertexIndicesAttr().Set(fvi)
                    if xf_normals:
                        out_mesh.GetNormalsAttr().Set(xf_normals)
                        out_mesh.SetNormalsInterpolation(mesh.GetNormalsInterpolation())

                    mesh_count += 1
                    print(f"    [{i}] {out_name}")
            continue

        if not prim.IsA(UsdGeom.Mesh):
            continue

        # Regular mesh — copy with world transform baked
        mesh = UsdGeom.Mesh(prim)
        points = mesh.GetPointsAttr().Get()
        fvc = mesh.GetFaceVertexCountsAttr().Get()
        fvi = mesh.GetFaceVertexIndicesAttr().Get()
        normals = mesh.GetNormalsAttr().Get()

        if not points or not fvc or not fvi:
            continue

        world_mat = UsdGeom.XformCache().GetLocalToWorldTransform(prim)

        xf_points = Vt.Vec3fArray([
            Gf.Vec3f(world_mat.Transform(Gf.Vec3d(*p))) for p in points
        ])

        normal_mat = world_mat.GetInverse().GetTranspose()
        xf_normals = None
        if normals:
            xf_normals = Vt.Vec3fArray([
                Gf.Vec3f(normal_mat.TransformDir(Gf.Vec3d(*n)).GetNormalized())
                for n in normals
            ])

        # Build a readable name
        gp = prim.GetParent().GetParent().GetName() if prim.GetParent() and prim.GetParent().GetParent() else ""
        team = "Black" if "Black" in path else "White" if "White" in path else "Board" if "Chessboard" in path else "Other"
        out_name = f"{team}_{gp}_{prim.GetName()}"
        out_path = f"/Meshes/{out_name}"

        out_mesh = UsdGeom.Mesh.Define(out, out_path)
        out_mesh.GetPointsAttr().Set(xf_points)
        out_mesh.GetFaceVertexCountsAttr().Set(fvc)
        out_mesh.GetFaceVertexIndicesAttr().Set(fvi)
        if xf_normals:
            out_mesh.GetNormalsAttr().Set(xf_normals)
            out_mesh.SetNormalsInterpolation(mesh.GetNormalsInterpolation())

        mesh_count += 1
        print(f"  Mesh: {path} -> {out_name}")

    out.Save()
    import os
    size = os.path.getsize(dst_path)
    print(f"\nCooked {mesh_count} meshes to {dst_path} ({size // 1024}KB)")

if __name__ == "__main__":
    src = r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set.usda"
    dst = r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set_cooked.usdc"
    cook_usd(src, dst)

