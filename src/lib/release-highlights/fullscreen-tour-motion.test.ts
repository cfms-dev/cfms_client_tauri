import { describe, expect, it } from 'vitest';
import fullscreenTourDark from './animations/v0.45/fullscreen-tour.dark.json';
import fullscreenTourLight from './animations/v0.45/fullscreen-tour.light.json';

type Animation = typeof fullscreenTourLight;
type Keyframe = { t: number; s: number[]; e?: number[] };
type AnimatedProperty = { a: number; k: Keyframe[] };

const themes = [
  ['light', fullscreenTourLight],
  ['dark', fullscreenTourDark],
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

function animatedRectProperty(
  animation: Animation,
  layerName: string,
  groupName: string,
  property: 's' | 'r',
) {
  const rectangle = group(animation, layerName, groupName).it.find((item) => item.ty === 'rc');
  expect(rectangle, `missing ${groupName} rectangle`).toBeDefined();
  return rectangle![property] as AnimatedProperty;
}

describe('full-screen feature tour motion geometry', () => {
  it.each(themes)('expands the %s tour surface to the application bounds and holds there', (_theme, animation) => {
    const size = animatedRectProperty(animation, 'Tour chrome', 'Tour surface', 's').k;
    const radius = animatedRectProperty(animation, 'Tour chrome', 'Tour surface', 'r').k;

    expect(size[0].s).toEqual([620, 370]);
    expect(size.find((keyframe) => keyframe.t === 24)?.e).toEqual([900, 540]);
    expect(size.at(-1)?.s).toEqual([900, 540]);
    expect(radius[0].s).toEqual([18]);
    expect(radius.at(-1)?.s).toEqual([0]);
  });

  it('keeps light and dark assets structurally identical', () => {
    expect(fullscreenTourDark.layers.map(({ nm }) => nm)).toEqual(
      fullscreenTourLight.layers.map(({ nm }) => nm),
    );
    for (const lightLayer of fullscreenTourLight.layers) {
      const darkLayer = layer(fullscreenTourDark as Animation, lightLayer.nm);
      expect(darkLayer.shapes.map(({ nm }) => nm)).toEqual(lightLayer.shapes.map(({ nm }) => nm));
    }
  });
});
