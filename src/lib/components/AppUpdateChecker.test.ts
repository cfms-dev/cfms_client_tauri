// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '$lib/i18n';
import AppUpdateChecker from './AppUpdateChecker.svelte';

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(async () => '0.43.0'),
  goto: vi.fn(),
  notificationSuccess: vi.fn(),
  notificationError: vi.fn(),
  appUpdateState: {
    channel: 'stable',
    checked: false,
    checking: false,
    update: null,
    error: null,
    installing: false,
    installed: false,
    installError: null,
    progress: {
      phase: 'idle',
      downloadedBytes: 0,
      totalBytes: null,
      progress: null,
    },
    ensureChannel: vi.fn(async () => 'stable'),
    check: vi.fn(async () => null),
    install: vi.fn(async () => {}),
  },
}));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: mocks.getVersion }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/app-update-state.svelte', () => ({ appUpdateState: mocks.appUpdateState }));
vi.mock('$lib/stores.svelte', () => ({
  notificationStore: {
    success: mocks.notificationSuccess,
    error: mocks.notificationError,
  },
}));

beforeEach(() => {
  locale.set('en');
  mocks.appUpdateState.checking = false;
  mocks.appUpdateState.installing = false;
  mocks.appUpdateState.checked = false;
  mocks.appUpdateState.update = null;
  mocks.appUpdateState.error = null;
  mocks.appUpdateState.installError = null;
  mocks.appUpdateState.progress = {
    phase: 'idle',
    downloadedBytes: 0,
    totalBytes: null,
    progress: null,
  };
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('AppUpdateChecker feature tour action', () => {
  it('does not render the action when no tour callback is supplied', async () => {
    render(AppUpdateChecker);
    await waitFor(() => expect(screen.getByText(/Current version: 0.43.0/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Feature tour' })).toBeNull();
  });

  it('renders the non-emphasized Wand Stars action and invokes its callback', async () => {
    const onOpenFeatureTour = vi.fn();
    const { container } = render(AppUpdateChecker, { props: { onOpenFeatureTour } });
    const button = await screen.findByRole('button', { name: 'Feature tour' });

    expect(button.classList.contains('text-action')).toBe(true);
    expect(container.querySelector('[data-icon="wandStars"]')).toBeTruthy();
    await fireEvent.click(button);
    expect(onOpenFeatureTour).toHaveBeenCalledTimes(1);
  });

  it('matches the update-channel disabled state during update activity', async () => {
    mocks.appUpdateState.checking = true;
    render(AppUpdateChecker, { props: { onOpenFeatureTour: vi.fn() } });

    expect((await screen.findByRole('button', { name: 'Feature tour' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Update Channel' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
