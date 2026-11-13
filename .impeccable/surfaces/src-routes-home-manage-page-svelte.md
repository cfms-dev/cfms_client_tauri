---
version: 1
slug: "src-routes-home-manage-page-svelte"
primary_target: "src/routes/home/manage/+page.svelte"
related_targets: ["src/lib/components/SecurityManagement.svelte", "src/lib/components/PermissionEntriesDialog.svelte"]
---

# Administration

- Mode: Operate. Authorized administrators manage accounts, groups, security state and audit records.
- Authority: DESIGN.md. Fluent command/field/state vocabulary, Noto typography and restrained neutral content surfaces.
- Preserve all permission gates, identity-column sizing, responsive metadata/action disclosure, audit filtering, permission editing and authentication policy semantics. Tabs scroll in narrow layouts.
- Reuse the shared action and dialog infrastructure. Complex list/editor behavior remains custom; secrets remain in native inputs. Host styles are isolated from other editors and prompts.
- Server settings alone uses a bounded column: the management heading and tabs stay above an independently scrolling settings region, and an in-flow save bar remains at the bottom even during discovery or empty results. Preserve disabled/save/draft semantics. The bar registers its measured viewport clearance so shared SnackBars stay 16px above it; restore default notification placement on exit. Loading uses one progress SnackBar, delayed one second and removed when requests settle, including failures. Add slow-loading guidance after five seconds. Full saves use a seven-second success notification; partial saves use a warning notification while actionable errors remain inline.
- Context-menu copy, permission settings, password reset and avatar icons use the shared locally composed duotone outlines: neutral body with a theme-accent front sheet, gear, reset arrow or person. Simple icons stay monochrome; disabled/danger actions and forced colors use monochrome. Ordinary buttons do not opt into duotone.
- Implementation/validation inventory: FLUENT-MIGRATION.md; browser fixtures do not prove server integration.
