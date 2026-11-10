import { afterEach, describe, expect, it, vi } from 'vitest';
import { snackbarMotion, snackbarReflow } from '$lib/shared/motion/transitions';


afterEach(() => { delete document.documentElement.dataset.reduceMotion; });

describe('notification motion', () => {
  it('enters by decelerating and exits by accelerating, without scale or blur', () => {
    document.documentElement.dataset.reduceMotion = 'false';
    const node = document.createElement('div');
    const enter = snackbarMotion(node, {}, { direction: 'in' });
    const exit = snackbarMotion(node, {}, { direction: 'out' });
    expect(enter.duration).toBe(250);
    expect(exit.duration).toBe(150);
    expect(enter.easing!(0.5)).toBeGreaterThan(0.5);
    expect(exit.easing!(0.5)).toBeLessThan(0.5);
    expect(enter.css!(0, 1)).toContain('12px');
    expect(exit.css!(0, 1)).toContain('8px');
    expect(enter.css!(0, 1) + exit.css!(0, 1)).not.toMatch(/scale|blur|filter/);
  });

  it('disables both presence and stack motion for reduced motion', () => {
    document.documentElement.dataset.reduceMotion = 'true';
    const node = document.createElement('div');
    expect(snackbarMotion(node)).toEqual({ duration: 0 });
    const rect = new DOMRect(0, 0, 384, 60);
    expect(snackbarReflow(node, { from: rect, to: rect }).duration).toBe(0);
  });
});
