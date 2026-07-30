---
name: CFMS Client
description: "The Frosted Operations Console — a quietly technical, dependable workspace for confidential file operations."
colors:
  signal-cyan: "#60cdff"
  operational-blue: "#0067c0"
  carbon-workspace: "#0f1115"
  carbon-panel: "#17191d"
  carbon-raised: "#20232a"
  carbon-selected: "#343840"
  carbon-text: "#f5f5f5"
  carbon-muted: "#b4b8c1"
  quiet-canvas: "#f3f3f3"
  quiet-panel: "#fafafa"
  quiet-raised: "#ffffff"
  quiet-text: "#1a1a1a"
  quiet-muted: "#5d5d5d"
  alert-rose: "#ff99a4"
  critical-red: "#c42b1c"
  success-mint: "#6ccb8e"
  success-green: "#0f7b3e"
  warning-gold: "#f5d47a"
  caution-ochre: "#8a5d00"
  folder-gold: "#ffca4b"
  dark-outline: "rgba(255, 255, 255, 0.11)"
  light-outline: "rgba(0, 0, 0, 0.10)"
  legacy-indigo: "#4f46e5"
  legacy-periwinkle: "#8fb4ff"
typography:
  display:
    fontFamily: "CFMS Inter Subset, CFMS Noto Sans SC Subset, Noto Sans SC, system-ui, sans-serif"
    fontSize: "clamp(1.45rem, 4vw, 2.2rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "CFMS Inter Subset, CFMS Noto Sans SC Subset, Noto Sans SC, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "CFMS Inter Subset, CFMS Noto Sans SC Subset, Noto Sans SC, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.005em"
  body:
    fontFamily: "CFMS Inter Subset, CFMS Noto Sans SC Subset, Noto Sans SC, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "CFMS Inter Subset, CFMS Noto Sans SC Subset, Noto Sans SC, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.04em"
  reading:
    fontFamily: "CFMS Noto Serif SC Subset, Noto Serif SC, Source Han Serif SC, serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  mono:
    fontFamily: "CFMS JetBrains Mono Subset, JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  small: "5px"
  medium: "8px"
  large: "12px"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.signal-cyan}"
    textColor: "{colors.carbon-workspace}"
    typography: "{typography.label}"
    rounded: "{rounded.small}"
    padding: "0.28rem 0.8rem"
    height: "2rem"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.carbon-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.small}"
    padding: "0.28rem 0.8rem"
    height: "2rem"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.carbon-muted}"
    rounded: "{rounded.pill}"
    size: "36px"
  field-outlined:
    backgroundColor: "{colors.carbon-raised}"
    textColor: "{colors.carbon-text}"
    typography: "{typography.body}"
    rounded: "{rounded.large}"
    padding: "0 0.75rem"
    height: "42px"
  navigation-active:
    backgroundColor: "{colors.carbon-selected}"
    textColor: "{colors.carbon-text}"
    typography: "{typography.label}"
    rounded: "{rounded.small}"
    padding: "0.35rem 0.55rem"
    height: "36px"
  surface-card:
    backgroundColor: "{colors.carbon-panel}"
    textColor: "{colors.carbon-text}"
    rounded: "{rounded.large}"
    padding: "1rem"
  modal-panel:
    backgroundColor: "{colors.carbon-panel}"
    textColor: "{colors.carbon-text}"
    rounded: "{rounded.large}"
    padding: "1rem"
---

# Design System: CFMS Client

## Overview

**Creative North Star: "The Frosted Operations Console"**

The Frosted Operations Console treats the client as a working environment rather than a branded showcase. Its character is quietly technical, dependable, and restrained: dense information is organized through calm hierarchy, crisp state changes, and an operational palette instead of decorative spectacle.

Compact desktop controls are exact and efficient, while touch contexts gain space and larger targets without changing the underlying visual language. Frosted translucency is a functional signature reserved for floating chrome, overlays, menus, drawers, and selected transition surfaces; ordinary content stays tonal and stable so the interface never slips into cheap gloss or an abundance of generic cards.

**Key Characteristics:**

- Operational cyan or blue used as a precise signal, not a wash.
- Tonal surfaces and fine outlines at rest; elevation appears when an element floats.
- Compact, sans-serif workspace typography with serif and mono faces reserved for specific reading or technical contexts.
- Small, controlled radii for working controls; pills only for naturally compact states and toggles.
- Brief, purposeful motion with complete reduced-motion behavior.

## Colors

The palette pairs an operational cyan-on-carbon dark workspace with an operational blue-on-soft-gray light workspace; semantic colors remain legible but deliberately quieter than the primary signal.

### Primary

