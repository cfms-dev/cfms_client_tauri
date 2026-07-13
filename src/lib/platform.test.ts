import { describe, expect, it } from 'vitest';
import { supportsKeyboardShortcuts } from './platform';

describe('keyboard shortcut platform support', () => {
  it.each(['windows', 'macos', 'linux'] as const)('is available on %s', (platform) => {
    expect(supportsKeyboardShortcuts(platform)).toBe(true);
  });

  it.each(['android', 'ios'] as const)('is hidden on %s', (platform) => {
    expect(supportsKeyboardShortcuts(platform)).toBe(false);
  });
});
