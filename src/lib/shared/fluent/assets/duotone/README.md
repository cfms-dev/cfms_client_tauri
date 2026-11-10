# Menu duotone icons

These SVGs are derived from the Regular outlines of `folder_add`,
`folder_arrow_up`, `folder_arrow_right`, `copy`, `shield_settings`,
`password_reset`, and `person_circle` in the pinned
`@fluentui/svg-icons` 1.1.344 package ([Microsoft Fluent System Icons](https://github.com/microsoft/fluentui-system-icons)).
They retain the original geometry and expose the main subject and supporting detail
as explicit primary and secondary paths. Both 20px and 24px outlines are used where available;
`password_reset` retains its upstream 48px viewBox and scales to either size.
Relative initial moves in extracted details are expressed as equivalent
absolute moves so they can stand alone. Counter paths stay with their outlines.

The channels are `--cfms-icon-primary` and `--cfms-icon-secondary`, both falling
back to `currentColor`. Primary identifies the folder, shield, password panel,
front copy sheet, or person. Secondary identifies the folder badge, settings gear,
reset arrow, rear copy sheet, or avatar ring. The generator's `primaryTone`
metadata preserves the normal palette: copy and person use brand primary with
neutral secondary; the other icons use neutral primary with brand secondary.
Brand graphics use `colorCompoundBrandForeground1`, independently of text colors.

`Icon.svelte` opts into these channels with `duotone`. Its warning tone always
paints the primary subject with `colorStatusWarningForeground1` and the secondary
detail with `colorNeutralForeground2`. Warning labels separately use the more
legible `colorStatusWarningForeground2`. Forced colors restore monochrome system
foregrounds. Menus opt out of duotone for disabled and dangerous actions.
These are locally composed variants, not official Fluent Color artwork.

Keep both sizes in sync when updating the pinned upstream outlines. The icon
generator imports these authored files without inspecting or splitting paths.
Microsoft's MIT license is included in this directory.
