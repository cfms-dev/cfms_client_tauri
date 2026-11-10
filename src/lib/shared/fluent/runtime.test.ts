import { expect, it, vi } from 'vitest';
import { applyFluentTheme } from './runtime';
import { fluentTheme } from './theme';

const mocks = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock('@fluentui/web-components/theme/set-theme.js', () => mocks);

it.each(['light', 'dark'] as const)('applies the complete %s palette to Fluent shadow roots', mode => {
  const options = { paletteId: 'operational', mode, reduceMotion: true };
  applyFluentTheme(options);
  expect(mocks.setTheme).toHaveBeenCalledWith(fluentTheme(options));
  expect(mocks.setTheme.mock.lastCall![0].durationNormal).toBe('0.01ms');
  expect(mocks.setTheme.mock.lastCall![0].cfmsDisclaimerBackground).toBeDefined();
});
