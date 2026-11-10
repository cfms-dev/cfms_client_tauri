import type { ResolvedColorScheme } from '$lib/shared/appearance';

// Dedicated painted surfaces retain their established appearance. These names
// describe colors, never component geometry or behavior.
const previewColors = {
  cfmsPreviewLightCanvas: '#f3f3f3',
  cfmsPreviewLightChrome: '#fafafa',
  cfmsPreviewLightLine: '#d7d7d7',
  cfmsPreviewLightRail: '#e5e5e5',
  cfmsPreviewDarkCanvas: '#17191d',
  cfmsPreviewDarkContent: '#0f1115',
  cfmsPreviewDarkChrome: '#20232a',
  cfmsPreviewDarkLine: '#343840',
  cfmsPreviewBorder: 'rgb(128 128 128 / 0.28)',
  cfmsPreviewSystemBorder: 'rgb(82 94 108 / 0.68)',
  cfmsPreviewSystemLightGlow: 'rgb(255 255 255 / 0.9)',
  cfmsPreviewSystemDarkGlow: 'rgb(52 64 80 / 0.9)',
  cfmsPreviewSystemLightStart: '#e8edf2',
  cfmsPreviewSystemLightEnd: '#d9e0e7',
  cfmsPreviewSystemMiddleLight: '#aab4bf',
  cfmsPreviewSystemMiddleDark: '#65717e',
  cfmsPreviewSystemDarkStart: '#323c48',
  cfmsPreviewSystemDarkEnd: '#1a2028',
  cfmsPreviewSystemLightOrb: 'rgb(255 255 255 / 0.72)',
  cfmsPreviewSystemDarkOrb: 'rgb(38 48 62 / 0.72)',
  cfmsPreviewSystemOrbBorder: 'rgb(121 195 255 / 0.16)',
  cfmsPreviewWindowLightBorder: 'rgb(25 34 44 / 0.15)',
  cfmsPreviewWindowLightLine: '#adb4bd',
  cfmsPreviewWindowLightBackground: '#f8fafc',
  cfmsPreviewWindowDarkBorder: 'rgb(255 255 255 / 0.13)',
  cfmsPreviewWindowDarkLine: '#586373',
  cfmsPreviewWindowDarkBackground: '#171c23',
};

const disclaimerLight = {
  cfmsDisclaimerBackground: '#f3f3f3',
  cfmsDisclaimerText: '#3f3f46',
  cfmsDisclaimerTextStrong: '#18181b',
  cfmsDisclaimerTextMuted: '#5d5d66',
  cfmsDisclaimerDivider: 'rgba(0, 0, 0, 0.14)',
  cfmsDisclaimerButton: '#d8eaff',
  cfmsDisclaimerAccent: '#005a9e',
  cfmsDisclaimerOutline: 'rgba(0, 0, 0, 0.22)',
  cfmsDisclaimerWarning: '#fff04f',
};

export type SurfaceColors = Record<keyof typeof previewColors | keyof typeof disclaimerLight, string>;

export const defaultSurfaceColors: Record<ResolvedColorScheme, SurfaceColors> = {
  light: { ...previewColors, ...disclaimerLight },
  dark: {
    ...previewColors,
    cfmsDisclaimerBackground: '#11161d',
    cfmsDisclaimerText: 'rgba(248, 250, 252, 0.88)',
    cfmsDisclaimerTextStrong: 'rgba(248, 250, 252, 0.9)',
    cfmsDisclaimerTextMuted: 'rgba(248, 250, 252, 0.78)',
    cfmsDisclaimerDivider: 'rgba(226, 232, 240, 0.25)',
    cfmsDisclaimerButton: '#191e25',
    cfmsDisclaimerAccent: '#b9c5ff',
    cfmsDisclaimerOutline: 'rgba(248, 250, 252, 0.24)',
    cfmsDisclaimerWarning: '#fff04f',
  },
};
