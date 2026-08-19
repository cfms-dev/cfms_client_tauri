import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { releaseTours } from './catalog';

const assetNames = [
  ['document-id-download', 'document-download'],
  ['flexible-workspace', 'flexible-workspace'],
  ['server-diagnostics', 'server-diagnostics'],
  ['account-administration', 'account-administration'],
] as const;
const themes = ['light', 'dark'] as const;

describe('release highlight animation assets', () => {
  it.each(assetNames.flatMap(([highlightId, assetName]) =>
    themes.map((theme) => ({ highlightId, assetName, theme }))))(
    'ships a compact, expression-free $theme animation for $highlightId',
    async ({ assetName, theme }) => {
      const assetPath = path.join(
        process.cwd(),
        'src', 'lib', 'release-highlights', 'animations', 'v0.43',
        `${assetName}.${theme}.json`,
      );
      const [content, metadata] = await Promise.all([readFile(assetPath, 'utf8'), stat(assetPath)]);
      const animation = JSON.parse(content) as {
        fr: number;
        ip: number;
        op: number;
        w: number;
        h: number;
        assets: unknown[];
        layers: Array<{ ty: number }>;
      };

      expect(animation).toMatchObject({ fr: 30, ip: 0, op: 120, w: 960, h: 600, assets: [] });
      expect(animation.layers.length).toBeGreaterThan(0);
      expect(animation.layers.every((layer) => layer.ty === 4)).toBe(true);
      expect(content).not.toMatch(/(?:(?:"x"\s*:\s*")|expression|data:image|https?:\/\/)/u);
      expect(metadata.size).toBeLessThan(50 * 1024);
    },
  );

  it.each(releaseTours.flatMap((tour) => tour.highlights))(
    'loads both bundled theme modules for $id',
    async (highlight) => {
      const [light, dark] = await Promise.all([
        highlight.animation.light(),
        highlight.animation.dark(),
      ]);

      expect(light.default).toMatchObject({ fr: 30, w: 960, h: 600 });
      expect(dark.default).toMatchObject({ fr: 30, w: 960, h: 600 });
      expect(light.default).not.toEqual(dark.default);
    },
  );
});
