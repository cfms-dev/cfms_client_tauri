import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/svelte';
import { appearanceStore } from '$lib/features/settings/appearance.svelte.ts';
import { fluentTheme } from '$lib/shared/fluent/theme';
import { createMatchMedia } from '../../../test/dom-fixtures';

const mocks = vi.hoisted(() => ({
  nativeTheme: vi.fn().mockResolvedValue(undefined),
  backdrop: vi.fn().mockResolvedValue('solid'),
  fluent: vi.fn(),
}));
vi.mock('$lib/api', () => ({ loadAppearancePreference: vi.fn(), saveAppearancePreference: vi.fn() }));
vi.mock('$lib/api/core', () => ({ setWindowBackdrop: mocks.backdrop }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ setTheme: mocks.nativeTheme }) }));
vi.mock('@fluentui/web-components/theme/set-theme.js', () => ({ setTheme: mocks.fluent }));

afterEach(() => vi.unstubAllGlobals());

it('serializes native theme changes, ignores stale Mica acknowledgements, and disables material in forced colors', async () => {
  const forcedColors = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', (query: string) => query.includes('forced-colors')
    ? forcedColors : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const dispose = appearanceStore.init();
  await waitFor(() => expect(mocks.backdrop).toHaveBeenCalledOnce());
  mocks.backdrop.mockClear();

  let resolveOld!: (mode: string) => void;
  let resolveNew!: (mode: string) => void;
  mocks.backdrop.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
  appearanceStore.apply({ color_scheme: 'light', reduce_motion: 'never' });
  await waitFor(() => expect(mocks.backdrop).toHaveBeenCalledWith('light', true, [243, 243, 243]));
  appearanceStore.apply({ color_scheme: 'dark', reduce_motion: 'always' });
  expect(document.documentElement.dataset.windowBackdrop).toBe('solid');
  resolveOld('mica');
  await waitFor(() => expect(mocks.backdrop).toHaveBeenLastCalledWith('dark', true, [32, 32, 32]));
  expect(document.documentElement.dataset.windowBackdrop).toBe('solid');
  resolveNew('solid');
  await waitFor(() => expect(mocks.fluent).toHaveBeenLastCalledWith(fluentTheme({ mode: 'dark', reduceMotion: true })));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(document.documentElement.dataset.palette).toBe('operational');
  expect(document.documentElement.dataset.reduceMotion).toBe('true');

  forcedColors.matches = true;
  appearanceStore.apply({ color_scheme: 'light', reduce_motion: 'system' });
  await waitFor(() => expect(mocks.backdrop).toHaveBeenLastCalledWith('light', false, [243, 243, 243]));
  dispose();
});

