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

  it.each(themes)(
    'keeps the $theme document download choreography bounded and loop-safe',
    async (theme) => {
      const assetPath = path.join(
        process.cwd(),
        'src', 'lib', 'release-highlights', 'animations', 'v0.43',
        `document-download.${theme}.json`,
      );
      const animation = JSON.parse(await readFile(assetPath, 'utf8')) as {
        layers: Array<{
          nm: string;
          ks: Record<string, { a: number; k: unknown }>;
          shapes: Array<{ nm: string }>;
        }>;
      };
      const layer = (name: string) => {
        const match = animation.layers.find((candidate) => candidate.nm === name);
        expect(match, `missing ${name} layer`).toBeDefined();
        return match!;
      };

      expect(animation.layers.map((candidate) => candidate.nm)).toEqual([
        'Completed transfer',
        'Verification check',
        'Verification badge',
        'Verification content',
        'Download action feedback',
        'Typed segment three',
        'Typed segment two',
        'Typed segment one',
        'Download dialog',
        'Download entry highlight',
        'Application shell',
      ]);
      expect(layer('Download dialog').shapes.map((shape) => shape.nm)).toEqual([
        'Download arrow head',
        'Download arrow shaft',
        'Download button',
        'ID field',
        'Field label',
        'Dialog close',
        'Dialog title',
        'Dialog surface',
      ]);

      const completedPosition = layer('Completed transfer').ks.p.k as Array<{ s: number[] }>;
      expect(completedPosition[0].s).toEqual([540, 440, 0]);
      expect(completedPosition.at(-1)!.s).toEqual([540, 440, 0]);
      expect([540 - 430 / 2, 540 + 430 / 2, 440 - 70 / 2, 440 + 70 / 2]).toEqual([
        325, 755, 405, 475,
      ]);

      const dialog = layer('Download dialog');
      expect(dialog.ks.a.k).toEqual([540, 300, 0]);
      const dialogPosition = dialog.ks.p.k as Array<{ s: number[] }>;
      expect(dialogPosition.some((keyframe) => keyframe.s[1] === 300)).toBe(true);
      expect([540 - 430 / 2, 540 + 430 / 2, 300 - 270 / 2, 300 + 270 / 2]).toEqual([
        325, 755, 165, 435,
      ]);

      const visitAnimatedProperties = (value: unknown, pathName = 'animation') => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
          value.forEach((item, index) => visitAnimatedProperties(item, `${pathName}[${index}]`));
          return;
        }
        const property = value as Record<string, unknown>;
        if (property.a === 1 && Array.isArray(property.k)) {
          const keyframes = property.k as Array<{ s?: unknown }>;
          expect(keyframes.at(-1)?.s, `${pathName} must close its loop`).toEqual(keyframes[0]?.s);
        }
        Object.entries(property).forEach(([key, child]) =>
          visitAnimatedProperties(child, `${pathName}.${key}`));
      };
      visitAnimatedProperties(animation);
    },
  );

  it.each(themes)(
    'keeps the $theme diagnostics scan bounded and its loop seam closed',
    async (theme) => {
      const assetPath = path.join(
        process.cwd(),
        'src', 'lib', 'release-highlights', 'animations', 'v0.43',
        `server-diagnostics.${theme}.json`,
      );
      const animation = JSON.parse(await readFile(assetPath, 'utf8')) as {
        layers: Array<{
          nm: string;
          ks: Record<string, { a: number; k: unknown }>;
          shapes: Array<{
            nm: string;
            it: Array<{ ty: string; s?: { k: number[] } }>;
          }>;
        }>;
      };
      const layer = (name: string) => {
        const match = animation.layers.find((candidate) => candidate.nm === name);
        expect(match, `missing ${name} layer`).toBeDefined();
        return match!;
      };
      const animatedEndpoints = (property: { k: unknown }) => {
        const keyframes = property.k as Array<{ s: number[] }>;
        return [keyframes[0].s, keyframes.at(-1)!.s];
      };

      const scan = layer('Diagnostics scan');
      expect(scan.shapes.map((shape) => shape.nm)).toEqual(['Scan line']);

      const progress = layer('Loading progress');
      const progressShape = progress.shapes.find((shape) => shape.nm === 'Progress fill');
      const progressRect = progressShape?.it.find((item) => item.ty === 'rc');
      const progressWidth = progressRect?.s?.k[0];
      const [progressX] = progress.ks.p.k as number[];
      const [anchorX] = progress.ks.a.k as number[];
      expect(progressWidth).toBe(448);
      expect([
        progressX - progressWidth! / 2 - anchorX,
        progressX + progressWidth! / 2 - anchorX,
      ]).toEqual([346, 794]);

      for (const name of [
        'Extensions status',
        'Components status',
        'Runtime status',
        'Server status',
        'Diagnostics scan',
        'Loading progress',
      ]) {
        const animatedLayer = layer(name);
        for (const propertyName of ['o', 'p', 's']) {
          const property = animatedLayer.ks[propertyName];
          if (property.a === 1) {
            const [first, last] = animatedEndpoints(property);
            expect(last, `${name}.${propertyName} must close its loop`).toEqual(first);
          }
        }
      }
    },
  );

  it.each(themes)(
    'keeps the $theme administration selection coherent and its loop seam closed',
    async (theme) => {
      const assetPath = path.join(
        process.cwd(),
        'src', 'lib', 'release-highlights', 'animations', 'v0.43',
        `account-administration.${theme}.json`,
      );
      const animation = JSON.parse(await readFile(assetPath, 'utf8')) as {
        layers: Array<{
          nm: string;
          ks: Record<string, { a: number; k: unknown }>;
          shapes: Array<{ nm: string }>;
        }>;
      };
      const layer = (name: string) => {
        const match = animation.layers.find((candidate) => candidate.nm === name);
        expect(match, `missing ${name} layer`).toBeDefined();
        return match!;
      };
      const animatedEndpoints = (property: { k: unknown }) => {
        const keyframes = property.k as Array<{ s: number[] }>;
        return [keyframes[0].s, keyframes.at(-1)!.s];
      };

      expect(layer('Selection highlight').shapes.map((shape) => shape.nm)).toEqual([
        'Selected account row',
        'Selected account marker',
      ]);
      expect(layer('Selected account content').shapes.map((shape) => shape.nm)).toEqual([
        'Selected avatar',
        'Selected name',
        'Selected metadata',
      ]);

      for (const animatedLayer of animation.layers) {
        for (const propertyName of ['o', 'p', 's']) {
          const property = animatedLayer.ks[propertyName];
          if (property.a === 1) {
            const [first, last] = animatedEndpoints(property);
            expect(
              last,
              `${animatedLayer.nm}.${propertyName} must close its loop`,
            ).toEqual(first);
          }
        }
      }
    },
  );
});
