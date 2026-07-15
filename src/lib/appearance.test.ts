import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  normalizeColorScheme,
  normalizeReduceMotion,
  resolveColorScheme,
  resolveReducedMotion,
} from './appearance';

describe('appearance preferences', () => {
  it('defaults both appearance preferences to the system settings', () => {
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
  });

  it('normalizes unsupported color schemes', () => {
    expect(normalizeColorScheme('sepia')).toBe('system');
    expect(normalizeReduceMotion('sometimes')).toBe('system');
  });

  it('resolves the system color scheme while preserving explicit choices', () => {
    expect(resolveColorScheme('system', true)).toBe('dark');
    expect(resolveColorScheme('system', false)).toBe('light');
    expect(resolveColorScheme('light', true)).toBe('light');
    expect(resolveColorScheme('dark', false)).toBe('dark');
  });

  it('resolves reduced motion while preserving explicit choices', () => {
    expect(resolveReducedMotion('system', false)).toBe(false);
    expect(resolveReducedMotion('system', true)).toBe(true);
    expect(resolveReducedMotion('always', false)).toBe(true);
    expect(resolveReducedMotion('never', true)).toBe(false);
  });
});
