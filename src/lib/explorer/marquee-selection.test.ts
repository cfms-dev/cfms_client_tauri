import { describe, expect, it } from 'vitest';
import { createMarqueeRect, marqueeAutoScrollDelta, marqueeRowRange } from './marquee-selection';

describe('marquee selection geometry', () => {
  it('normalizes a rectangle dragged in any direction', () => {
    expect(createMarqueeRect({ x: 80, y: 70 }, { x: 20, y: 10 })).toEqual({
      left: 20,
      top: 10,
      right: 80,
      bottom: 70,
      width: 60,
      height: 60,
    });
  });

  it('ramps auto-scroll toward either viewport edge', () => {
    expect(marqueeAutoScrollDelta(50, 0, 200)).toBe(0);
    expect(marqueeAutoScrollDelta(20, 0, 200)).toBe(-9);
    expect(marqueeAutoScrollDelta(190, 0, 200)).toBe(14);
    expect(marqueeAutoScrollDelta(240, 0, 200)).toBe(18);
  });

  it('resolves rows beyond the rendered viewport from content coordinates', () => {
    expect(marqueeRowRange({ top: 196, bottom: 476 }, 36, 40, 500)).toEqual({
      start: 3,
      end: 11,
    });
    expect(marqueeRowRange({ top: 900, bottom: 980 }, 36, 40, 4)).toBeNull();
  });
});
