import { afterEach, describe, expect, it, vi } from 'vitest';
import { inlineNotice, snackbarMotion, snackbarReflow } from '$lib/shared/motion/transitions';


afterEach(() => { delete document.documentElement.dataset.reduceMotion; });

describe('inline notice motion', () => {
  it('expands and fades its content and spacing with direction-specific timing', () => {
    document.documentElement.dataset.reduceMotion = 'false';
    const node = document.createElement('div');
    node.style.cssText = 'display: block; height: 80px; padding: 8px 0 0; margin: 0; border: 0 solid; opacity: 1;';
    document.body.append(node);
    const transition = inlineNotice(node);
    const enter = transition({ direction: 'in' });
    const exit = transition({ direction: 'out' });
    expect(enter.duration).toBe(200);
    expect(exit.duration).toBe(150);
    expect(enter.easing!(0.5)).toBeGreaterThan(0.5);
    expect(exit.easing!(0.5)).toBeLessThan(0.5);
    expect(enter.css!(0, 1)).toContain('height: 0px');
    expect(enter.css!(0, 1)).toContain('padding-top: 0px');
    expect(enter.css!(0.5, 0.5)).toContain('height: 40px');
    expect(enter.css!(0.5, 0.5)).toContain('padding-top: 4px');
    expect(enter.css!(0.5, 0.5)).toContain('opacity: 0.5');
    expect(enter.css!(1, 0)).toContain('height: 80px');
    expect(enter.css!(0.5, 0.5)).toBe(exit.css!(0.5, 0.5));
    expect(enter.css!(0, 1)).not.toMatch(/scale|blur|filter/);
    node.remove();
  });

  it('removes both enter and exit animations for reduced motion', () => {
    document.documentElement.dataset.reduceMotion = 'true';
    const transition = inlineNotice(document.createElement('div'));
    expect(transition({ direction: 'in' })).toEqual({ duration: 0 });
    expect(transition({ direction: 'out' })).toEqual({ duration: 0 });
  });
});

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
