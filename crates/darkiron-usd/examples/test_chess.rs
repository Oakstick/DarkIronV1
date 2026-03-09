use std::path::Path;

fn main() {
    tracing_subscriber::fmt().init();
    let path = Path::new(r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set_flat.usdc");
    println!("Loading: {}", path.display());

    match darkiron_usd::load_stage(path) {
        Ok(meshes) => {
            println!("\n=== Results ===");
            println!("Total meshes: {}", meshes.len());
            let mut total_tris = 0;
            for mesh in &meshes {
                let tris = mesh.indices.len() / 3;
                total_tris += tris;
                println!("  {} — {} verts, {} tris", mesh.name, mesh.vertices.len() / 9, tris);
            }
            println!("\nTotal triangles: {}", total_tris);
        }
        Err(e) => {
            eprintln!("Error: {:?}", e);
        }
    }
}

