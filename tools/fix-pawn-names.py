path = r"D:\DarkIron\darkiron\tools\load-chess-usd.py"
c = open(path, "r").read()

# Fix pawn naming: include parent hierarchy for uniqueness
# Current: name_prefix=f"{team}_Pawn{i}_" -> "Black_Pawn0_Render" (duplicate for Top and Body)
# Fixed: include child parent name -> "Black_Pawn0_Geom_Top_Render" vs "Black_Pawn0_Geom_Body_Render"
old = '''            mesh = extract_mesh(child, final_mat, color,
                                name_prefix=f"{team}_Pawn{i}_")'''
new = '''            child_parent = child.GetParent().GetName() if child.GetParent() else ""
            mesh = extract_mesh(child, final_mat, color,
                                name_prefix=f"{team}_Pawn{i}_{child_parent}_")'''
c = c.replace(old, new)

open(path, "w").write(c)
print("Fixed: pawn mesh names now include parent (Geom_Top vs Geom_Body)")

