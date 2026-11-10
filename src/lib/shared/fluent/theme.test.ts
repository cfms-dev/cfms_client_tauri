import { describe, expect, it } from 'vitest';
import { darkTheme, fluentTheme, createPaletteTheme } from './theme';
import { colorPalettes } from './palettes';

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function composite(foreground: string, background: string, opacity: number) {
  const channels = (hex: string) => hex.slice(1).match(/../g)!.map(value => parseInt(value, 16));
  const behind = channels(background);
  return '#' + channels(foreground).map((value, index) =>
    Math.round(value * opacity + behind[index] * (1 - opacity)).toString(16).padStart(2, '0'),
  ).join('');
}

describe('Fluent operational themes', () => {
  for (const palette of Object.values(colorPalettes)) {
    for (const mode of ['light', 'dark'] as const) {
      const scheme = `${palette.id}/${mode}`;
      const theme = createPaletteTheme(palette, mode);
      it(scheme + ' keeps working text, errors and primary-action labels legible', () => {
        for (const background of [theme.colorNeutralBackground1, theme.colorNeutralBackground2, theme.colorNeutralBackground3]) {
          for (const text of [theme.colorNeutralForeground1, theme.colorNeutralForeground3, theme.colorBrandForeground1, theme.colorStatusDangerForeground1]) {
            expect(contrast(text, background), text + ' on ' + background).toBeGreaterThanOrEqual(4.5);
          }
        }
        for (const background of [theme.colorBrandBackground, theme.colorBrandBackgroundHover, theme.colorBrandBackgroundPressed]) {
          expect(contrast(theme.colorNeutralForegroundOnBrand, background)).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(theme.colorNeutralForegroundStaticInverted, theme.colorStatusSuccessBackground3)).toBeGreaterThanOrEqual(4.5);
      });

      it(scheme + ' gives emphasized text at least 7:1 contrast on default working surfaces', () => {
        for (const text of [theme.colorBrandForeground1, theme.colorBrandForeground2, theme.colorBrandForegroundLink, theme.colorStatusWarningForeground2]) {
          for (const background of [theme.colorNeutralBackground1, theme.colorNeutralBackground2, theme.colorNeutralBackground3]) {
            expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(7);
          }
        }
      });

      it(scheme + ' preserves text and essential icon contrast through interactive states', () => {
        const backgrounds = [
          theme.colorNeutralBackground1, theme.colorNeutralBackground1Hover,
          theme.colorNeutralBackground1Pressed, theme.colorNeutralBackground1Selected,
          theme.colorSubtleBackgroundHover, theme.colorSubtleBackgroundPressed,
          theme.colorBrandBackground2, theme.colorBrandBackground2Hover, theme.colorBrandBackground2Pressed,
          theme.colorStatusWarningBackground1,
        ];
        for (const background of backgrounds) {
          for (const text of [
            theme.colorBrandForeground1, theme.colorBrandForeground2, theme.colorBrandForeground2Hover,
            theme.colorBrandForeground2Pressed, theme.colorBrandForegroundLink, theme.colorBrandForegroundLinkHover,
            theme.colorBrandForegroundLinkPressed, theme.colorBrandForegroundLinkSelected,
            theme.colorStatusWarningForeground2,
          ]) expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
          for (const icon of [theme.colorStatusWarningForeground1, theme.colorNeutralForeground2, theme.colorCompoundBrandForeground1]) {
            expect(contrast(icon, background), `icon ${icon} on ${background}`).toBeGreaterThanOrEqual(3);
          }
        }
      });

      it(scheme + ' keeps emphasized text readable on composited content, fields, account panels and menus', () => {
        const behind = [theme.colorNeutralBackground3, theme.colorNeutralBackground1Hover, theme.colorBrandBackground2];
        for (const opacity of [0.55, 0.6, 0.84, 0.94]) {
          for (const base of behind) {
            const background = composite(theme.colorNeutralBackground1, base, opacity);
            for (const text of [theme.colorBrandForeground1, theme.colorStatusWarningForeground2]) {
              expect(contrast(text, background), `${text} on ${opacity} material over ${base}`).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
        // Account panels overlay photography; menu acrylic can cover contrasting content.
        for (const opacity of [0.84, 0.94]) {
          for (const base of ['#000000', '#ffffff']) {
            const background = composite(theme.colorNeutralBackground1, base, opacity);
            for (const text of [theme.colorBrandForeground1, theme.colorStatusWarningForeground2]) {
              expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
            }
          }
        }
      });
    }
  }
  it('reduces shadow-root token motion without mutating the normal theme', () => {
    const reduced = fluentTheme({ mode: 'dark', reduceMotion: true });
    expect(reduced.durationNormal).toBe('0.01ms');
    expect(reduced.durationSlow).toBe('0.01ms');
    expect(darkTheme.durationNormal).toBe('200ms');
    expect(reduced.colorBrandBackground).toBe(darkTheme.colorBrandBackground);
  });
});
