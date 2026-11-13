---
version: 1
slug: "src-routes-connect-page-svelte"
primary_target: "src/routes/connect/+page.svelte"
related_targets: ["src/routes/login/+page.svelte"]
---

# Connection

- Visitor mode: Operate. Connect to the authorized server, correct validation errors or cancel the pending connection.
- Authority: Fluent Operations Workspace in DESIGN.md; all platforms share Fluent with input-aware density.
- Phase-one implementation: Keep the circular fluid action, gradients, busy color transition, cancellation and progress. Retain server-history combobox keyboard interaction. The form uses shared Fluent labels and switch; utilities use official Fluent buttons.
- Preserve authentication, permissions, connection state, screen protection and English/Simplified Chinese. Support both themes, reduced motion, keyboard, touch and narrow/short windows.
- Brand moment: the circular action and image choreography belong only to authentication; ordinary controls use restrained Fluent feedback.
- The disabled-SSL notice shares the connection-security title/detail presentation. It expands and fades in over 200ms and collapses and fades out over 150ms, including its 8px top spacing; repeated toggles reverse smoothly and reduced motion removes the transition.
- Business-page migration is tracked in FLUENT-MIGRATION.md. All platforms use bundled Noto Sans / Noto Sans SC; existing serif text uses Noto Serif / Noto Serif SC.
- Unresolved design decisions: none. Native and cross-platform validation results must be reported separately from implementation.
