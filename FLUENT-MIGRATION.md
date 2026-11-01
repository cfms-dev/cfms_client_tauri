# Fluent migration inventory

The migration preserves routes, server protocols, preferences, permission checks and workflow semantics. Existing `md3` and `explorer` names remain aliases of the Fluent theme, not independent design systems.

## Shared field geometry refinement (2026-10-27)

The audit covered 53 shared-field usages in 28 Svelte files, including the FluentTextInput adapter. The notched label now overhangs the control by 8px; it adds no layout height. MdOutlinedField and FluentTextInput share explicit small/medium/large sizes (24/32/40px desktop, 44px coarse pointer), and ordinary buttons and standalone native single-line fields use the same medium token. Multiline controls retain their natural height. Native password controls remain native.

| Area | Changes and removed local fixes |
| --- | --- |
| Recycle bin | Removed the 36px button minimum and vertical padding; the folder field, Load and Select share the 32/44px border box. |
| Account and storage settings | Removed nickname actions' 8px top compensation, its narrow-screen reset, and redundant input sizes. Storage actions align centrally and keep their width when the path shrinks. Help/errors stay outside the aligned controls. |
| Connection, sign-in and private keys | Express large fields through controlSize instead of 38/42/48px native-input overrides; direct inline touch actions cover the wrapper border without increasing field height. |
| Authentication, account/group creation, password changes/resets, preference unlock/recovery, user blocking and document-ID download | Removed single-line vertical-padding and height overrides. Password action spacing follows shared button dimensions through data-field-actions, including two 44px touch actions. |
| Schedule, schema payload, permission and security editors; authorization dates; developer console; GitHub API settings | Removed competing field heights and vertical padding. Schedule trigger/timezone controls align at the control body; field roots do not stretch with grid rows. Date/time composites preserve icons and native pickers. |
| Other shared-field consumers | Authentication-method and authenticator settings, management reason fields and connection proxy/certificate fields inherit the shared correction without route-specific offsets. Independent address/search composites retain their established 32/44px geometry; their source and existing regression tests were reviewed. |

Validation:

- `pnpm check`: zero errors/warnings; focus-ring and generated Fluent contracts pass.
- `pnpm test`: 993 tests in 130 files pass, including an added native/Fluent controlSize propagation regression. jsdom reports its existing unsupported canvas getContext diagnostic; the tests pass.
- `pnpm build`: production static build passes. The layout detector returns no findings for the shared controls and the three principal affected surfaces.
- Real Chromium browser, synthetic IPC data: 36 combinations across recycle bin, account nickname and storage path pages at 1280×900 and 390×844, English/Chinese, light/dark, 100%/125%/150% CSS zoom and normal/coarse-pointer CSS. Desktop field/action edges match exactly (0px error); narrow layouts stack correctly without horizontal overflow. The coarse-pointer condition was activated in the temporary fixture's CSSOM; this is style simulation, not hardware validation or OS/browser zoom validation.
- Browser checks also cover native/Fluent 24/32/40px parity and 44px touch parity, error/disabled size stability, label-to-shadow-input focus, nickname count/errors and Escape, password visibility and two 44px action targets, multiline inputs, authorization date/time fields and the schedule select/timezone row.
- Browser evidence is saved locally under `.svelte-kit/field-qa-evidence/`. The temporary Vite fixture is shut down after validation. No Android/Gradle or native-material validation was performed for this frontend geometry change.

## Implemented batches

- [x] Typography: local Noto Sans, Noto Sans SC, Noto Serif, Noto Serif SC and JetBrains Mono; variable WOFF2 400–800, dynamic character coverage and bundled OFL licenses. Inter and legacy TTF assets removed.
- [x] Shared foundations: Fluent action adapters, native sensitive/special fields, settings sections/rows, typography ramp, control radii, shared translucent business surfaces (60% content / 55% fields) and Acrylic-style transient panels (94%). Ordinary ripple code removed. Host styles are isolated by owner; icon-only attributes and focus loops handle custom controls.
- [x] Files and recycle bin: command/address/status bars, details, table typography and surfaces, selection/search/sort/revision controls, move/picker/access-rule dialogs. Fixed row geometry and viewport anchoring share desktop/touch density.
- [x] Transfers and schedules: page headings, filters, tabs, progress/status labels, grouped actions, task rows and schedule editor. Virtualized keyboard targets include Fluent buttons; rows remeasure when fonts finish loading.
- [x] Settings: overview and account, activity, app-lock, appearance, authentication, behavior, connection, data, GitHub API, language, privacy, storage, tasks, two-factor and updates. Settings sections and native fields share styling; non-sensitive path fields use the Fluent adapter. Proxy URLs remain native because they can contain credentials.
- [x] Administration: account/group actions, security, audit filters, permission lists/editors and authentication policies. Existing metadata collapse, column sizing and permission gates remain in place.
- [x] Other surfaces: overview, more, about, diagnostics, initialization, recovery, app lock/PIN, lockdown, disclaimer, update prompt, release highlights and Markdown/changelog reading. Existing serif locations use Noto Serif.
- [x] Authentication/shell regression boundary: the circular connection action, login composition, 600ms image transition and native Mica logic are retained.

## Validation record

- `pnpm check`: zero errors and zero warnings; focus-ring and generated Fluent asset contracts pass.
- `pnpm test`: 775 tests across 114 files pass, including offline font coverage, custom-control interoperability, dialog focus wrapping and desktop/touch virtual-list anchoring.
- `pnpm build`: production static build passes.
- Browser fixtures: 1280×720 desktop and 390×844 narrow windows, light/dark themes, English/Simplified Chinese, fine/coarse pointers, reduced motion and forced colors. File/transfer/management data, settings, paths, about and overview surfaces were inspected; no document-level horizontal overflow, page errors or external asset requests were observed.
- Browser font inspection confirms locally supplied Noto Sans / Serif and SC semibold glyphs for Latin and dynamic Chinese text, including `龘`; Fluent shadow content inherits the same Noto stack.
- Browser previews use synthetic IPC fixtures and do not validate server integration. Native Mica behavior is preserved but was not revalidated in a native client during this pass. Android device/safe-area/soft-keyboard acceptance remains unverified; no Gradle compilation was attempted because host TUN mode was not confirmed.
- Temporary preview server and headless verification browsers are shut down after validation.