it('uses the native solid fallback when reduced transparency is requested', async () => {
  mocks.backdrop.mockReset().mockResolvedValue('solid');
  const transparency = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', (query: string) => query.includes('reduced-transparency')
    ? transparency : { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const dispose = appearanceStore.init();
  await waitFor(() => expect(mocks.backdrop).toHaveBeenLastCalledWith(expect.any(String), false, expect.any(Array)));
  expect(document.documentElement.dataset.windowBackdrop).toBe('solid');
  transparency.matches = false;
  appearanceStore.apply({ color_scheme: 'dark', reduce_motion: 'system' });
  await waitFor(() => expect(mocks.backdrop).toHaveBeenLastCalledWith('dark', true, [32, 32, 32]));
  dispose();
  expect(transparency.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
});

it('keeps the CSS canvas solid after native failure and can apply the next appearance', async () => {
  mocks.backdrop.mockRejectedValueOnce(new Error('Mica unavailable')).mockResolvedValue('mica');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const dispose = appearanceStore.init();
  await waitFor(() => expect(mocks.backdrop).toHaveBeenCalledOnce());
  expect(document.documentElement.dataset.windowBackdrop).toBe('solid');
  appearanceStore.apply({ color_scheme: 'light', reduce_motion: 'never' });
  await waitFor(() => expect(document.documentElement.dataset.windowBackdrop).toBe('mica'));
  expect(mocks.backdrop).toHaveBeenLastCalledWith('light', true, [243, 243, 243]);
  dispose();
});

it('applies only the newest Fluent theme when changes precede runtime initialization', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const dispose = appearanceStore.init();
  appearanceStore.apply({ color_scheme: 'light', reduce_motion: 'never' });
  appearanceStore.apply({ color_scheme: 'dark', reduce_motion: 'always' });
  await waitFor(() => expect(mocks.fluent).toHaveBeenCalledOnce());
  expect(mocks.fluent).toHaveBeenCalledWith(fluentTheme({ mode: 'dark', reduceMotion: true }));
  await waitFor(() => expect(mocks.backdrop).toHaveBeenCalledOnce());
  expect(mocks.backdrop).toHaveBeenCalledWith('dark', true, [32, 32, 32]);
  dispose();
});

it.each(['light', 'dark'] as const)('restores system following after forcing %s, including subsequent system changes', async (fixedScheme) => {
  let systemPrefersDark = fixedScheme === 'light';
  let nativeOverride: 'light' | 'dark' | null = null;
  const media = Object.assign(new EventTarget(), { matches: systemPrefersDark });
  const updateMedia = () => {
    const matches = nativeOverride === null ? systemPrefersDark : nativeOverride === 'dark';
    if (media.matches === matches) return;
    media.matches = matches;
    media.dispatchEvent(new Event('change'));
  };
  const fallbackMedia = createMatchMedia();
  vi.stubGlobal('matchMedia', (query: string) => query.includes('prefers-color-scheme') ? media : fallbackMedia(query));
  // WebView2 reports the forced window theme through prefers-color-scheme.
  mocks.nativeTheme.mockImplementation(async (theme: 'light' | 'dark' | null) => {
    nativeOverride = theme;
    updateMedia();
  });
  mocks.backdrop.mockResolvedValue('mica');
  appearanceStore.apply({ color_scheme: fixedScheme, reduce_motion: 'never' });
  const dispose = appearanceStore.init();
  const expectAppearance = async (scheme: 'light' | 'dark') => {
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe(scheme);
      expect(document.documentElement.style.colorScheme).toBe(scheme);
      expect(mocks.fluent).toHaveBeenLastCalledWith(fluentTheme({ mode: scheme }));
      expect(mocks.backdrop).toHaveBeenLastCalledWith(scheme, true, scheme === 'dark' ? [32, 32, 32] : [243, 243, 243]);
      expect(document.documentElement.dataset.windowBackdrop).toBe('mica');
    });
  };
  try {
    await expectAppearance(fixedScheme);
    expect(mocks.nativeTheme).toHaveBeenLastCalledWith(fixedScheme);

    mocks.backdrop.mockClear();
    appearanceStore.apply({ color_scheme: 'system', reduce_motion: 'never' });
    await waitFor(() => expect(mocks.nativeTheme).toHaveBeenLastCalledWith(null));
    await expectAppearance(systemPrefersDark ? 'dark' : 'light');
    expect(mocks.backdrop.mock.calls.every(([scheme]) => scheme === (systemPrefersDark ? 'dark' : 'light'))).toBe(true);
    expect(document.documentElement.dataset.colorSchemePreference).toBe('system');

    systemPrefersDark = !systemPrefersDark;
    updateMedia();
    await expectAppearance(systemPrefersDark ? 'dark' : 'light');
    expect(mocks.nativeTheme).toHaveBeenLastCalledWith(null);

    appearanceStore.apply({ color_scheme: fixedScheme, reduce_motion: 'never' });
    await waitFor(() => expect(mocks.nativeTheme).toHaveBeenLastCalledWith(fixedScheme));
    systemPrefersDark = !systemPrefersDark;
    updateMedia();
    await expectAppearance(fixedScheme);

    appearanceStore.apply({ color_scheme: 'light', reduce_motion: 'never' });
    appearanceStore.apply({ color_scheme: 'dark', reduce_motion: 'never' });
    appearanceStore.apply({ color_scheme: 'system', reduce_motion: 'never' });
    await waitFor(() => expect(mocks.nativeTheme).toHaveBeenLastCalledWith(null));
    await expectAppearance(systemPrefersDark ? 'dark' : 'light');
  } finally {
    dispose();
    mocks.nativeTheme.mockReset().mockResolvedValue(undefined);
    mocks.backdrop.mockReset().mockResolvedValue('solid');
  }
});