- **Signal Cyan** (#60cdff): The dark-theme accent for focus, active navigation, selection markers, enabled switches, and high-value actions.
- **Operational Blue** (#0067c0): The light-theme counterpart used for the same functional roles without changing the interface's hierarchy.

### Tertiary

- **Folder Gold** (#ffca4b): A file-system-specific cue for folders and favorite locations, never a general decorative accent.

### Neutral

- **Carbon Workspace** (#0f1115): The dark working canvas behind the application shell.
- **Carbon Panel** (#17191d): The dark navigation and resting-container surface.
- **Carbon Raised** (#20232a): The dark foreground surface for fields, toolbars, and elevated controls.
- **Carbon Selected** (#343840): The quiet dark-theme selection fill behind active rows and navigation.
- **Carbon Text** (#f5f5f5): High-contrast content on dark surfaces.
- **Carbon Muted** (#b4b8c1): Secondary metadata and supporting copy on dark surfaces.
- **Quiet Canvas** (#f3f3f3): The light working canvas behind the application shell.
- **Quiet Panel** (#fafafa): The light navigation and resting-container surface.
- **Quiet Raised** (#ffffff): The light foreground surface for fields, toolbars, and elevated controls.
- **Quiet Text** (#1a1a1a): Primary content on light surfaces.
- **Quiet Muted** (#5d5d5d): Secondary metadata and supporting copy on light surfaces.
- **Dark Outline** (rgba(255, 255, 255, 0.11)): Fine separators on dark surfaces.
- **Light Outline** (rgba(0, 0, 0, 0.10)): Fine separators on light surfaces.

### Semantic

- **Alert Rose** (#ff99a4): Dark-theme error text and softened error treatment.
- **Critical Red** (#c42b1c): Light-theme error and destructive-action color.
- **Success Mint** (#6ccb8e): Dark-theme connection, completion, and healthy-state signal.
- **Success Green** (#0f7b3e): Light-theme connection, completion, and healthy-state signal.
- **Warning Gold** (#f5d47a): Dark-theme warning and attention state.
- **Caution Ochre** (#8a5d00): Light-theme warning and attention state.
- **Legacy Indigo** (#4f46e5): Existing fallback accent on isolated startup or older Material surfaces.
- **Legacy Periwinkle** (#8fb4ff): Existing fallback emphasis on isolated startup or older Material surfaces. Both legacy colors are compatibility tokens, not the direction for new workspace UI.

### Named Rules

**The One Signal Rule.** Accent color identifies selection, focus, active state, and high-value action; it should not flood ordinary surfaces.

**The No Gloss Rule.** Never simulate premium value with broad gradients, plastic highlights, or decorative shine.

## Typography

**Display Font:** CFMS Inter Subset with CFMS Noto Sans SC Subset and system sans-serif fallbacks  
**Body Font:** CFMS Inter Subset with CFMS Noto Sans SC Subset and system sans-serif fallbacks  
**Reading Font:** CFMS Noto Serif SC Subset with Noto Serif SC and Source Han Serif SC fallbacks  
**Label/Mono Font:** CFMS Inter Subset for labels; CFMS JetBrains Mono Subset for identifiers, code, and time-like technical values

**Character:** The operational interface is compact, neutral, and highly scannable. Sans-serif carries almost all controls and workspace content; serif appears only where sustained reading or an established editorial surface calls for it, while mono is reserved for technical data.

### Hierarchy

- **Display** (600, responsive 1.45–2.2rem, 1.15): Major workspace introductions and rare high-level states.
- **Headline** (700, 1.25rem, 1.2): Page titles and primary empty or recovery states.
- **Title** (650, 0.9375rem, 1.25): Dialog titles and dense section headings.
- **Body** (400, 0.875rem, 1.5): Default instructions, values, and operational prose.
- **Label** (600, 0.75rem, 0.04em tracking): Compact controls, metadata, and uppercase navigation section labels where already established.
- **Reading** (400, 0.875rem, 1.6): Disclaimers, changelogs, and longer explanatory passages.
- **Mono** (400, 0.8rem, 1.5): Identifiers, structured source, shortcuts, and technical values.

### Named Rules

**The Operational Type Rule.** Use sans-serif by default; earn every serif or mono exception through reading context or technical meaning.

## Layout

The authenticated workspace is a stable application shell: a compact top bar, a 244px navigation rail, and one flexible content region. Main pages use bounded reading widths where appropriate, but file and management surfaces may occupy the full working area. Dense rows and control clusters favor 4–16px increments, with 24px reserved for major separation.

At 820px and below, the navigation rail becomes a frosted drawer with a scrim. Around 640px, multi-column cards and forms collapse to one column; narrower 540px and 420px thresholds simplify top-bar and PIN-entry details. Touch and coarse-pointer contexts enlarge navigation rows and action buttons to roughly 40–48px targets while preserving the desktop information architecture.

**The Density Follows Input Rule.** Keep desktop tools compact; increase targets and breathing room for touch without inventing a separate mobile design language.

**The Stable Workspace Rule.** Prefer persistent shell regions, aligned rows, and bounded scroll areas over stacks of interchangeable cards.

## Elevation & Depth

The system is tonal at rest and lifted when floating. Ordinary pages, rows, and cards separate through adjacent surface tones and low-contrast borders. Strong shadows belong to menus, dialogs, drawers, floating detail panes, and deliberately elevated hover states; they do not sit under every container.

Frosted depth combines near-opaque raised surfaces with 16–24px backdrop blur. It should reveal just enough environmental continuity to explain that a layer floats above the workspace, never enough to become glossy decoration.

### Shadow Vocabulary

- **Floating Workspace Dark** (`0 18px 48px rgba(0, 0, 0, 0.38)`): Menus, drawers, and floating panes in dark mode.
- **Floating Workspace Light** (`0 18px 48px rgba(0, 0, 0, 0.16)`): Menus, drawers, and floating panes in light mode.
- **Modal Focus Dark** (`0 24px 64px rgba(0, 0, 0, 0.38)`): Blocking dialogs in dark mode.
- **Modal Focus Light** (`0 24px 64px rgba(0, 0, 0, 0.18)`): Blocking dialogs in light mode.
- **Interactive Lift:** Small 1–8px shadows appear only as a hover or pressed-state response on emphasized actions.

### Named Rules

**The Tonal-at-Rest Rule.** A resting surface should first prove it needs a border, then prove it needs a shadow.

**The Frosted Function Rule.** Apply translucency only where layering, focus, or transition needs to be explained.

## Shapes

The form language is compact and softly squared: working controls use small 5px corners, containers use 8px, and dialogs or major cards use 12px. Full pills are reserved for icon buttons, switches, status chips, badges, and genuinely capsule-shaped actions. Mobile drawers may use a larger 20px exposed edge to reinforce their temporary, sliding nature.

Fine 1px borders carry much of the structure. Selected navigation uses a narrow 3px accent marker rather than turning the whole rail into a bright block.

**The Softened Precision Rule.** Round enough to make interaction approachable, but never so much that every control becomes a bubble or every section becomes a card.

## Components

The component system is compact and exact, softened where interaction requires it. State is carried by color, tone, and restrained motion rather than decorative surfaces.

### Buttons

- **Shape:** Compact action buttons use small corners (5px); icon-only and capsule actions may use full pills.
- **Primary:** Signal Cyan or Operational Blue on the theme's workspace background color, with compact horizontal padding and a 2rem minimum desktop height.
- **Hover / Focus:** Hover may lift by 1px or brighten the existing token; focus uses a 2px accent outline or inset field indicator. Active state compresses to approximately 0.92–0.97 scale.
- **Secondary / Tonal / Danger:** Secondary actions remain transparent until hover, tonal actions use the primary container, and destructive actions use Critical Red with explicit error foregrounds.

### Chips

- **Style:** Compact pills use tonal backgrounds, short labels, and no ambient shadow.
- **State:** Selection or status is expressed by semantic color and concise text; chips do not become decorative badges on every row.

### Cards / Containers

- **Corner Style:** Medium to large corners (8–12px), chosen by surface importance rather than variety.
- **Background:** Tonal panel or raised surface with a fine outline; translucency is limited to selected transition surfaces.
- **Shadow Strategy:** Flat at rest. Use the Elevation vocabulary only for genuinely floating states.
- **Internal Padding:** Typically 16–20px for content containers and 8–12px for compact operational groups.

### Inputs / Fields

- **Style:** Raised field surface, fine outline, 12px corner, and a minimum 42px content height.
- **Focus:** Accent border plus an inset 1px indicator so focus remains visible inside clipped or scrolling containers.
- **Error / Disabled:** Error preserves the same geometry with semantic border and label color; disabled controls use reduced opacity without removing their label.

### Navigation

Desktop navigation is a dense 244px rail with 36px rows, subtle hover tone, and a 3px active marker. At narrow widths it becomes a frosted drawer with 48px touch rows and a dimmed scrim. Labels truncate rather than forcing the shell wider.

### Dialogs and Menus

Blocking dialogs and floating menus use the Frosted Operations Console's strongest depth: near-opaque raised surfaces, restrained blur, a precise outline, and a single clear shadow. Headers remain compact and separated from scrollable content.

### Named Rules

**The Component State Rule.** Every interactive primitive must visibly define rest, hover, focus, active, disabled, and semantic-error behavior where applicable.

## Do's and Don'ts

### Do:

- **Do** use Signal Cyan or Operational Blue as a precise indicator for focus, selection, and primary action.
- **Do** build hierarchy with adjacent tonal surfaces, fine outlines, and compact type before adding elevation.
- **Do** preserve dense desktop workflows while expanding targets for coarse pointers and touch.
- **Do** reserve frosted translucency and strong shadows for floating or transitional layers.
- **Do** use responsive drawers, bounded scrolling, truncation, and progressive disclosure for complex operational content.

### Don't:

- **Don't** create a cheap, glossy look with broad gradients, plastic shine, or indiscriminate blur.
- **Don't** turn every group of content into another rounded card; use rows, sections, dividers, and the stable shell.
- **Don't** spread the primary accent across large backgrounds or use multiple accents to compete for attention.
- **Don't** use pill shapes for ordinary fields, panels, or every action.
- **Don't** add motion that survives reduced-motion mode or delays an operational task.
