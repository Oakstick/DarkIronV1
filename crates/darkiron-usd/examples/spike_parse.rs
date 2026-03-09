//! Test: load USDC and extract all meshes
use darkiron_usd::load_usdc;
use std::path::Path;

fn main() {
    tracing_subscriber::fmt().init();
    let path = Path::new(r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set_flat.usdc");
    match load_usdc(path) {
        Ok(meshes) => {
            println!("\nExtracted {} meshes:", meshes.len());
            for m in &meshes {
                let verts = m.vertices.len() / 9;
                let tris = m.indices.len() / 3;
                println!("  {} — {} verts, {} tris", m.name, verts, tris);
            }
        }
        Err(e) => eprintln!("Error: {e:#}"),
    }
}
