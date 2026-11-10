// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '$lib/shared/i18n';
import type { AppUpdateMetadata, UpdateProgressSnapshot } from '$lib/api/updates';
import type { UpdateCheckPause } from '$lib/features/updates/update-check-pause';
import AppUpdateChecker from '$lib/features/updates/AppUpdateChecker.svelte';

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  relaunchApp: vi.fn(),
  notificationSuccess: vi.fn(),
  notificationError: vi.fn(),
  appUpdateState: {
    channel: 'stable',
    automaticCheckPause: { mode: 'active' } as UpdateCheckPause,
    isAutomaticCheckPaused: false,
    automaticCheckSettled: false,
    checked: false,
    checking: false,
    update: null as AppUpdateMetadata | null,
    error: null,
    installing: false,
    installed: false,
    installError: null,
    progress: {
      phase: 'idle',
      downloadedBytes: 0,
      totalBytes: null,
      progress: null,
    } as UpdateProgressSnapshot,
    ensureChannel: vi.fn(async () => 'stable'),
    ensureAutomaticCheckPause: vi.fn(async () => ({ mode: 'active' } as const)),
    check: vi.fn(async () => null),
    install: vi.fn(async () => {}),
  },
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/features/updates/app-update-state.svelte.ts', () => ({ appUpdateState: mocks.appUpdateState }));
vi.mock('$lib/api/updates', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api/updates')>(),
  relaunchApp: mocks.relaunchApp,
}));
vi.mock('$lib/shared/notifications/notifications.svelte', () => ({
  notificationStore: {
    success: mocks.notificationSuccess,
    error: mocks.notificationError,
  }
}));

beforeEach(() => {
  locale.set('en');
  mocks.appUpdateState.checking = false;
  mocks.appUpdateState.automaticCheckPause = { mode: 'active' };
  mocks.appUpdateState.isAutomaticCheckPaused = false;
  mocks.appUpdateState.installing = false;
  mocks.appUpdateState.installed = false;
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

const availableUpdate = {
  currentVersion: '0.43.0',
  version: '0.44.0',
  date: '2026-08-25T00:00:00Z',
  body: null,
  channel: 'stable' as const,
  releaseUrl: 'https://example.com/releases/0.44.0',
  installMode: 'desktop' as const,
};

function renderChecker(onOpenFeatureTour?: () => void | Promise<void>) {
  return render(AppUpdateChecker, {
    props: {
      currentVersion: '0.43.0',
      currentVersionLoaded: true,
      protocolVersion: 24,
      protocolVersionLoaded: true,
      onOpenFeatureTour,
    },
  });
}

describe('AppUpdateChecker', () => {
  it('uses the supplied version as accessible context and emphasizes checking while idle', async () => {
    renderChecker();

    await waitFor(() => expect(screen.getByText('Stable')).toBeTruthy());
    expect(mocks.appUpdateState.ensureChannel).toHaveBeenCalledOnce();
    expect(screen.getByText('Current version')).toBeTruthy();
    expect(screen.getByText('0.43.0')).toBeTruthy();
    expect(screen.getByText('Protocol Version')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('Not checked yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check for Updates' }).classList.contains('primary-action')).toBe(true);
  });

  it('does not render the feature tour action when no callback is supplied', async () => {
    renderChecker();
    await waitFor(() => expect(mocks.appUpdateState.ensureChannel).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: 'Feature tour' })).toBeNull();
  });

  it('renders the non-emphasized Wand Stars action and invokes its callback', async () => {
    const onOpenFeatureTour = vi.fn();
    const { container } = renderChecker(onOpenFeatureTour);
    const button = await screen.findByRole('button', { name: 'Feature tour' });

    expect(button.classList.contains('text-action')).toBe(true);
    expect(container.querySelector('[data-icon="wandStars"]')).toBeTruthy();
    await fireEvent.click(button);
    expect(onOpenFeatureTour).toHaveBeenCalledTimes(1);
  });

  it('matches the update-channel disabled state during update activity', async () => {
    mocks.appUpdateState.checking = true;
    renderChecker(vi.fn());

    expect((await screen.findByRole('button', { name: 'Feature tour' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Update Settings' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('announces the latest state after a completed check', () => {
    mocks.appUpdateState.checked = true;
    renderChecker();

    expect(screen.getByText('You are on the latest version.')).toBeTruthy();
  });

  it('shows a paused automatic-check status without disabling manual checks', async () => {
    mocks.appUpdateState.automaticCheckPause = { mode: 'indefinite' };
    mocks.appUpdateState.isAutomaticCheckPaused = true;
    renderChecker();

    expect(screen.getByText('Automatic checks paused indefinitely')).toBeTruthy();
    await waitFor(() => expect(mocks.appUpdateState.ensureAutomaticCheckPause).toHaveBeenCalledOnce());
    const checkButton = screen.getByRole('button', { name: 'Check for Updates' }) as HTMLButtonElement;
    await waitFor(() => expect(checkButton.disabled).toBe(false));
    await fireEvent.click(checkButton);
    expect(mocks.appUpdateState.check).toHaveBeenCalledWith({ force: true });
  });

  it('prioritizes installation and demotes checking when an update is available', () => {
    mocks.appUpdateState.checked = true;
    mocks.appUpdateState.update = availableUpdate;
    renderChecker();

    expect(screen.getByText('Update available')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download and Install' }).classList.contains('success-action')).toBe(true);
    expect(screen.getByRole('button', { name: 'Check for Updates' }).classList.contains('secondary-action')).toBe(true);
  });

  it('exposes determinate download progress semantics', () => {
    mocks.appUpdateState.update = availableUpdate;
    mocks.appUpdateState.installing = true;
    mocks.appUpdateState.progress = {
      phase: 'downloading',
      downloadedBytes: 512,
      totalBytes: 1024,
      progress: 0.5,
    };
    renderChecker();

    const progress = screen.getByRole('progressbar');
    expect(progress.getAttribute('aria-valuenow')).toBe('50');
    expect(progress.getAttribute('aria-valuetext')).toContain('50.0%');
  });

  it('omits a numeric value for indeterminate download progress', () => {
    mocks.appUpdateState.update = availableUpdate;
    mocks.appUpdateState.installing = true;
    mocks.appUpdateState.progress = {
      phase: 'downloading',
      downloadedBytes: 0,
      totalBytes: null,
      progress: null,
    };
    const { container } = renderChecker();

    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
    expect(container.querySelector('.progress-fill--indeterminate')).toBeTruthy();
  });

  it('prioritizes restart after a desktop update is installed', async () => {
    mocks.appUpdateState.update = availableUpdate;
    mocks.appUpdateState.installed = true;
    renderChecker();

    expect(screen.getByText('Update installed')).toBeTruthy();
    const restart = screen.getByRole('button', { name: 'Restart Now' });
    await fireEvent.click(restart);
    expect(mocks.relaunchApp).toHaveBeenCalledOnce();
  });
});
