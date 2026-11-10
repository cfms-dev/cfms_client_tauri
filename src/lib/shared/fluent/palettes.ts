import type { BrandVariants, Theme } from '@fluentui/tokens';
import type { ResolvedColorScheme } from '$lib/shared/appearance';
import { defaultSurfaceColors, type SurfaceColors } from './surface-colors.ts';

/** Palette overrides are colors only; geometry, typography and motion stay shared. */
export type FluentColors = Partial<Pick<Theme, Extract<keyof Theme, `color${string}`>>>;

export interface ColorPalette {
  readonly id: string;
  readonly brand: BrandVariants;
  readonly modes: Record<ResolvedColorScheme, {
    readonly colors: FluentColors;
    readonly surfaces: SurfaceColors;
  }>;
  readonly windowBackdrop: 'mica' | 'solid';
}

// Text needs its own contrast ramp; brand fills and graphic accents keep theirs.
function brandTextColors(rest: string, hover: string, pressed: string) {
  return {
    colorBrandForeground1: rest,
    colorBrandForeground2: rest,
    colorBrandForeground2Hover: hover,
    colorBrandForeground2Pressed: pressed,
    colorBrandForegroundLink: rest,
    colorBrandForegroundLinkHover: hover,
    colorBrandForegroundLinkPressed: pressed,
    colorBrandForegroundLinkSelected: rest,
    colorNeutralForeground2BrandHover: hover,
    colorNeutralForeground2BrandPressed: pressed,
    colorNeutralForeground2BrandSelected: rest,
    colorNeutralForeground3BrandHover: hover,
    colorNeutralForeground3BrandPressed: pressed,
    colorNeutralForeground3BrandSelected: rest,
  };
}

const brand: BrandVariants = {
  10: '#001326', 20: '#00233f', 30: '#003254', 40: '#004269',
  50: '#004577', 60: '#004e8c', 70: '#005a9e', 80: '#0067c0',
  90: '#1976cd', 100: '#3587d7', 110: '#5598e0', 120: '#75aae8',
  130: '#97bdf0', 140: '#b7d2f6', 150: '#d8eaff', 160: '#eff6ff',
};

export const DEFAULT_PALETTE_ID = 'operational';

export const operationalPalette: ColorPalette = {
  id: DEFAULT_PALETTE_ID,
  brand,
  windowBackdrop: 'mica',
  modes: {
    light: {
      colors: {
        ...brandTextColors('#004e8c', '#004577', '#003254'),
        colorBrandBackground2Pressed: '#b7d2f6',
        colorNeutralBackground3: '#f3f3f3',
        colorStrokeFocus2: '#0067c0',
      },
      surfaces: defaultSurfaceColors.light,
    },
    dark: {
      colors: {
        ...brandTextColors('#8fddff', '#b8ebff', '#75d5ff'),
        colorNeutralBackground1: '#292929',
        colorNeutralBackground2: '#252525',
        colorNeutralBackground3: '#202020',
        colorNeutralForeground3: '#d6d6d6',
        colorStatusDangerForeground1: '#ff99a4',
        colorNeutralForegroundOnBrand: '#202020',
        colorBrandBackground: '#60cdff',
        colorBrandBackgroundHover: '#7cd7ff',
        colorBrandBackgroundPressed: '#4bb4df',
        colorBrandBackgroundSelected: '#60cdff',
        colorBrandBackground2: '#173d50',
        colorBrandBackground2Hover: '#1c4b61',
        colorBrandBackground2Pressed: '#153343',
        colorCompoundBrandBackground: '#60cdff',
        colorCompoundBrandBackgroundHover: '#7cd7ff',
        colorCompoundBrandBackgroundPressed: '#4bb4df',
        colorCompoundBrandForeground1: '#60cdff',
        colorCompoundBrandForeground1Hover: '#7cd7ff',
        colorCompoundBrandForeground1Pressed: '#4bb4df',
        colorBrandStroke1: '#60cdff',
        colorBrandStroke2: '#30677f',
        colorCompoundBrandStroke: '#60cdff',
        colorCompoundBrandStrokeHover: '#7cd7ff',
        colorCompoundBrandStrokePressed: '#4bb4df',
        colorStrokeFocus2: '#60cdff',
      },
      surfaces: defaultSurfaceColors.dark,
    },
  },
};

/** Add reviewed, paired light/dark palettes here. No user preference is stored yet. */
export const colorPalettes: Readonly<Record<string, ColorPalette>> = {
  [DEFAULT_PALETTE_ID]: operationalPalette,
};
