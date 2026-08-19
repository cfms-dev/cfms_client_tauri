import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { releaseTours } from './catalog';

describe('release highlight animation assets', () => {
  it.each(releaseTours.flatMap((tour) => tour.highlights))(
    'ships a compact, expression-free vector animation for $id',
    async (highlight) => {
      const assetPath = path.join(process.cwd(), 'static', highlight.animationSrc.replace(/^\//u, ''));
      const [content, metadata] = await Promise.all([readFile(assetPath, 'utf8'), stat(assetPath)]);
      const animation = JSON.parse(content) as {
        fr: number;
        w: number;
        h: number;
        assets: unknown[];
        layers: Array<{ ty: number }>;
      };

      expect(animation).toMatchObject({ fr: 60, w: 512, h: 512, assets: [] });
      expect(animation.layers.length).toBeGreaterThan(0);
      expect(animation.layers.every((layer) => layer.ty === 4)).toBe(true);
      expect(content).not.toMatch(/(?:"x"\s*:\s*"|expression|data:image|https?:\/\/)/u);
      expect(metadata.size).toBeLessThan(50 * 1024);
    },
  );
});
