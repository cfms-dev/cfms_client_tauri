// Stable semantic names backed by locally bundled Fluent System Icons.
import { ICON_VARIANTS } from './fluent/icons.generated';
export { ICON_VARIANTS };
export type IconName = keyof typeof ICON_VARIANTS;
// Raw SVG strings also serve non-Svelte consumers such as CodeMirror.
export const ICONS = Object.fromEntries(Object.entries(ICON_VARIANTS).map(([key, icon]) => [key, icon.regular])) as Record<IconName, string>;
