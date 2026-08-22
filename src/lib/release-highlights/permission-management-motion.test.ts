import { describe, expect, it } from 'vitest';
import permissionManagementDark from './animations/v0.46/permission-management.dark.json';
import permissionManagementLight from './animations/v0.46/permission-management.light.json';

type Animation = typeof permissionManagementLight;
type Keyframe = { t: number; s: number[]; e?: number[] };
type AnimatedProperty = { a: number; k: Keyframe[] };

const themes = [
  ['light', permissionManagementLight],
  ['dark', permissionManagementDark],
] as const;

function layer(animation: Animation, name: string) {
  const match = animation.layers.find((candidate) => candidate.nm === name);
  expect(match, `missing ${name} layer`).toBeDefined();
  return match!;
}

function group(animation: Animation, layerName: string, groupName: string) {
  const match = layer(animation, layerName).shapes.find((candidate) => candidate.nm === groupName);
  expect(match, `missing ${groupName} group`).toBeDefined();
  return match!;
}

describe('permission rule workspace motion geometry', () => {
  it.each(themes)('maximizes the %s permission workspace and holds its completed state', (_theme, animation) => {
    const surface = group(animation, 'Permission workspace chrome', 'Permission workspace surface');
    const rectangle = surface.it.find((item) => item.ty === 'rc');
    const size = rectangle?.s as AnimatedProperty;
    const radius = rectangle?.r as AnimatedProperty;

    expect(size.k[0].s).toEqual([660, 420]);
    expect(size.k.find((keyframe) => keyframe.t === 8)?.e).toEqual([900, 540]);
    expect(size.k.at(-1)?.s).toEqual([900, 540]);
    expect(radius.k[0].s).toEqual([18]);
    expect(radius.k.at(-1)?.s).toEqual([8]);

    const completionOpacity = layer(animation, 'Completion badge').ks.o as AnimatedProperty;
    expect(completionOpacity.k[0].s).toEqual([0]);
    expect(completionOpacity.k.at(-1)?.s).toEqual([100]);
  });

  it('keeps light and dark assets structurally identical', () => {
    expect(permissionManagementDark.layers.map(({ nm }) => nm)).toEqual(
      permissionManagementLight.layers.map(({ nm }) => nm),
    );
    for (const lightLayer of permissionManagementLight.layers) {
      const darkLayer = layer(permissionManagementDark as Animation, lightLayer.nm);
      expect(darkLayer.shapes.map(({ nm }) => nm)).toEqual(lightLayer.shapes.map(({ nm }) => nm));
    }
  });
});
