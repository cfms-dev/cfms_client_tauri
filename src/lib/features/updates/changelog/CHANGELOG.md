# CFMS Client Changelog

This file is the product changelog shown inside the app. Keep entries newest first.

---

## v0.59.0
**Released on:** 2026-11-11

**Title:** CRL Validation

### Fixed
- Set theme = null to follow system preferences
- Add conditional compilation for Mica variant in BackdropMode
- Disable default features for Rust checks to avoid frontend asset requirements
- Remove unused ConnectionSecurity component and related styles
- Update placeholder text for action input in DeveloperRequestConsole

### Improved
- Implement download batch processing and app lock functionality in Rust
- Make tests adhere to the FIRST principles
- Re-organize code structure and update references

### Added
- Update control height tokens for notched fields and enhance layout consistency
- Implement CRL validation tests, enhance connection security UI, and document CRL handling
- Implement outside click cancellation for address editing and update help text

### Maintenance
- Bump tauri-plugin-dialog from 2.8.3 to 2.8.4 (#43)

### Changed
- Merge pull request #44 from cfms-dev/dependabot/cargo/rusqlite-0.41.1

--- 

## v0.58.0
**Released on:** 2026-11-01

**Title:** Improved Task Management UI

### Added
- Enhance breadcrumb navigation with overflow handling and context menu
- Enhance upload task notifications and error handling for multiple tasks
- Implement directory background refresh functionality
- Enhance upload and download task error handling with detailed failure reasons
- Implement upload task management and control features

### Fixed
- Make background material fixed when scrolling; remove background for lists

### Improved
- Remove unreleased extension features

--- 

## v0.57.0
**Released on:** 2026-10-27

**Title:** Palette System & User Profile Page

### Added
- Refactor theme management and introduce palette system
- Update theme colors and improve accessibility for elevated actions
- Implement keyboard shortcut display on context menus
- Enhance account settings page with user info and permissions management

### Fixed
- Update input components and styles for improved consistency and usability
- Update icons in EscalationControl and settings to improve consistency
- Enhance MdOutlinedField component with control size and end content support
- Update styling for password reset dialog options to improve layout and readability
- Enhance revision graph rendering and add push pin icon
- Update node lookup action identifier for resolve_node_path function

### Improved
- Enhance context menu layout and shortcut display for improved usability
- Update account terminology and enhance permissions display in account settings
- Clean up unused translation keys and enhance i18n handling in frontend and backend
- Remove unused AccountBadge component and update navigation routes

--- 

## v0.56.0
**Released on:** 2026-10-26

**Title:** Protocol Version 29

### Added
- Enhance authentication management and permissions

### Fixed
- Update acrylic transparency values in design files for improved visual consistency
- Update AppUpdateChecker styles and improve AuditUserIdentity component behavior for touch interactions

--- 

## v0.55.1
**Released on:** 2026-10-26

**Title:** Bugfix

### Fixed
- Enhance BatchAccessRulesDialog for multi-selection handling and improve test coverage for language support
- Add iconFilled property to ContextMenuActionItem and update context menu items for favorite actions
- Update animation purpose and improve AuthScene component styles for better clarity and consistency

--- 

## v0.55.0
**Released on:** 2026-10-25

**Title:** Fluent Design

### Maintenance
- Mock navigation and update button click behavior in settings updates

### Fixed
- Refine animation behavior in AuthScene component for improved user experience
- Update input styles across multiple components for consistency
- Refactor styles and structure for improved UI consistency and accessibility across home, settings, and tasks pages
- Update dependencies and improve public key authentication flow

### Added
- Introduce AuthScene component for improved authentication UI handling
- Implement ServerDocumentPicker component with filtering and empty state handling
- Enhance context menus and icons with new duotone variants
- Enhance snackbar motion and notification duration
- Add user ID copy functionality with visual confirmation and enhance icon mapping
- Enhance authentication management UI and functionality
- Implement user preview cache and clipboard functionality
- Enhance MdSwitch styles with improved transitions and pressed state feedback
- Update SettingsPageHeader and +page.svelte for improved button styles and navigation
- Enhance account and menu surfaces with acrylic styles and add duotone icons
- Remove unnecessary background material;
- Refactor file navigation and enhance UI components
- Update design documentation and layout for Fluent Operations Workspace, enhancing Mica integration and responsive settings entries
- Migrate existing UI components to Fluent Design
- Add Fluent theme implementation and tests

### Improved
- Replace input fields with MdOutlinedField component for improved styling and consistency across various components

--- 

## v0.54.0
**Released on:** 2026-10-24

**Title:** Protocol Version 28

### Added
- Enhance escalation policy management and add clear escalation functionality
- Replace username with user ID and implement expandable user ID functionality
- Implement unified authentication management and settings
- Implement discard functionality for local encrypted data and update UI components
- Enhance sign-in options with toggle functionality and recovery help
- Add authentication management and public key verification components
- Implement escalation feature with multi-factor authentication

### Maintenance
- Upgrade deps

--- 

## v0.53.0
**Released on:** 2026-10-22

**Title:** [Security] Batch Operations for Access Rules 

**WARNING:** Due to a recently disclosed CA certificate incident, all client versions prior to this release should now be considered insecure. This version addresses the issue by updating the `webpki-roots` dependency; therefore, please upgrade to this version as soon as possible, if you are able to do so.

### Maintenance
- Update cargo.lock

### Added
- Update batch access rules dialog title
- Enhance modal keyboard handling and dialog management
- Add batch access rules dialog and controller tests

--- 

## v0.52.0
**Released on:** 2026-09-29

**Title:** Implement Github Token Configuration Page

### Maintenance
- Update deps

### Fixed
- Remove redundant hints and improve layout for GitHub token settings
- Improve update timeout settings and add webpki-roots dependency for Android
- Fix double-focus issues

### Added
- Implement Github token configuration page

--- 

## v0.51.1
**Released on:** 2026-09-11

**Title:** Bugfix

### Fixed
- Enhance starterValue function to prefer non-null defaults
- Add focus retention for required payload field initialization

--- 

## v0.51.0
**Released on:** 2026-09-11

**Title:** Improved UI and New Code Editor

### Added
- Add signed update hint to update settings and improve accessibility
- Implement automatic update check pause functionality
- Integrate JsonCodeEditor for source rules and add loading message
- Implement audit log filtering component and functionality
- Remove unused contract version and max attempts display from ScheduleEditor, update related tests and notifications
- Implement dynamic theming and syntax highlighting
- Add schema-driven payload editor

--- 

## v0.50.0
**Released on:** 2026-09-10

**Title:** Protocol Version 27

### Added
- Update to core protocol 27, adjust related tests and descriptions

--- 

## v0.49.1
**Released on:** 2026-09-08

**Title:** Bugfix

### Added
- Enhance schedule creation with availability checks and tooltips fix: adjust font-family order for material symbols style: update icon component for better overflow handling test: add tests for schedule page button states and search input focus

--- 

## v0.49.0
**Released on:** 2026-09-08

**Title:** Add protocol 26 schedule workspace

### Added
- Add protocol 26 schedule workspace
- Adapt client to protocol 26 scheduling API
- Improve DownloadTaskGroupHeader with enhanced action handling and state management in tests

--- 

## v0.48.0
**Released on:** 2026-08-26

**Title:** Better Interaction Support for Rate Limiting

### Added
- Enhance download task management with rate limit handling and user feedback

--- 

## v0.47.0
**Released on:** 2026-08-25

**Title:** Protocol Version 25

### Added
- Update protocol version to 25 and enhance error handling for file task claims
- Enhance download task management with failure handling and record removal
- Enhance AppUpdateChecker and ChangelogPanel components with improved accessibility and state management
- Enhance security measures and sensitive data handling

--- 

## v0.46.1
**Released on:** 2026-08-23

**Title:** Bugfix

### Fixed
- Determine connection entry visibility based on login status

### Added
- Enhance permission handling in PermissionEntriesDialog and related tests
- Add hasAvailableHighlights method to ReleaseHighlightsState and update AppUpdateChecker logic

### Improved
- Remove permission overview logic and update related components

--- 

## v0.46.0
**Released on:** 2026-08-22

**Title:** Protocol Version 24

### Fixed
- Update delete and undo action buttons for better alignment and layout

### Added
- Add initial maximized state to ModalFrame and update related tests
- Add PermissionEntryEditor and PermissionEntryList components
- Update permission management system

### Improved
- Remove PermissionManagementButton component and replace with ActionButton in relevant places

--- 

## v0.45.0
**Released on:** 2026-08-21

**Title:** Introduce a full-screen feature tour

### Added
- Add a paired light and dark animation that shows the feature tour expanding from a window into a full-screen experience

### Changed
- Present release highlights edge to edge across desktop and touch layouts, with dedicated narrow-screen and landscape adaptations
- Reuse the existing 0.43 release-highlight animations in the 0.45 feature tour

### Fixed
- Adjust focus styles for release highlights screen to improve accessibility

---

## v0.44.0
**Released on:** 2026-08-20

**Title:** Add node path resolution feature and related UI components

### Added
- Add node path resolution feature and related UI components
- Add a project-specific skill for lottie
- Ship animated highlight scenes
- Present permission-aware highlights
- Add highlight tour foundation

### Improved
- Enhance UI structure and improve accessibility features
- Remove release highlights section from About page and update AppUpdateChecker component

### Fixed
- Add finish_directory method to complete directory uploads
- Adjust Lottie's animation details to make it more elegant and beautiful
- Rewrite server diagnostics animation for version 0.43

### Maintenance
- Set timeout for various jobs to 25 minutes
- Add thread configuration to rustflags
- Update deps

### Changed
- Update dependabot.yml to include cargo and npm

--- 

## v0.43.0
**Released on:** 2026-08-19

**Title:** Protocol Version 23

### Added
- Add a permission-aware release highlights guide with local Lottie animations and replay from the About page
- Add diagnostics page with server diagnostics functionality and localization support
- Update protocol version to 23 and enhance user management features with reason handling
- Implement resizable details pane with keyboard support and add tests
- Add Document ID download functionality with UI and tests
- Implement server diagnostics feature with protocol 22 support and related UI components
- Add admin_password_reset_data function and related tests for password reset functionality
- Enhance ModalFrame with resizable and maximizable features
- Add hidden developer request console with API integration

### Fixed
- Enhance ModalFrame with improved window state transition handling and related tests
- Add functionality to restore pre-maximize size after viewport changes in ModalFrame
- Adjust layout and sizing for DeveloperRequestConsole

--- 

## v0.42.0
**Released on:** 2026-08-11

**Title:** User Interface Optimization

This version refactors the interface for the entire transfer task list to improve visual presentation and interaction efficiency. It also addresses several issues present in previous versions.

### Fixed
- Deselect all items before opening current directory context menu
- Avoid blocking operational state changes
- Constrain virtualized list viewport
- Adjust layout properties for connect form components to improve responsiveness
- Improve keyboard navigation and scrolling behavior in FileTable

### Improved
- Flatten transfer list surfaces
- Batch downloaded file deletion and report failures

### Added
- Show download transfer speeds
- Refine task interactions and presentation
- Improve batch grouping and progress semantics
- Implement persistent upload task management
- Add linkOff icon and enhance clock synchronization on lockdown page
- Enhance DialogHost component with improved styling and choice handling logic
- Add draggable functionality to ModalFrame component with viewport constraints
- Enhance lockdown page with accessible clock and detailed documentation

--- 

## v0.41.2
**Released on:** 2026-08-02

**Title:** Bugfix

### Added
- Enhance progressive directory sorter with timeout handling and fallback logic

--- 

## v0.41.1
**Released on:** 2026-08-02

**Title:** Bugfix

### Fixed
- Implement directory request timeout handling and improve error messaging

--- 

## v0.41.0
**Released on:** 2026-08-02

**Title:** Protocol Version 21

### Added
- Enhance lockdown page with improved structure and additional tests
- Refactor error handling and user-facing messages
- Add avatar permissions and implement user avatar management features
- Implement lockdown handling and user feedback in authentication flow

--- 

## v0.40.0
**Released on:** 2026-07-31

**Title:** Implement resumable file upload with progress tracking

### Added
- Implement resumable file upload with progress tracking

--- 

## v0.39.0
**Released on:** 2026-07-30

**Title:** Bug fixes and UI improvements

This version adds an option for general users to change their nicknames and introduces a security feature to reset the app, along with various improvements and fixes.

### Added
- Group settings entries by task and enhance security status overview feat(app-lock, screen-protection): add initialization failure state handling fix(i18n): update English and Chinese translations for settings overview test(settings): improve tests for settings overview and protection states
- Refactor settings pages to use a consistent layout and styling
- Refactor settings page layout and styles; enhance account settings with avatar preview and improved nickname editing UI
- Introduce `impeccable` skill
- Add nickname management functionality with validation and UI integration
- Implement local data reset functionality

### Improved
- Add design system and product documentation for CFMS Client
- Polish backup and reset interface

### Fixed
- Fix application exit issues
- Streamline local data reset process and update main window configuration
- Update local data settings page icons and styles

--- 

## v0.38.3
**Released on:** 2026-07-27

**Title:** Cross-protocol-version Support

This version adds support for a range of protocol versions—rather than just a specific one—to accommodate scenarios where the protocol specification has been updated but the current implementation remains compatible without modification.

### Maintenance
- Update static fonts

### Added
- Enhance protocol version handling with support range and compatibility checks

--- 

## v0.38.2
**Released on:** 2026-07-25

**Title:** Optimization of the Display of Revision Version Diagrams

### Added
- Enhance revision graph functionality with lineage tracking and visual updates feat(i18n): add current revision lineage translation to English and Chinese test(revision-graph): add unit tests for revision graph lineage highlighting and behavior

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
