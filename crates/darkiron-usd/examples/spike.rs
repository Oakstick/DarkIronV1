use openusd::usda;
use std::path::Path;

fn main() {
    let path = Path::new(r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set_flat.usda");
    println!("Loading: {}", path.display());

    match usda::read_file(path) {
        Ok(layer) => {
            println!("Layer loaded OK");
            println!("Prims: {}", layer.prims.len());
            for (path, prim) in &layer.prims {
                let type_name = prim.prim_type.as_deref().unwrap_or("(none)");
                if type_name == "Mesh" || path.contains("Render") {
                    println!("  MESH: {} (type={})", path, type_name);
                    for (attr_name, _attr) in &prim.attributes {
                        println!("    attr: {}", attr_name);
                    }
                }
            }
        }
        Err(e) => {
            println!("Failed to load: {:?}", e);
        }
    }
}
