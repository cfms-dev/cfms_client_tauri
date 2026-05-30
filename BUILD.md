# CFMS Client — Build & Release Guide

## CI/CD Pipeline Overview

The project uses GitHub Actions for continuous integration and delivery. Four
workflow files are defined in `.github/workflows/`:

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | Push / PR to `main` | Rust tests, clippy, format check, frontend type-check |
| `build-windows.yml` | Push / PR to `main`, manual | Windows MSI + NSIS build with EV code signing |
| `build-macos.yml` | Push / PR to `main`, manual | macOS universal DMG build + Apple notarization |
| `build-linux.yml` | Push / PR to `main`, manual | Linux AppImage + deb + rpm build |
| `release.yml` | Git tag `v*` or manual | Full signed release + GitHub Release creation |

## Required GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions**:

### All Platforms

| Secret | Description |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri updater private key (generated with `cargo tauri signer generate`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the Tauri updater private key |

### Windows (EV Code Signing)

| Secret | Description |
|---|---|
| `WINDOWS_CERTIFICATE` | Base64-encoded PFX/P12 Extended Validation code signing certificate |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password for the PFX certificate |

**Encoding the certificate:**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("path\to\certificate.pfx")) | Set-Content -NoNewline cert.txt
```
Copy the contents of `cert.txt` into the secret.

> **Alternative:** For Azure Key Vault / Azure Code Signing (ACS), use the
> [`azure/azure-code-signing`](https://github.com/azure/azure-code-signing)
> action instead of `signtool`.  Replace the EV Code Sign step in
> `build-windows.yml` and `release.yml`.

### macOS (Signing & Notarization)

| Secret | Description |
|---|---|
| `APPLE_SIGNING_IDENTITY` | Full signing identity e.g. `"Developer ID Application: Your Name (TEAMID)"` |
| `APPLE_CERTIFICATE` | Base64-encoded `.p12` Developer ID Application certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12` certificate |
| `APPLE_TEAM_ID` | Apple Developer Team ID (10 characters) |
| `APPLE_ID` | Apple ID email address (for notarization) |
| `APPLE_PASSWORD` | App-specific password generated at [appleid.apple.com](https://appleid.apple.com) |

**Encoding the certificate:**
```bash
base64 -i "Developer ID Application.p12" -o cert.txt
```

**Generating an app-specific password:**
1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign In → App-Specific Passwords → Generate
3. Use the generated password for `APPLE_PASSWORD`

### Linux

No additional secrets are required beyond the Tauri updater keys.

## Release Process

### 1. Prepare the version

Update the version in `tauri.conf.json`:

```json
{
  "version": "0.16.0"
}
```

### 2. Create and push a tag

```bash
git tag -a v0.16.0 -m "Release v0.16.0"
git push origin v0.16.0
```

### 3. Monitor the release

The `release.yml` workflow builds, signs (Windows EV + macOS notarization),
and publishes all artifacts as a GitHub Release.

### 4. Manual release

To trigger a release manually:
1. Go to **Actions → Release → Run workflow**
2. Enter the version tag (e.g. `v0.16.0`)
3. Click **Run workflow**

## Local Development Builds

### Desktop

```bash
# Prerequisites: Node.js 22+, Rust stable
npm ci
cargo tauri dev        # Development mode with hot-reload
cargo tauri build      # Production build
```

### Android

```bash
# Prerequisites: Android Studio, Android SDK 36, NDK
cargo tauri android init    # Generate Android project (if not already generated)
cargo tauri android dev     # Development build on connected device
cargo tauri android build   # Release APK/AAB
```

### iOS

```bash
# Prerequisites: macOS, Xcode 16+
# Generate the iOS project first:
cargo tauri ios init
# Then open the Xcode project:
cargo tauri ios dev
# Or build for distribution:
cargo tauri ios build
```

> **Note:** iOS project generation (`cargo tauri ios init`) requires macOS.
> The `gen/ios/` directory contains pre-configured `Info.plist` and entitlements
> files that are merged into the generated project.

## Code Signing — Quick Reference

| Platform | Tool | Certificate Type | Validation |
|---|---|---|---|
| Windows | `signtool` | EV Code Signing (PFX/P12) | Timestamped SHA-256 |
| macOS | `codesign` + `notarytool` | Developer ID Application | Apple Notary Service |
| Linux | None required | — | Tauri updater key for updates |

## Security Notes

- **Never commit signing certificates or private keys** to the repository.
- All signing secrets are stored in GitHub Actions encrypted secrets.
- The Rust codebase enforces `#![forbid(unsafe_code)]` in 4 of 5 crates
  (only `cfms-transfer` allows it for memory-mapped I/O).
- TLS certificates are pinned via the `ca_dir` configuration — the client
  does not trust the system CA store by default.
