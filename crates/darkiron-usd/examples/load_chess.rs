use std::path::Path;

fn main() {
    tracing_subscriber::fmt::init();

    let path = Path::new(r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set_cooked.usdc");
    println!("Loading: {}", path.display());

    match darkiron_usd::extract_meshes(path) {
        Ok(meshes) => {
            println!("\n=== Results ===");
            for m in &meshes {
                let verts = m.vertices.len() / 9;
                let tris = m.indices.len() / 3;
                println!("  {} - {} verts, {} tris", m.name, verts, tris);
            }
            println!("\nTotal: {} meshes", meshes.len());

            let total_tris: usize = meshes.iter().map(|m| m.indices.len() / 3).sum();
            let total_verts: usize = meshes.iter().map(|m| m.vertices.len() / 9).sum();
            println!("Grand total: {} vertices, {} triangles", total_verts, total_tris);
        }
        Err(e) => {
            eprintln!("Error: {e:?}");
        }
    }
}

