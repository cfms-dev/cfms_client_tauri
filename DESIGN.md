---
name: CFMS Client
description: "Fluent Operations Workspace — Windows 11 clarity, shared across platforms."
colors:
  operational-blue: "#0067c0"
  signal-cyan: "#60cdff"
  light-canvas: "#f3f3f3"
  light-content: "#ffffff"
  light-text: "#242424"
  light-muted: "#616161"
  dark-canvas: "#202020"
  dark-content: "#292929"
  dark-text: "#ffffff"
  dark-muted: "#d6d6d6"
typography:
  display:
    fontFamily: "Noto Sans, Noto Sans SC, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "36px"
  headline:
    fontFamily: "Noto Sans, Noto Sans SC, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "26px"
  title:
    fontFamily: "Noto Sans, Noto Sans SC, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Noto Sans, Noto Sans SC, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Noto Sans, Noto Sans SC, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  small: "4px"
  medium: "8px"
  large: "12px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.operational-blue}"
    textColor: "{colors.light-content}"
    rounded: "{rounded.small}"
    height: "32px"
    padding: "0 12px"
  surface-content:
    backgroundColor: "{colors.light-content}"
    textColor: "{colors.light-text}"
    rounded: "{rounded.medium}"
---

# Design System: CFMS Client

## Overview

**Creative North Star: "Fluent Operations Workspace"**

CFMS uses Fluent 2 with the calm hierarchy and working density of Windows 11 applications. It is an operational interface for authorized confidential-file work: familiar controls, explicit security feedback, keyboard navigation and readable information lead.

All platforms share Fluent and locally bundled Noto typography. Safe areas and input density adapt to the device; Android does not switch back to Material. Light, dark and system preferences remain user-controlled. Use pinned Fluent UI Web Components, retaining native/custom controls when sensitive data or established behavior requires them.

The shared foundations, authentication, shell and business surfaces use Fluent. File management, transfers, schedules, settings, administration, recovery, update and reading surfaces share the same control geometry, typography and semantic states. Complex tables, menus and editors retain their established interactions. See FLUENT-MIGRATION.md for the implementation inventory and validation limits.

## Colors

The color palette registry in src/lib/fluent/palettes.ts is the color authority. The operational palette preserves the established blue/cyan brand states and Windows-like neutral surfaces. Each palette declares a stable ID, a Fluent brand ramp, paired light/dark color overrides, dedicated surface colors and a mica or solid window backdrop policy. theme.ts assembles these colors with shared typography, geometry and motion; palettes cannot override those shared foundations. Both modes define hover, pressed, selected and disabled states. Use semantic variables such as --colorNeutralForeground1, --colorNeutralBackground1, --colorBrandBackground and --colorStrokeFocus2.

Keep palette identity separate from brightness: data-palette selects colors, data-theme remains light or dark, and the saved color_scheme preference continues to mean light, dark or system. The appearance store currently always selects operational; there is no palette picker or saved palette preference. To add a palette, supply both modes and register it in colorPalettes, then regenerate CSS with pnpm assets:fluent. Static CSS and Fluent shadow-root themes share the same factory. An absent data-palette uses operational before runtime initialization. Dedicated disclaimer and appearance-preview colors use the typed cfmsDisclaimer* and cfmsPreview* roles, with the original values in surface-colors.ts. Photography, connection-button gradients, Lottie artwork, QR codes and editor syntax colors retain their dedicated palettes.

The --color-md3-* and --explorer-* names are migration aliases only, never an independent palette. New shared controls use Fluent tokens. Destructive actions have dedicated tokens. Distinguish errors, warnings, disabled and selected states without color alone. Accent identifies focus, selection, links and primary actions; the circular connection action is the deliberate fluid-color exception. Text has a separate contrast ramp from brand fills and graphics: light brand text uses #004e8c (#004577 hover, #003254 pressed), dark brand text uses #8fddff (#b8ebff hover, #75d5ff pressed). Warning text uses colorStatusWarningForeground2 (#8a3707 light, #fdcfb4 dark); warning icon subjects use colorStatusWarningForeground1 (#bc4b09 light, #faa06b dark). Brand fills, focus strokes and graphic accents retain their own Fluent roles. Aim for 7:1 on default working surfaces; require 4.5:1 for ordinary text in all interactive states and 3:1 for essential graphics. Verify composited material backgrounds as well as solid theme values.

