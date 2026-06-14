# CFMS Client Changelog

This file is the product changelog shown inside the app. Keep entries newest first.

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
