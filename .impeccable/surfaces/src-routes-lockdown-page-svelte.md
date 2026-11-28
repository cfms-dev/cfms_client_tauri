---
version: 1
slug: "src-routes-lockdown-page-svelte"
primary_target: "src/routes/lockdown/+page.svelte"
related_targets: []
---

# Lockdown screen

- Scope: `src/routes/lockdown/+page.svelte`; visitor mode is Operate.
- Audience and job: a non-exempt user reaches a server-controlled emergency stop, must immediately understand that file work is suspended, read any administrator reason and accurate session posture, then wait, return to sign in with an exempt account, or leave safely.
- Direction: “Time Horizon” pairs a top live connection-status strip (without exposing server display name or account identity) with an oversized 24-hour clock as the first-viewport anchor, a compact rose lockdown register beneath it, and one continuous two-column lower operations shelf for reason, dual-state session posture (no session kept vs. session suspended), guidance, and Fluent 2 three-tier exit actions.
- Interaction: preserve zero-retained-session cleanup on lockdown login while adding a return-to-sign-in escape hatch for signed-out users; preserve app-lock (surfaced in the top bar when available), logout, disconnect, quit, busy, disabled-on-disconnect, and error behavior; gate mobile quit guidance strictly to mobile platforms; disconnect is the primary Fluent action while semantic danger remains restrained.
- Constraints: inherit the Fluent Operations Workspace (Mica-ready canvas and semantic Fluent 2 tokens), both themes, bilingual copy, keyboard and touch access, safe areas, short and narrow viewports, forced colors, and reduced motion. Do not regress to a generic centered alert card, card stack, large red field, or decorative alarm treatment.
- Memorable moment: the time remains large enough to be recalled after one glance while the status line makes the security state unmistakable.
- Unresolved decisions: none.