The legacy --explorer-accent specifically resolves to brand text. Use colorBrandBackground with colorNeutralForegroundOnBrand for filled primary actions, and colorCompoundBrandForeground1 for graphic marks and progress. Use the corresponding hover and pressed tokens rather than mixing text colors into a button fill. Success and danger fills pair their Background3 roles with colorNeutralForegroundStaticInverted; password-strength feedback uses dedicated danger, warning and success roles.

## Typography

Use locally bundled Noto Sans followed by Noto Sans SC for sans-serif text on every platform. Use Noto Serif followed by Noto Serif SC at every existing serif call site, including headings, lock-screen copy and reading views; do not remove these exceptions when normalizing UI typography. Technical values use JetBrains Mono, with Noto Sans SC for Chinese characters. Generic sans-serif, serif and monospace families are final fallbacks only.

The font stacks are declared in the Fluent theme module and emitted into the generated CSS. Fluent base/numeric tokens, Tailwind font utilities and legacy font aliases resolve to these same stacks. In particular, --font-md3-serif and --font-cfms-reading resolve to --font-cfms-serif, not the sans-serif base.

Fonts ship as local variable WOFF2 slices covering weights 300–800 for Noto Sans and Noto Sans SC, and 400–800 for other families. Preserve unicode ranges for dynamic filenames, user names and server content; never limit coverage to translation strings. The build-time font asset script is the only downloader. Ship the OFL license for each family and make no runtime font CDN requests.

Use the 12/16, 14/20, 16/22, 20/26 and 28/36 pixel ramp. Default text is regular 14/20; semibold supplies hierarchy. Touch inputs use 16px. Prefer sentence case, baseline alignment and restrained tracking.

Context-menu shortcut hints use the first existing binding, right-aligned beside the action label in 300-weight sans-serif text at 12/16px, without keycap decoration. All visible actions share icon, label and shortcut columns, including unbound and disabled actions; keep 8px between icon and label and 16px between the label region and the shortcut region. Size the shortcut column to its widest hint. Menus grow to fit content up to 320px and leave at least 8px at viewport edges; labels wrap within their shared region when constrained, while shortcut hints stay on one line. Menus without shortcuts reserve no shortcut column. Share bindings with command registration and retain platform-aware key names. Disabled actions with an explanation remain focusable with aria-disabled and cannot execute; hover, keyboard focus and touch reveal a portaled, viewport-constrained tooltip. Actions missing only elevation remain enabled, with warning-colored labels and monochrome icons; duotone icons color their explicitly identified primary subject with the warning icon color and use colorNeutralForeground2 for secondary detail. Labels use the separate warning text color. Their accessible tooltip explains that selection starts identity verification. Selecting closes the menu, uses the shared toolbar elevation flow and continues the original action only after successful elevation and renewed permission checks. Other disabled prerequisites retain their disabled state. Forced colors use system foreground and highlight colors without color transitions, so paired foreground/background changes stay synchronized.

## Layout

Preserve the existing top bar, 244px navigation region, flexible content and responsive breakpoints. Desktop navigation rows are about 36px and ordinary buttons 32px; coarse-pointer targets are at least 44px. Use the four-pixel grid, with 24px between major groups.

The workspace content container shares the window-base Mica with persistent chrome after native confirmation, across the full viewport and scroll area; otherwise it paints an opaque theme-matched background. Route wrappers stay transparent, including centered or short pages. Settings overview entries form two equal columns within each group when the workspace container is at least 800px wide, and one column below that. Entries at least 360px wide place title/description on the left and right-aligned status/scope on the right; narrower entries place status below the description with an 8px gap. Entries without status reserve no status track. Keep row-major reading order and wrap status text inside its entry. Transfer page headings use 24px top spacing (16px on narrow windows), 28/36px titles, and a 4px gap before 14/20px descriptions; shared settings headings use the same title/description gap. Group section and settings-item titles with their descriptions using a 4px gap. Settings descriptions align with their titles in one text block, with leading icons vertically centered against the entire block. Status refresh actions use Arrow Clockwise icon buttons on the right, beside any status indicator, with localized accessible names and busy states.

At 1024px and above, sign-in retains its 38.196601125% form / remaining image composition. The existing astronomy picture extends behind the form on a separate decorative layer; an independent paint layer uses the shared 84% neutral account tint, 20px blur and 1.2 saturation, leaving the form crisp and the right-hand image clear. Below 1024px, the same picture and material fill the scene behind the full-width form. Fade the opaque cover to reveal this frosted background on connect-to-login navigation and restore it on return, using the shared 600ms duration and easing without image movement, scaling or panel resizing. Direct entry shows the destination state, and viewport changes do not restart the animation. Unsupported blur, reduced transparency and forced colors keep the form solid; forced colors uses Canvas. Preserve pictures, avatars, credential switching, action order, utilities and desktop image push/retreat transitions. Text fields use labels permanently embedded in a notch in the top border, without rearranging the route.

