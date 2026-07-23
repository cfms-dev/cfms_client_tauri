# CFMS extension packages

CFMS Client v1 extensions are signed, declarative data packages. They cannot contain JavaScript,
WebAssembly, native libraries, scripts, symbolic links, or arbitrary files.

The release build receives trusted public keys at compile time:

```powershell
$env:CFMS_EXTENSION_TRUSTED_KEYS = "official-2026:<64 hex characters>"
cargo tauri build --ci
```

The corresponding private key is never stored in this repository. Supply its 32-byte Ed25519 seed
through `CFMS_EXTENSION_SIGNING_KEY` only in the protected publishing environment:

```powershell
$env:CFMS_EXTENSION_SIGNING_KEY = "<64 hex characters>"
cargo run -p cfms-service --bin cfms-extension -- public-key
cargo run -p cfms-service --bin cfms-extension -- pack extensions/examples/file-stats dist/file-stats.cfmsext official-2026
cargo run -p cfms-service --bin cfms-extension -- sign-catalog catalog.json catalog.json.sig official-2026
```

The exact bytes of `catalog.json` must be published with the generated `catalog.json.sig`.
Changing whitespace after signing invalidates the signature. Production clients do not have an
unsigned-extension bypass.
