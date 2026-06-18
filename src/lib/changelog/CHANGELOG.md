# CFMS Client Changelog

This file is the product changelog shown inside the app. Keep entries newest first.

---

## v0.28.0
**Released on:** 2026-06-18

**Title:** Download Logic Adaptation & Batch Download Optimization

### Added
- Add filename formatting for download tasks and implement path formatting utility
- Migrate download notifications into one with translations for success and failure events
- Add ensure_download_subdirectory command and integrate into file handling
- Implement VirtualList component for optimized rendering in various dialogs and pages

### Fixed
- Fix file table virtualizer update loop
- Fix transfer handling for empty files

### Maintenance
- Update dependencies in Cargo.lock and package.json

### Improved
- Use tanstack virtual for file list

--- 

## v0.27.3
**Released on:** 2026-06-17

**Title:** Implement file sorting with web worker support for improved p...

### Fixed
- Update document size handling to support null values and improve formatting
- Rewrap DEK and upload it to the server in advance
- Add border to parent navigation button for better visibility

### Added
- Implement file sorting with web worker support for improved performance

--- 

## v0.27.2
**Released on:** 2026-06-16

**Title:** Enhance app update check with fallback for release notes

### Maintenance
- Update CI and release workflows for changelog and release notes generation
- Add changelog generation and validation workflow

### Added
- Enhance app update check with fallback for release notes

--- 

## v0.27.1
**Released on:** 2026-06-16

**Title:** Bugfix

### Fixed
- Stopped pushing notifications to the system during updates on desktop to avoid overwhelming the system with too many notifications.

### Improved
- Optimized the display effects of various UI elements in the management interface.

--- 

## v0.27.0
**Released on:** 2026-06-16

**Title:** Protocol Version 14

This release introduces support for protocol version 14, allowing users to specify permissions for specific users themselves, rather than forcing them to inherit permissions from user groups.

### Added
- Added a new feature that allows users to set and view document metadata, including the creator, modifier, and document tags.
- Added a new user-defined permission settings interface.

--- 

## v0.26.4
**Released on:** 2026-06-15

**Title:** Bug fixes

This version fixed several issues:

### Fixed
- Fixed an issue where user preferences could not be saved correctly when the user had no configuration file locally and the DEK on the server could not be decrypted properly.
- Fixed an issue where persistent notifications in the notification bar behaved incorrectly during update downloads.

### Improved
- The behavior of the updater when using the proxy function has been adjusted so that it follows the system proxy settings by default, and the adjustment only occurs when the user specifies a custom proxy in the settings.

--- 

## v0.26.3
**Released on:** 2026-06-15

**Title:** Bugfix

### Fixed
- Fixed an issue where the Data Encryption Key (DEK) was not re-encrypted when a user changed their password.

--- 

## v0.26.1
**Released on:** 2026-06-15

**Title:** Bugfix

### Fixed
- Fixed an issue that caused the app to fail to compile for Android.

--- 

## v0.26.0
**Released on:** 2026-06-15

**Title:** Biometric Verification

### Added
- Mobile device users now can use biometric verification to unlock app locks.

### Fixed
- Changed app name on Android to `CFMS Client`.

### Improved
- Replaced the old self-implementation with a more mature solution.

--- 

## v0.25.1
**Released on:** 2026-06-14

**Title:** Bugfix

### Improved
- The new update notification interface no longer requires user login.

### Fixed
- Replaced the incorrectly generated app icon.

---

## v0.23.0
**Released on:** 2026-06-14

**Title:** Update notices and changelog

### Added
- Added an in-app changelog surface with structured release entries.
- Added update availability indicators on the About entry.
- Added a one-time full-screen update prompt for signed-in sessions.

### Improved
- Release notes are rendered as readable Markdown blocks instead of plain text.
- Changelog data now lives under `src/lib/changelog`, close to the parser and UI that consume it.
