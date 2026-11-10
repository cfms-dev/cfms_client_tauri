import { operationalPalette, type ColorPalette } from '$lib/shared/fluent/palettes';

/** Deliberately different colors, never registered or offered to users. */
export const testPalette: ColorPalette = {
  ...operationalPalette,
  id: 'test-forest',
  windowBackdrop: 'solid',
  brand: { ...operationalPalette.brand, 70: '#174b2c', 80: '#21603a', 90: '#2c7449' },
  modes: {
    light: {
      colors: {
        ...operationalPalette.modes.light.colors,
        colorNeutralBackground3: '#eef4ee',
        colorNeutralForeground1: '#183018',
        colorBrandForeground1: '#174b2c',
      },
      surfaces: {
        ...operationalPalette.modes.light.surfaces,
        cfmsDisclaimerBackground: '#eef4ee',
        cfmsPreviewLightCanvas: '#eef4ee',
      },
    },
    dark: {
      colors: {
        ...operationalPalette.modes.dark.colors,
        colorNeutralBackground3: '#19251e',
        colorNeutralForeground1: '#f0fff4',
        colorBrandForeground1: '#b9f6cb',
        colorBrandBackground: '#74d69b',
      },
      surfaces: {
        ...operationalPalette.modes.dark.surfaces,
        cfmsDisclaimerBackground: '#19251e',
        cfmsPreviewDarkCanvas: '#19251e',
      },
    },
  },
};