Control-height tokens in src/lib/fluent/surfaces.css remain small 24px, medium 32px and large 40px on desktop, and 44px for coarse pointers. Ordinary notched fields retain those sizes. Only notched date/time fields add 4px of clearance on each block side: their visible border boxes are 32/40/48px on desktop and 52px for coarse pointers, giving the content 4px more clearance below the label. Standalone buttons and unlabelled address/search composites retain their existing density. MdOutlinedField owns the complete border box and FluentTextInput forwards its explicit controlSize. The permanent 12/16px notched label overhangs the top border by 8px without adding layout height; form/group spacing must leave that overhang visible, including at scroll boundaries. Align sibling actions with the visible control body, keeping help/error text below it. Do not compensate with per-page offsets, input heights or vertical padding. Native controls inside the wrapper are 2px shorter than its border box; multiline fields retain their existing padding and grow naturally. Native field actions use MdOutlinedField's optional end snippet: a non-shrinking flex region with no extra spacing between buttons or before the inline-end border. The field owns action sizing and end corners; action targets follow its full density, including 44px touch targets for ordinary fields and 52px for date/time fields without increasing the field height. Do not absolutely position these actions or reserve their width with action counts. Date/time fields retain native pickers, use the active theme's color-scheme without fixed icon filters, and align picker indicators at the inline end with a single layer of horizontal padding. Preserve explicit large authentication fields.

Ordinary actions beside fields opt into cfms-control-action: their complete border boxes share the medium control-height token, with no vertical padding and square icon-only targets. Unlabelled composites opt into cfms-input-composite; their outer border owns the same height, the input is 2px shorter, and a cfms-input-composite__end region lets full-height actions align with the outer border without increasing it. Preserve responsive wrapping and each surface's focus owner; keep these rules explicit rather than resizing all buttons or list rows.

Fields with end actions mark decorative leading icons with data-field-leading-icon. When their editable region is at most 80px wide, the shared field hides that decoration and reduces input padding to min(12px, 20cqi), preserving editable space and full-size actions under narrow-window zoom without clipping focus indicators.

Small icons beside hints, warnings, errors and status copy use the shared cfms-icon-text__icon flex wrapper. Center the icon against the first text line using a 1lh alignment box, including when copy wraps. When the first line has independent typography, set --cfms-icon-line-height to that line's height. Keep typography, semantic colors and ARIA roles at the call site; do not use fixed top margins to compensate for inline baselines or change the global Icon component's inline behavior. Illustration badges and choice controls retain their own layouts.

## Elevation & Depth

Native Windows Mica belongs to the window base, persistent chrome and workspace base across business pages. Expose it only after native code reports successful application. Other platforms and failed application use an opaque theme-matched window base. Route wrappers remain transparent; images, document reading surfaces and code editors retain dedicated readable fills.

Palettes explicitly opt into Mica: operational uses mica; palettes needing their own window-base color use solid. Forced colors and reduced transparency disable Mica regardless of the palette. colorNeutralBackground3 must be an opaque #RRGGBB canvas; its RGB channels are passed to set_window_backdrop for the native solid base, including Mica failure, instead of selecting a fixed gray by brightness. The CSS canvas stays opaque until the current native update confirms Mica, and remains available when the native call fails.

Shared CSS materials use the Fluent neutral theme: content surfaces have 60% tint, fields 55%, and transient panels 94%, with 20px backdrop blur and 1.2 saturation. Independent cards and detail/editor panels use the shared content surface; filter/search bars and native ordinary/sensitive fields and Fluent text-input parts share the field treatment without changing their behavior. Content and field wrappers paint through an isolated pseudo-element so filtering never changes the containing block of viewport overlays. Material hosts must not scroll: keep the paint on a stable outer container and scroll an inner content region, including schedule inspectors, mobile file details and long context menus with noise. Blur containers once, never individual rows. Hover, selection and semantic state colors stay explicit. Only floating layers use shadows.

