import { describe, expect, it } from 'vitest';
import flexibleWorkspaceDark from './animations/v0.43/flexible-workspace.dark.json';
import flexibleWorkspaceLight from './animations/v0.43/flexible-workspace.light.json';

type Keyframe = { t: number; s: number[] };
type AnimatedProperty = { a: number; k: Keyframe[] };
type Animation = typeof flexibleWorkspaceLight;

const themes = [
  ['light', flexibleWorkspaceLight],
  ['dark', flexibleWorkspaceDark],
] as const;

function layer(animation: Animation, name: string) {
  const match = animation.layers.find((candidate) => candidate.nm === name);
  expect(match, `missing ${name} layer`).toBeDefined();
  return match!;
}

function frameValue(property: AnimatedProperty, frame: number) {
  const keyframe = property.k.find((candidate) => candidate.t === frame);
  expect(keyframe, `missing keyframe ${frame}`).toBeDefined();
  return keyframe!.s;
}

describe('flexible workspace motion geometry', () => {
  it.each(themes)('keeps the resize handle attached to the %s details pane', (_theme, animation) => {
    const detailsPane = layer(animation, 'Details pane');
    const resizeHandle = layer(animation, 'Resize handle');
    const surface = detailsPane.shapes[0].it.find((item) => item.ty === 'rc') as
      | { s: AnimatedProperty }
      | undefined;
    expect(surface).toBeDefined();
    expect(surface!.s.a).toBe(1);

    const surfaceSize = surface!.s as AnimatedProperty;
    const panePosition = detailsPane.ks.p as AnimatedProperty;
    const handlePosition = resizeHandle.ks.p as AnimatedProperty;

    for (const frame of [0, 24, 60, 120]) {
      const [width] = frameValue(surfaceSize, frame);
      const [paneCenter] = frameValue(panePosition, frame);
      const [handleX] = frameValue(handlePosition, frame);
      expect(paneCenter - width / 2).toBe(handleX);
    }
  });

  it.each(themes)('targets the actual maximize control without an oversized %s window', (_theme, animation) => {
    const pointer = layer(animation, 'Interaction pointer');
    const window = layer(animation, 'Resizable window');
    const pointerPosition = pointer.ks.p as AnimatedProperty;
    const windowPosition = window.ks.p as AnimatedProperty;
    const windowScale = window.ks.s as AnimatedProperty;

    const [pointerX, pointerY] = frameValue(pointerPosition, 78);
    const [windowX, windowY] = frameValue(windowPosition, 83);
    const [scaleX, scaleY] = frameValue(windowScale, 83);
    expect(pointerX).toBeCloseTo(windowX + 103 * scaleX / 100, 3);
    expect(pointerY).toBeCloseTo(windowY - 64 * scaleY / 100, 3);

    const maximumScale = windowScale.k.reduce(
      (maximum, keyframe) => Math.max(maximum, ...keyframe.s.slice(0, 2)),
      0,
    );
    expect(maximumScale).toBe(112);
  });
});
