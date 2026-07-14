# CFMS Client

[![CI](https://github.com/cfms-dev/cfms_client_tauri/actions/workflows/ci.yml/badge.svg)](https://github.com/cfms-dev/cfms_client_tauri/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cfms-dev/cfms_client_tauri?display_name=tag)](https://github.com/cfms-dev/cfms_client_tauri/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**CFMS Client** is the cross-platform client for the [Confidential File Management System (CFMS)](https://github.com/cfms-dev). It securely connects to CFMS servers, provides controlled access to confidential documents, and manages file transfers. The application targets a native desktop experience and also supports Android.

> [!IMPORTANT]
> This client is intended only for deployed CFMS servers that you are authorized to access. It is not a general-purpose cloud-drive or file-server client.

## Features

- **Secure connection and sign-in** — WSS connections, trusted CA certificates, recent-server history, account sign-in, two-factor authentication, password changes, and password-recovery guidance.
- **File workspace** — directory browsing, search and sorting, favorites, breadcrumbs, item details, recycle bin, drag-and-drop uploads, and context-menu actions.
- **Reliable transfers** — upload-conflict handling, chunked transfers, a persistent download queue, pause/resume, retries, and batch controls.
- **Access and administration** — document access grants and rules, user and group management, audit entry points, and service status, subject to server-side permissions.
- **Privacy and security controls** — encrypted local preferences, app lock (PIN, biometrics, or passkeys when supported by the platform), screen protection, emergency lockdown state, and in-app update checks.
- **Accessible, responsive UI** — English and Simplified Chinese, Material Design 3 styling, keyboard shortcuts, virtualized lists, and progressive loading for large directories.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 24 (the version used by CI; local environments should meet the dependency runtime requirements at minimum)
- [pnpm](https://pnpm.io/) 11
- [Rust stable](https://www.rust-lang.org/tools/install), including `rustup`
- Platform-specific Tauri system dependencies. Android development also requires Android Studio, the Android SDK, and the NDK.

On Windows, you will normally also need the Visual Studio **Desktop development with C++** workload and the WebView2 Runtime. See [BUILD.md](BUILD.md) for Linux dependencies and the complete signing/release setup.

### Install dependencies

```powershell
git clone --recurse-submodules https://github.com/cfms-dev/cfms_client_tauri.git
Set-Location cfms_client_tauri
pnpm install --frozen-lockfile
```

The CA certificate store is a Git submodule. If you already cloned the repository without submodules, initialize it with:

```powershell
git submodule update --init --recursive
```

### Develop, check, and test

```powershell
# Start the desktop app in development mode (Tauri starts the frontend dev service)
pnpm tauri dev

# Run the frontend type check
pnpm check

# Run frontend unit tests
pnpm test

# Build frontend static assets
pnpm build

# Build an installer/package for the current platform
pnpm tauri build
```

Use **pnpm** for all JavaScript package-management and script commands. Do not use `npm`; keeping pnpm and the lockfile in sync is required for reproducible local and CI builds.

### Mobile development

```powershell
# Android: generate the native project once the Android toolchain is configured
pnpm tauri android init

# Start a development build on a connected device or emulator
pnpm tauri android dev

# Produce APK and AAB artifacts
pnpm tauri android build
```

iOS project generation and builds require macOS:

```bash
pnpm tauri ios init
pnpm tauri ios dev
pnpm tauri ios build
```

## Using the client

1. Launch the client, then read and accept the security disclaimer.
2. Enter the CFMS server address provided by your administrator. When the port is omitted, the client uses `443`. The address is validated and TLS is checked against the CA store bundled with the application.
3. Sign in with an authorized account. Complete two-factor verification if the server requires it.
4. Use the **Files** workspace to browse, search, upload, and download documents; use **Tasks** to inspect and control transfers.
5. Configure connection, language, privacy, app lock, download storage, updates, and two-factor settings in **Settings** as needed.

Server addresses, account permissions, document scope, and administrative features are controlled by the CFMS server. Contact the server administrator if you have lost your account password.

## Security notes

CFMS is intended for confidential information. Authorized files are decrypted locally on the client device, so endpoint security is essential:

- Connect only from trusted, hardened devices and environments. Avoid using the application in public places or where others can view your screen.
- Do not disable TLS certificate validation unless you fully understand the risk and are performing controlled troubleshooting.
- Enable app lock and a system screen lock, install client updates promptly, and follow your organization's rules for handling and distributing confidential data.
- Never commit private keys, signing certificates, credentials, or build artifacts containing sensitive files.

The complete disclaimer is shown when the application is first used.

## Project layout

```text
src/                    SvelteKit pages, components, stores, and Tauri API wrappers
src-tauri/              Tauri entry point, IPC commands, platform config, and bundle resources
crates/
  core/                 Shared types, constants, and errors
  crypto/               Key derivation, data encryption, and key wrapping
  transport/            TLS, WebSocket streams, and proxy connections
  transfer/             Chunked upload, download, verification, and decryption
  service/              Connection, RPC, preferences, tasks, and download-queue services
static/                 Icons, fonts, and frontend static assets
scripts/                Font embedding, version synchronization, and release-note tools
.github/workflows/      CI, packaging, and release automation
```

The frontend does not perform sensitive file I/O or network operations directly. Those operations cross the Tauri IPC boundary and are handled by the Rust service layer.

## Maintenance commands

```powershell
# Show, set, or increment the unified application version
pnpm app:version:show
pnpm app:version set 0.32.3
pnpm app:version bump patch
pnpm app:version:check

# Maintain the in-app changelog and export release notes
pnpm app:changelog -- --version 0.32.3 --write
pnpm app:release-notes

# Embed font assets into the application resources
pnpm assets:fonts
```

The version utility synchronizes `package.json`, the Cargo workspace, the Tauri configuration, and generated mobile version metadata where present. For the release process, platform signing secrets, and artifact details, see [BUILD.md](BUILD.md).

## Contributing

Issues and pull requests are welcome. Before submitting a change, run at least:

```powershell
pnpm check
pnpm test
pnpm app:version:check
```

Keep changes focused, add appropriate tests, and do not commit build output, private certificates, keys, or real confidential documents.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
