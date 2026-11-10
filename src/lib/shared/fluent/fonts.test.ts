import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lightTheme, darkTheme, SERIF_FONT } from './theme';

const directory = resolve('static/fonts');
const css = readFileSync(resolve(directory, 'fonts.css'), 'utf8');
const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(match => match[1]);

describe('bundled offline typography', () => {
  it('ships every referenced WOFF2 slice and each family license without a runtime CDN', () => {
    expect(css).not.toMatch(/https?:\/\//);
    const urls = [...css.matchAll(/url\(\.\/([^)]*)\)/g)].map(match => match[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const filename of urls) {
      expect(readFileSync(resolve(directory, filename)).toString('ascii', 0, 4)).toBe('wOF2');
    }
    for (const family of ['noto-sans', 'noto-sans-sc', 'noto-serif', 'noto-serif-sc', 'jetbrains-mono']) {
      expect(existsSync(resolve(directory, `${family}-OFL.txt`))).toBe(true);
    }
  });

  it.each(['Noto Sans', 'Noto Sans SC', 'Noto Serif', 'Noto Serif SC', 'JetBrains Mono'])(
    '%s has real regular, semibold and bold weights', family => {
      const familyFaces = faces.filter(face => face.includes(`font-family: '${family}';`));
      expect(familyFaces.length).toBeGreaterThan(0);
      const minimumWeight = family === 'Noto Sans' || family === 'Noto Sans SC' ? 300 : 400;
      expect(familyFaces.every(face => face.includes(`font-weight: ${minimumWeight} 800;`))).toBe(true);
    },
  );

  it.each(['Noto Sans SC', 'Noto Serif SC'])('%s includes dynamic Chinese text beyond fixed interface copy', family => {
    const ranges = faces.filter(face => face.includes(`font-family: '${family}';`))
      .flatMap(face => face.match(/unicode-range: ([^;]+);/)?.[1].split(',') ?? []);
    for (const character of '龘罕见文件名') {
      const codepoint = character.codePointAt(0)!;
      expect(ranges.some(range => {
        const [start, end = start] = range.trim().replace(/^U\+/i, '').split('-').map(value => parseInt(value, 16));
        return codepoint >= start && codepoint <= end;
      }), character).toBe(true);
    }
  });

  it('uses the same Noto base and numeric stacks in both Fluent themes and preserves a separate serif stack', () => {
    for (const theme of [lightTheme, darkTheme]) {
      expect(theme.fontFamilyBase).toBe('"Noto Sans", "Noto Sans SC", sans-serif');
      expect(theme.fontFamilyNumeric).toBe(theme.fontFamilyBase);
      expect(theme.fontFamilyMonospace).toContain('JetBrains Mono');
    }
    expect(SERIF_FONT).toBe('"Noto Serif", "Noto Serif SC", serif');
  });
});
