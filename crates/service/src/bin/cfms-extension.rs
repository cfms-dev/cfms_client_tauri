use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Serialize)]
struct FileIndex {
    files: Vec<FileIndexEntry>,
}

#[derive(Serialize)]
struct FileIndexEntry {
    path: String,
    sha256: String,
    size: u64,
}

#[derive(Serialize)]
struct SignatureEnvelope<'a> {
    key_id: &'a str,
    signature: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = env::args().collect::<Vec<_>>();
    match args.get(1).map(String::as_str) {
        Some("public-key") => {
            let signing = signing_key()?;
            println!("{}", hex::encode(signing.verifying_key().to_bytes()));
        }
        Some("pack") if args.len() == 5 => {
            pack(Path::new(&args[2]), Path::new(&args[3]), &args[4])?;
        }
        Some("sign-catalog") if args.len() == 5 => {
            sign_catalog(Path::new(&args[2]), Path::new(&args[3]), &args[4])?;
        }
        _ => {
            eprintln!("Usage:");
            eprintln!("  cfms-extension public-key");
            eprintln!("  cfms-extension pack <source-dir> <output.cfmsext> <key-id>");
            eprintln!("  cfms-extension sign-catalog <catalog.json> <catalog.json.sig> <key-id>");
            std::process::exit(2);
        }
    }
    Ok(())
}

fn pack(source: &Path, output: &Path, key_id: &str) -> Result<(), Box<dyn std::error::Error>> {
    if !source.join("manifest.json").is_file() {
        return Err("source directory must contain manifest.json".into());
    }
    if output.extension().and_then(|value| value.to_str()) != Some("cfmsext") {
        return Err("output file must use the .cfmsext extension".into());
    }

    let mut files = BTreeMap::new();
    collect_files(source, source, &mut files)?;
    files.remove("META-INF/files.json");
    files.remove("META-INF/signature.ed25519");
    let index = FileIndex {
        files: files
            .iter()
            .map(|(path, bytes)| FileIndexEntry {
                path: path.clone(),
                sha256: hex::encode(Sha256::digest(bytes)),
                size: bytes.len() as u64,
            })
            .collect(),
    };
    let index_bytes = serde_json::to_vec(&index)?;
    let signature = signing_key()?.sign(&index_bytes);
    let envelope = serde_json::to_vec(&SignatureEnvelope {
        key_id,
        signature: hex::encode(signature.to_bytes()),
    })?;

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let output_file = fs::File::create(output)?;
    let mut zip = zip::ZipWriter::new(output_file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for (path, bytes) in files {
        zip.start_file(path, options)?;
        zip.write_all(&bytes)?;
    }
    zip.start_file("META-INF/files.json", options)?;
    zip.write_all(&index_bytes)?;
    zip.start_file("META-INF/signature.ed25519", options)?;
    zip.write_all(&envelope)?;
    zip.finish()?;
    println!("Wrote {}", output.display());
    Ok(())
}

fn sign_catalog(
    catalog: &Path,
    output: &Path,
    key_id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let bytes = fs::read(catalog)?;
    let signature = signing_key()?.sign(&bytes);
    let envelope = serde_json::to_vec(&SignatureEnvelope {
        key_id,
        signature: hex::encode(signature.to_bytes()),
    })?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, envelope)?;
    println!("Wrote {}", output.display());
    Ok(())
}

fn signing_key() -> Result<SigningKey, Box<dyn std::error::Error>> {
    let raw = env::var("CFMS_EXTENSION_SIGNING_KEY").map_err(
        |_| "CFMS_EXTENSION_SIGNING_KEY must contain a 32-byte Ed25519 private key in hex",
    )?;
    let bytes = hex::decode(raw.trim())?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Ed25519 private key must be exactly 32 bytes")?;
    Ok(SigningKey::from_bytes(&bytes))
}

fn collect_files(
    root: &Path,
    directory: &Path,
    output: &mut BTreeMap<String, Vec<u8>>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut entries = fs::read_dir(directory)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_symlink() {
            return Err(format!("symbolic link is not allowed: {}", entry.path().display()).into());
        }
        if metadata.is_dir() {
            collect_files(root, &entry.path(), output)?;
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)?
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        validate_source_path(&relative)?;
        output.insert(relative, fs::read(entry.path())?);
    }
    Ok(())
}

fn validate_source_path(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let extension = PathBuf::from(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let allowed = path == "manifest.json"
        || (path.starts_with("pages/") && extension == "json")
        || (path.starts_with("workflows/") && extension == "json")
        || (path.starts_with("i18n/") && extension == "json")
        || (path.starts_with("assets/")
            && matches!(
                extension.as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "gif" | "ico"
            ))
        || path.starts_with("META-INF/");
    if !allowed {
        return Err(format!("forbidden extension source file: {path}").into());
    }
    Ok(())
}