ModalFrame panels and search previews use cfms-acrylic-surface with Fluent edge strokes and shadow64. The account flyout uses cfms-account-surface with 84% neutral tint. Context menus use cfms-menu-surface with 94% neutral tint, 20px blur, 1.2 saturation, a static 2.5%-opacity monochrome noise tile, a subtle 1px stroke, 8px outer corners and shadow16. Their 4px inset items use neutral hover/pressed fills, 20px icons and 14/20 text; long labels wrap. Menu rows are at least 32px on desktop and 44px for coarse pointers. Folder-add, folder-upload, folder-move, copy, permission-settings, password-reset and avatar menu icons opt into locally composed duotone outlines: neutral body and brand-colored badge, front sheet, gear, reset arrow or person. The SVG primary/secondary channels identify subject and detail independently of brand coloring: folder, shield, password panel, front copy sheet and person are primary; badges, gear, reset arrow, rear sheet and avatar ring are secondary. Normal graphic brand color comes from colorCompoundBrandForeground1 rather than the text ramp. Simple icons stay monochrome. Disabled/danger actions and forced colors remain monochrome. ModalFrame and context menus mount at the document body to escape scrolling and animated ancestors. Smoke paints and fades on a sibling layer; never fade a dialog's ancestor, which would truncate backdrop sampling. Unsupported blur, reduced transparency and forced colors use solid theme/system surfaces without noise; reduced transparency and forced colors also disable native Mica, and forced colors removes shadows. CSS glass samples application content, not the desktop behind the native window; over a uniform background it is naturally subtle. Keep the native system title bar and decorations.

The file navigation bar follows Explorer's back, forward, up, flexible address, search, refresh order. Refresh stays to the right of search. Desktop controls have a 32px outer height in a 48px-minimum row, with 4px corners and 8px spacing; coarse pointers use 44px controls. At viewport widths of 720px and below, search and refresh share a second row. The address fills remaining space with and without node_lookup. Address breadcrumbs collapse distant ancestors into a shared context menu, listed nearest first, while preserving the current directory and as many nearby ancestors as fit. At extreme widths root also moves into the menu; long current names ellipsize with their full name available as a tooltip. Reserve at least 32px of blank space at the right, or 44px for coarse pointers. With node_lookup, clicking any address-bar blank space enters path editing, focuses and selects the known path; Alt+D and F4 remain available without a pencil icon. Without node_lookup the blank space is inert. Other breadcrumb consumers retain their existing layout. The independent visit timeline restores full directory breadcrumbs, keeps back/forward branches per server/account within the application session, and registers Alt+Left/Right through shared keyboard commands. Refreshes never add visits.

Floating layers use Fluent shadow tokens and fine edge strokes; resting content uses tones and borders. Text stays readable independently of wallpaper.

Main operational lists (files, transfers, schedules, trash and administration), their empty states, toolbars and pagination, the overview's recent/favorite sections, the mobile account action list, and the account's direct permission entries and personal/group permission source lists expose the workspace base directly, without a neutral content tint or a separate material layer. Do not attach cfms-content-surface to these containers: its background pseudo-element paints even when the container's own background is transparent. The sticky file header matches the workspace's opaque fallback color, or uses untinted backdrop blur when native Mica is active. Independent settings cards, detail and editor panels, fields and floating layers retain their dedicated materials; hover, selection and semantic feedback retain their state colors.

## Shapes

Use 4px corners for controls, 8px for content and 12px for large modal/flyout surfaces. Circle/pill forms suit avatars, switches and compact states.

**Brand exception:** preserve the circular connection action, fluid gradients, busy color transition, progress and cancellation. Do not copy its treatment to ordinary buttons. Reduced motion must retain understandable, operable states.

## Components

Shared floating notifications use opaque Fluent neutral surfaces, semantic status icons, a fine stroke, shadow16, 8px corners, 16px padding and 14/20 text. Do not use specular gradients, inset highlights, full semantic-color fills or dismissal countdown bars. At viewport widths of 640px and above, the body-mounted stack sits 24px from the window's right and bottom edges; narrower windows center it at the bottom with 16px margins. Add safe-area insets. Cards are at most 384px wide, separated by 16px, with newest messages at the bottom and bounded scrolling in short windows. Default dismissal is seven seconds, paused while hovered or focused, with explicit durations and persistent notifications preserved. Optional related actions use a wrapping Fluent subtle button below the copy, with the close control at the upper right; activating an action dismisses its notification without stealing focus on arrival. Progress appears only after one second: known totals use a determinate bar, unknown totals use a spinner. Entrance is a 250ms decelerating 12px rise and fade; exit is a 150ms accelerating 8px drop and fade, with 200ms FLIP stack reflow. Reduced motion removes these animations.

