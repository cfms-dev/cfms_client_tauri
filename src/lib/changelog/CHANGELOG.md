# CFMS Client Changelog

This file is the product changelog shown inside the app. Keep entries newest first.

---

## v0.38.1
**Released on:** 2026-07-24

**Title:** Bugfix

### Fixed
- Update navigation to about page as a public utility visit

--- 

## v0.38.0
**Released on:** 2026-07-24

**Title:** Protocol Version 17

### Fixed
- Optionally clear 2fa on password reset
- Give security tools dedicated views
- Unify account and two-factor management
- Surface protocol 17 throttle metadata

### Maintenance
- Gate unfinished user surfaces
- Add signing tools and sample package

### Added
- Add security management controls
- Adapt security APIs for version 17
- Add declarative runtime and management UI
- Add signed package service and host API

--- 

## v0.37.0
**Released on:** 2026-07-20

**Title:** Password Modification

This version reintroduces the in-app entry point for changing the password and includes several behavioral optimizations.

### Added
- Update password change conditions to include user login and permissions
- Update password and two-factor authentication sections with improved descriptions and styling
- Enhance recent server address menu with improved styling and functionality
- Add account entry to settings and update visibility tests
- Refactor account settings and remove change password page
- Add change password functionality and update related UI components
- Add remaining character count for lockdown reason input
- Implement LockdownControl component with confirmation and reason input

### Fixed
- Fix loading indicator styling for dialog action button
- Enhance lockdown banner styling and animation effects

--- 

## v0.36.0
**Released on:** 2026-07-17

**Title:** Protocol Version 16

### Fixed
- Update account deactivation reason message for clarity
- Normalize managed user account status
- Avoid duplicate mobile safe-area offset

### Added
- Surface account and lockdown reasons
- Adapt client to protocol 16

### Maintenance
- Update dependencies and refactor crypto module for improved randomness handling
- Update dependencies to latest versions

--- 

## v0.35.0
**Released on:** 2026-07-15

**Title:** Custom Appearances and Enhanced File Management Operations

### Improved
- Optimize item drag hit testing
- Remove unused translations and clean up message files
- Remove onSuccess callbacks from auto-save options

### Fixed
- Correct item drag interaction states
- Add new color variables for explorer elements and update styles
- Improve color scheme hints and user/global scope descriptions in English and Chinese translations
- Enhance color scheme preview with system theme visuals
- Restructure header layout and improve responsiveness

### Added
- Support moving items by drag and drop
- Add unused translation checker and pre-commit hook for warnings
- Add appearance settings for color scheme and motion preferences

--- 

## v0.34.1
**Released on:** 2026-07-14

**Title:** Improvements on UI Details

### Improved
- Preserve directory navigation across routes
- Expand core philosophy and dev guidelines in AGENTS.md

### Fixed
- Expand address bar for long paths
- Remove underline from text decoration in login page styles
- Simplify forgot password hover state
- Normalize access time to UTC
- Show request timestamps in UTC

### Added
- Add reusable AuthServerContext component and integrate into login page
- Refine connection and login headers

--- 

## v0.34.0
**Released on:** 2026-07-14

**Title:** Further Handling of Common Error Messages

### Added
- Enhance account disabled message for clarity in English and Chinese
- Hide progress ring track during connection submission
- Adjust the ratio of the left and right sections of the login page to the golden ratio
- Add account disabled notice component and enhance login error handling
- Implement access denied handling with user-friendly dialogs and notices

--- 

## v0.33.0
**Released on:** 2026-07-14

**Title:** Optimizations for Mobile Application Updates

### Maintenance
- Update static font assets

### Fixed
- Revert unexpected UI changes to the original design

### Added
- Enhance release workflow with architecture-specific APKs and validation script
- Implement platform-specific directory picker functionality

--- 

## v0.32.2
**Released on:** 2026-07-14

**Title:** Implement connection cancellation feature and UI updates

### Fixed
- Update Breadcrumb component styles for better layout and accessibility
- Improve ExplorerStatusBar styles and structure
- Refine busy button transition
- Allow default WSS port
- Gate connect animation by WebView support
- Validate server addresses rigorously

### Added
- Implement connection cancellation feature and UI updates
- Enhance connect button with busy state animations and styles

--- 

## v0.32.1
**Released on:** 2026-07-13

**Title:** Bugfix

### Added
- Adjust the style of the connect button and add a vibrant transform animation
- Implement MdOutlinedField component for consistent input styling

### Fixed
- Unify PIN screen typography
- Restore full-screen PIN setup
- Scope screenshot protection per user
- Improve authentication fields and guarded actions
- Respect system chrome and table width
- Add tone prop to ProgressRing and update usage in login page

### Improved
- Implement progressive directory loading and sorting
- Improve navigation drawer touch targets

--- 

## v0.32.0
**Released on:** 2026-07-13

**Title:** Re-design Application UI

### Improved
- Unify workspace and authentication palette
- Standardize compact action buttons
- Unify dialogs and interactions

### Added
- Refine workspace navigation and file details
- Add incremental upload conflict resolution
- Introduce desktop workspace

### Fixed
- Polish lockdown and focus feedback

### Maintenance
- Pin pnpm for CI workflows
- Update dependencies

--- 

## v0.31.0
**Released on:** 2026-07-13

**Title:** Context Menu for Empty Spaces in File Explorer

### Added
- Replace hardcoded root path with ROOT_DIRECTORY_ID constant across components
- Adjust blank context menu position for files page
- Add directory background context menu

### Fixed
- Remove upload success snackbars

--- 

## v0.30.1
**Released on:** 2026-07-08

**Title:** Add app lock shortcut handling to enhance security features

### Added
- Add app lock shortcut handling to enhance security features
- Implement upload transfer session management and enhance connection handling
- Enhance search dialog with result query handling and sorting functionality

### Fixed
- Enhance drag-and-drop upload handling with deduplication logic

--- 

## v0.30.0
**Released on:** 2026-07-02

**Title:** Protocol Version 15

### Added
- Implement keyboard shortcut handling to prevent default find action and enhance input focus behavior
- Update audit range display format and improve search preview positioning logic
- Implement search preview functionality with sorting and debounce support
- Refactor directory and document listing commands to use cursor-based pagination
- Add 'Forgot Password' functionality with dialog and internationalization support

--- 

## v0.29.1
**Released on:** 2026-06-20

**Title:** Bugfix

### Added
- Add 'deleted' status to download tasks and update related functionality
- Add structured server rejection handling and improve metadata response parsing
- Enhance download management with pause and resume functionality

--- 

## v0.29.0
**Released on:** 2026-06-18

**Title:** Supporting Resume Download

### Added
- Enhance download functionality with resume support and cleanup mechanisms
- Remove SnackBar notifiications for download completion
- Add download task context actions
- Add retry functionality for failed downloads and enhance download task metadata
- Enhance download batch management with new tracking and UI updates

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
