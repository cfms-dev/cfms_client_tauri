import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testPalette } from '../../../test/palette';
import { colorPalettes, operationalPalette } from './palettes';
import { createPaletteTheme, fluentTheme, paletteWindowAppearance, windowBackground } from './theme';
import { generateThemeCss } from './theme-css';

function themeBlocks(css: string) {
  return [...css.matchAll(/(html[^{}]+) \{\n([^}]+)\}/g)].filter(([, selector]) => !selector.includes('reduce-motion'));
}

describe('palette assembly and generated CSS', () => {
  it.each(['light', 'dark'] as const)('%s accepts complete colors without changing shared typography and geometry', mode => {
    const theme = createPaletteTheme(testPalette, mode);
    const original = fluentTheme({ mode });
    expect(theme.colorNeutralBackground3).toBe(mode === 'light' ? '#eef4ee' : '#19251e');
    expect(theme.colorNeutralForeground1).toBe(mode === 'light' ? '#183018' : '#f0fff4');
    expect(theme.colorBrandForeground1).toBe(mode === 'light' ? '#174b2c' : '#b9f6cb');
    expect(theme.colorBrandBackground).toBe(mode === 'light' ? '#21603a' : '#74d69b');
    expect(theme.cfmsDisclaimerBackground).toBe(theme.colorNeutralBackground3);
    expect(theme.fontFamilyBase).toBe(original.fontFamilyBase);
    expect(theme.borderRadiusLarge).toBe(original.borderRadiusLarge);
    expect(theme.durationNormal).toBe(original.durationNormal);
    expect(colorPalettes[testPalette.id]).toBeUndefined();
  });

  it('emits both modes of each supplied palette and only matches the requested palette', () => {
    const palettes = [operationalPalette, testPalette];
    const blocks = themeBlocks(generateThemeCss(palettes));
    expect(blocks).toHaveLength(4);
    const root = document.createElement('html');
    for (const palette of palettes) {
      for (const mode of ['light', 'dark'] as const) {
        root.dataset.palette = palette.id;
        root.dataset.theme = mode;
        const matching = blocks.filter(([, selector]) => root.matches(selector));
        expect(matching).toHaveLength(1);
        const values = Object.fromEntries([...matching[0][2].matchAll(/  --([^:]+): ([^;]+);/g)].map(([, key, value]) => [key, value]));
        expect(values).toEqual(Object.fromEntries(Object.entries(createPaletteTheme(palette, mode)).map(([key, value]) => [key, String(value)])));
      }
    }
    delete root.dataset.palette;
    expect(blocks.filter(([, selector]) => root.matches(selector))).toHaveLength(1);
    expect(blocks.find(([, selector]) => root.matches(selector))![1]).toContain('operational');
  });

  it('ships exactly the static CSS used by the runtime palette factory', () => {
    expect(readFileSync('src/lib/shared/fluent/theme.css', 'utf8')).toBe(generateThemeCss());
  });

  it('reduces every duration while leaving the palette and normal theme intact', () => {
    const before = structuredClone(testPalette);
    const reduced = createPaletteTheme(testPalette, 'dark', true);
    for (const [key, value] of Object.entries(reduced)) {
      if (key.startsWith('duration')) expect(value).toBe('0.01ms');
    }
    expect(reduced.colorBrandBackground).toBe('#74d69b');
    expect(createPaletteTheme(testPalette, 'dark').durationNormal).toBe('200ms');
    expect(testPalette).toEqual(before);
  });
});

describe('palette window materials', () => {
  it('allows Mica only for opted-in palettes and respects accessibility material restrictions', () => {
    expect(paletteWindowAppearance(operationalPalette, 'light', true)).toEqual({ enabled: true, solidColor: [243, 243, 243] });
    expect(paletteWindowAppearance(operationalPalette, 'dark', false)).toEqual({ enabled: false, solidColor: [32, 32, 32] });
    expect(paletteWindowAppearance(testPalette, 'light', true)).toEqual({ enabled: false, solidColor: [238, 244, 238] });
    expect(paletteWindowAppearance(testPalette, 'dark', true)).toEqual({ enabled: false, solidColor: [25, 37, 30] });
  });

  it('requires an opaque native canvas instead of silently losing color or alpha', () => {
    const theme = createPaletteTheme(testPalette, 'dark');
    expect(() => windowBackground({ ...theme, colorNeutralBackground3: 'transparent' })).toThrow('#RRGGBB');
  });
});
