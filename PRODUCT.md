# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are authorized staff who handle confidential documents in environments governed by their organization and its CFMS server. They need to locate, access, transfer, and manage permitted files without losing sight of the security implications of working with confidential material.

System administrators are a secondary audience. Subject to server-side permissions, they manage accounts, groups, access grants and rules, audit information, and service state.

## Product Purpose

The client provides authorized access to a Confidential File Management System server. It enables users to securely connect, authenticate, browse and search confidential documents, manage permitted file operations, and monitor reliable transfers. Success means users can complete those workflows clearly and reliably while respecting server-defined access controls and the realities of endpoint security.

## Positioning

This is a confidential file management system, not a general-purpose cloud drive. Its defining mechanism is controlled distribution and management of confidential documents through permission-governed server access, secure transfers, and cryptographic operations performed on the client device.

## Operating Context

Users connect to a deployed CFMS server they are authorized to access, using a server address supplied by an administrator. They may need trusted CA certificates and two-factor authentication. Their visible documents and available actions depend on server-side permissions.

Core workflows include browsing, searching, sorting, favoriting, uploading, downloading, resolving upload conflicts, inspecting transfer tasks, working with revisions and the recycle bin, and configuring account, connection, privacy, application-lock, storage, language, and update settings. Administrators may also manage users, groups, permissions, access rules, and audit information.

Authorized files are decrypted locally. Users therefore work in trusted environments and remain responsible for endpoint security, screen privacy, and compliance with their organization's handling requirements.

## Capabilities and Constraints

- Secure WSS server connections with bundled trusted CA certificates, server history, account authentication, two-factor authentication, and password-management flows.
- Permission-aware file and directory operations, including search, sorting, favorites, drag-and-drop uploads, revisions, access grants and rules, recycle-bin operations, and contextual actions.
- Reliable chunked transfers with persistent task state, conflict handling, pause and resume, retry, batching, verification, and local decryption.
- Permission-gated administration for accounts, groups, service state, and audit information.
- Encrypted local preferences, application lock using supported PIN, biometric, or passkey mechanisms, screen protection, emergency server lockdown behavior, and signed application updates.
- English and Simplified Chinese localization.
- A shared cross-platform interface for desktop and Android, with platform-specific interaction optimization where needed, including enlarged touch targets on touch devices. Platform support does not imply a different visual language for each operating system.
- Sensitive networking and file operations cross the Tauri IPC boundary and are handled by the Rust service layer rather than directly by the frontend.
- Server addresses, permissions, document scope, administrative capabilities, and lockdown state remain controlled by the connected CFMS server.
- Installable signed extension packages are desktop-only at present; built-in optional modules may remain available on mobile.

## Brand Commitments

Preserve the product name **CFMS** and the expanded name **Confidential File Management System** where identification or technical clarity requires them. Do not deliberately repeat or emphasize the name at every turn; ordinary interface copy should naturally use terms such as “this application” or “the client” when the product name adds no value.

Preserve the established English and Simplified Chinese terminology and the application's direct, security-conscious voice. Security disclosures and warnings must remain explicit without becoming promotional claims.

## Evidence on Hand

- `README.md` documents the product purpose, supported workflows, deployment assumptions, architecture, security model, and operational guidance.
- `src/lib/i18n/messages/en.ts` and `src/lib/i18n/messages/zh-CN.ts` contain the real bilingual product copy and terminology.
- `src/routes/` and `src/lib/components/` contain implemented connection, authentication, file-management, transfer, administration, privacy, settings, and recovery workflows.
- `src-tauri/` and `crates/` contain the implemented native shell, service, transport, transfer, and cryptographic boundaries.
- `static/` and `src-tauri/icons/` contain the current application icons, fonts, and bundled visual assets.
- No testimonials, customer logos, deployment counts, performance benchmarks, or other marketing proof are established in the repository; future work must not fabricate them.

## Product Principles

1. Treat confidentiality and authorization as the product's operating foundation, not optional decoration.
2. Make permission-governed document work understandable and dependable for authorized users.
3. Keep security consequences explicit, especially where local decryption or endpoint configuration affects risk.
4. Preserve a coherent cross-platform experience while adapting interaction details to the input method and device.
5. Use the CFMS name purposefully and let clear task language carry routine interactions.

## Accessibility & Inclusion

Maintain English and Simplified Chinese support, keyboard-operable desktop workflows, responsive layouts, reduced-motion handling, and touch targets suitable for mobile interaction. Preserve programmatic focus management and meaningful accessible labels where the current implementation provides them. Future work should continue to support users working with large directories and permission-constrained states without relying on color or pointer input alone.