- Prefer official Web Components for buttons, icon buttons, switch, checkbox, radio, spinner and ordinary non-sensitive text input. Register only used components and bundle locally. Thin Svelte adapters own values, events and accessible names; pages never inspect third-party shadow roots.
- Passwords and private-key passphrases stay native. The pinned Text Input reflects its current value into attributes and must not receive secrets. Server history remains the established native combobox. All visibly labelled text fields, including native password, multiline, number and date/time inputs, use MdOutlinedField with a permanent 12/16px label in a real top-border notch. FluentTextInput shares this frame while retaining the official input component. Decorative fieldset/legend outlines are hidden from assistive technology; labels remain associated with their controls. Keep 4px Fluent corners, translucent field materials, validation and one delegated focus indicator. Hints, counters and actions stay outside the label notch. Unlabelled search/address controls, selects and code editors retain their established presentation.
- Keep the semantic IconName interface. Use local Fluent System Icons SVGs, Regular by default and Filled for selected states. Style .cfms-icon or data-icon rather than font implementation classes.
- Selected radio illustrations explicitly use Filled artwork with a center dot. Language uses Local Language Globe; directory-ID navigation uses Notebook Eye Regular. Icon generation tries the requested size, 24px, then 20px before falling back to Regular artwork.
- Preserve ModalFrame, complex menus and file tables where they encode focus, resizing or business behavior. Restyle shared surfaces rather than replacing behavior for appearance alone.
- One owner paints each focus indicator. Native composites use data-focus-ring="delegated"; Fluent owns its internal focus. Shortcuts respect shadow-boundary editable targets and modal loops include enabled custom controls.
- Ordinary controls use fill/stroke/pressed feedback rather than Material ripples or pronounced spring bounce. State changes generally take 100–200ms; floating layers 200–300ms. Preserve authentication image push/retreat and panel choreography at 600ms, triggered only for route transitions. AuthScene owns one eased progress for the desktop panel boundary, background reveal, and clear-image transform, and for the narrow-screen background fade; return navigation reverses the progress endpoints while retaining the same decelerating easing and 600ms duration. Reveal the acrylic with a separate opaque cover that moves on desktop and fades on narrow screens, never by fading or clipping its ancestors, and keep the clear image at its final crop while revealing it. Honor app/OS reduced motion, including shadow-root animations.
- Shared Fluent switches move their public checked-indicator part with transform over approximately 180ms and decelerate without overshoot. Hover slightly enlarges the circular thumb uniformly; pointer/Space presses gently dim the thumb and use Fluent pressed track/stroke colors over 100ms, without deforming it. Release restores the resting appearance. Initial values do not animate, interrupted transitions reverse naturally, and reduced motion removes thumb movement animation and scaling. Forced colors retain opaque system-colored indicators. Settings reset buttons use Arrow Reset Regular.
- Shared settings groups use consistent 8px content surfaces, headings, rows and 4px fields. Business content layers retain their readable fills above the shared workspace base. Existing tab strips scroll horizontally in narrow windows. File rows use one density value for rendering, virtualization, selection and keyboard anchoring: 40px desktop and 48px coarse pointer.
- Keep styles for adapted button hosts local to their owner through data-fluent-owner. Shared button geometry, icon/text spacing, tone and focus behavior belong in the adapter; generic names such as primary-action must not style buttons in other dialogs. Boolean icon-only is absent for labelled actions.
- Elevation is an icon-only action: 32px square on desktop, at least 44px for coarse pointers. Explorer command labels and their measurement copies use regular weight. File address and search fields have a total outer height of 32px desktop and 44px coarse pointer, including borders and padding. Address-edit help and errors sit below the field. Server search uses a single rectangular field with a 4px radius, inline clear/search actions and delegated input focus. Its toolbar placeholder is localized as “Search in {directory}” using the current directory name; this contextual wording intentionally retains server-wide search behavior. The search dialog keeps its explicit server-wide placeholder. Preview filters wrap, sorting uses rectangular selection states, and footer actions retain readable spacing.

## Do's and Don'ts

- Keep authentication, transfer, permission and security semantics unchanged. Preserve English and Simplified Chinese.
- Test keyboard, touch, both themes, forced colors, reduced motion and native material fallback. Browser previews cannot prove Mica works.
- Keep this global specification, its sidecar and route briefs aligned with implemented values. Record future business-page migration separately.
- Bundle fonts, icons and components locally. Add color schemes through the palette registry; do not create independent component palettes or recreate Material defaults.

References: [tokens](https://fluent2.microsoft.design/design-tokens), [typography](https://fluent2.microsoft.design/typography), [shapes](https://fluent2.microsoft.design/shapes/), [layout](https://fluent2.microsoft.design/layout), [icons](https://fluent2.microsoft.design/iconography), [motion](https://fluent2.microsoft.design/motion), [Windows materials](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/materials).
