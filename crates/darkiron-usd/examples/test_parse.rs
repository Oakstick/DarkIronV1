use std::path::Path;

fn main() {
    tracing_subscriber::fmt().with_env_filter("debug").init();
    let path = Path::new(r"D:\DarkIron\darkiron\assets\OpenChessSet\chess_set_flat.usda");
    let meshes = darkiron_usd::extract_meshes(path).expect("Failed");
    println!("\nTotal: {} meshes", meshes.len());
    for (i, m) in meshes.iter().enumerate() {
        println!("  [{:2}] {} ({} tris)", i + 1, m.name, m.indices.len() / 3);
    }
}
