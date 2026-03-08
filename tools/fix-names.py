path = r"D:\DarkIron\darkiron\tools\load-chess-usd.py"
c = open(path, "r").read()

old = """        world_mat = UsdGeom.XformCache().GetLocalToWorldTransform(prim)
        mesh = extract_mesh(prim, world_mat, color, name_prefix=f"{team}_")"""

new = """        world_mat = UsdGeom.XformCache().GetLocalToWorldTransform(prim)
        # Use grandparent name for uniqueness (King/Geom/Render -> King_Render)
        gp = prim.GetParent().GetParent().GetName() if prim.GetParent() and prim.GetParent().GetParent() else prim.GetParent().GetName() if prim.GetParent() else ""
        mesh = extract_mesh(prim, world_mat, color, name_prefix=f"{team}_{gp}_")"""

c = c.replace(old, new)
open(path, "w").write(c)
print("Fixed: mesh names now use grandparent for uniqueness (King_Render, Queen_Render, etc.)")

