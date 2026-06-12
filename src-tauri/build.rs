use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    generate_bundled_ca_manifest();
    tauri_build::build()
}

fn generate_bundled_ca_manifest() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let ca_dir = manifest_dir.join("ca");
    println!("cargo:rerun-if-changed={}", ca_dir.display());

    let mut entries = Vec::new();
    if let Ok(read_dir) = fs::read_dir(&ca_dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if path.is_file() && is_openssl_hash_filename(name) {
                println!("cargo:rerun-if-changed={}", path.display());
                entries.push((name.to_string(), path));
            }
        }
    }

    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let generated_path = out_dir.join("bundled_ca.rs");
    let mut source = String::from("const BUNDLED_CA_FILES: &[(&str, &[u8])] = &[\n");
    for (name, path) in entries {
        source.push_str(&format!(
            "    ({:?}, include_bytes!({:?})),\n",
            name,
            path_to_include_literal(&path)
        ));
    }
    source.push_str("];\n");

    fs::write(generated_path, source).expect("write bundled CA manifest");
}

fn is_openssl_hash_filename(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() >= 10
        && bytes[..8]
            .iter()
            .all(|&b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        && bytes[8] == b'.'
        && bytes[9..].iter().all(u8::is_ascii_digit)
}

fn path_to_include_literal(path: &Path) -> String {
    path.display().to_string()
}
