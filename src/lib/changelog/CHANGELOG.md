# CFMS Client Changelog

This file is the product changelog shown inside the app. Keep entries newest first.

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
