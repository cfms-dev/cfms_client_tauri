import { createLightTheme, createDarkTheme, type Theme } from '@fluentui/tokens';
import type { ResolvedColorScheme } from '$lib/shared/appearance';
import { colorPalettes, DEFAULT_PALETTE_ID, type ColorPalette } from './palettes.ts';
import type { SurfaceColors } from './surface-colors';

export const UI_FONT = '"Noto Sans", "Noto Sans SC", sans-serif';
export const SERIF_FONT = '"Noto Serif", "Noto Serif SC", serif';
export const MONO_FONT = '"JetBrains Mono", "Noto Sans SC", monospace';

const common = {
  fontFamilyBase: UI_FONT,
  fontFamilyNumeric: UI_FONT,
  fontFamilyMonospace: MONO_FONT,
  borderRadiusLarge: '8px',
  lineHeightBase500: '26px',
};

export type AppTheme = Theme & SurfaceColors;
export interface ThemeOptions {
  paletteId?: string;
  mode: ResolvedColorScheme;
  reduceMotion?: boolean;
}

/** Pure assembly shared by static CSS, runtime and palette validation. */
export function createPaletteTheme(palette: ColorPalette, mode: ResolvedColorScheme, reduceMotion = false): AppTheme {
  const colors = palette.modes[mode];
  const theme: AppTheme = {
    ...(mode === 'dark' ? createDarkTheme(palette.brand) : createLightTheme(palette.brand)),
    ...common,
    ...colors.colors,
    ...colors.surfaces,
  };
  if (!reduceMotion) return theme;
  return Object.fromEntries(Object.entries(theme).map(([key, value]) =>
    [key, key.startsWith('duration') ? '0.01ms' : value],
  )) as AppTheme;
}

// Fluent retains theme objects in its stylesheet cache; reuse registered themes
// rather than allocating another object on every appearance notification.
const runtimeThemes = new Map<string, AppTheme>();

export function fluentTheme({ paletteId = DEFAULT_PALETTE_ID, mode, reduceMotion = false }: ThemeOptions): AppTheme {
  const key = `${paletteId}/${mode}/${reduceMotion}`;
  let theme = runtimeThemes.get(key);
  if (!theme) {
    theme = createPaletteTheme(colorPalettes[paletteId], mode, reduceMotion);
    runtimeThemes.set(key, theme);
  }
  return theme;
}

export const lightTheme = fluentTheme({ mode: 'light' });
export const darkTheme = fluentTheme({ mode: 'dark' });

/** The native window requires an opaque RGB canvas, matching the CSS fallback. */
export function windowBackground(theme: AppTheme): [number, number, number] {
  const color = theme.colorNeutralBackground3;
  if (!/^#[\da-f]{6}$/i.test(color)) {
    throw new Error('Palette colorNeutralBackground3 must be an opaque #RRGGBB color.');
  }
  return [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16)) as [number, number, number];
}

export function paletteWindowAppearance(palette: ColorPalette, mode: ResolvedColorScheme, allowMaterial: boolean) {
  return {
    enabled: palette.windowBackdrop === 'mica' && allowMaterial,
    solidColor: windowBackground(createPaletteTheme(palette, mode)),
  };
}
