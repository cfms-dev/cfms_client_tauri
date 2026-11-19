---
version: 1
slug: "res-authentication-authenticationmanagement-svelte"
primary_target: "src/lib/features/authentication/AuthenticationManagement.svelte"
related_targets: ["src/lib/app/settings/AuthenticationSettingsPage.svelte","src/lib/features/authentication/authentication/AuthenticationFlowGraph.svelte","src/lib/features/authentication/authentication/AuthenticationMethods.svelte","src/lib/features/authentication/PrivateKeyField.svelte"]
---

# Identity verification management

- Mode: Operate. Account owners and authorized administrators review verification methods and configure when they are required.
- Structure: methods first, flows in a second tab. Each purpose has parallel alternatives and ordered steps, with a clickable diagram and one structured editor. Drafts persist across tabs and purposes; all edited policies save atomically.
- Keep the page description aligned with its title in the shared heading with a 4px gap; center the leading icon against that text block and keep the Arrow Clockwise refresh action on the right. Method titles and descriptions also use a 4px gap and the compact Fluent 14/20 and 12/16 type ramp. Omit the redundant methods-tab introduction. Narrow method rows move labelled actions below the copy.
- Visual authority: existing PRODUCT.md and DESIGN.md; Fluent controls, semantic theme tokens and bundled Noto typography. Neutral tonal surfaces, restrained selection accent, no new visual identity or graph-library dependency.
- Technical details are disclosed on demand. Multiple steps are offered for public keys only; key identities must be distinct across steps. Server capabilities and this client's execution support are described separately. Sign-in/MFA key pickers (`PrivateKeyField.svelte`) represent device-managed storage tiers with compact inline icon indicators (`Vault` in brand graphic tone for hardware-backed storage, `Lock Closed Key` in neutral tone for OS credential storage) with localized tooltips and screen-reader labels, alongside a uniform `passkey` leading icon; settings (`AuthenticationMethods.svelte`) pair the same `Vault` / `Lock Closed Key` icons with descriptive badges and generation help, and sign-in/MFA key pickers scope visible managed keys to the active username.
- Password and authenticator management share this entry point. Self-service and administrator permissions stay distinct. Setup secrets and newly issued recovery codes stay in component memory, never persisted.
- Narrow layouts put the editor below the graph and stack ordered steps. Preserve light/dark parity, keyboard access, touch targets, and reduced-motion behavior.
