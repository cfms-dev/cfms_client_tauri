// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '$lib/shared/i18n';
import type { UpdateCheckPause } from '$lib/features/updates/update-check-pause';
import UpdatesSettingsPage from '$lib/app/settings/UpdatesSettingsPage.svelte';

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  goto: vi.fn(),
  navigateUp: vi.fn(),
  choose: vi.fn(),
  confirm: vi.fn(),
  notificationError: vi.fn(),
  appUpdateState: {
    channel: 'stable',
    automaticCheckPause: { mode: 'active' } as UpdateCheckPause,
    isAutomaticCheckPaused: false,
    ensureAutomaticCheckPause: vi.fn(),
    setAutomaticCheckPause: vi.fn(),
    resumeAutomaticChecks: vi.fn(),
    setChannel: vi.fn(),
  },
}));

vi.mock('$lib/api', () => ({
  getSetting: mocks.getSetting,
  setSetting: mocks.setSetting,
}));
vi.mock('$lib/features/updates/app-update-state.svelte.ts', () => ({ appUpdateState: mocks.appUpdateState }));
vi.mock('$lib/shared/ui/dialogs.svelte.ts', () => ({
  dialogStore: { choose: mocks.choose, confirm: mocks.confirm },
}));
vi.mock('$lib/shared/notifications/notifications.svelte', () => ({
  notificationStore: { error: mocks.notificationError }
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({
  page: { url: new URL('https://example.test/home/settings/updates') },
}));
vi.mock('$lib/app/navigation', () => ({ navigateUp: mocks.navigateUp }));

const now = Date.UTC(2026, 8, 11, 8, 0, 0);

beforeEach(() => {
  locale.set('en');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  mocks.appUpdateState.channel = 'stable';
  mocks.appUpdateState.automaticCheckPause = { mode: 'active' };
  mocks.appUpdateState.isAutomaticCheckPaused = false;
  mocks.getSetting.mockResolvedValue('stable');
  mocks.setSetting.mockResolvedValue(undefined);
  mocks.appUpdateState.ensureAutomaticCheckPause.mockResolvedValue({ mode: 'active' });
  mocks.appUpdateState.setAutomaticCheckPause.mockResolvedValue(undefined);
  mocks.appUpdateState.resumeAutomaticChecks.mockResolvedValue(undefined);
  mocks.appUpdateState.setChannel.mockImplementation((channel: string) => {
    mocks.appUpdateState.channel = channel;
  });
  mocks.choose.mockResolvedValue(null);
  mocks.confirm.mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('update settings pause controls', () => {
  it('keeps manual update checks in About', async () => {
    render(UpdatesSettingsPage);

    await fireEvent.click(await screen.findByRole('button', { name: 'Check in About' }));

    expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/home/about');
    expect(screen.queryByRole('button', { name: 'Check for Updates' })).toBeNull();
    expect(screen.queryByText('0.50.0')).toBeNull();
  });

  it('persists release channel changes', async () => {
    render(UpdatesSettingsPage);

    const alpha = await screen.findByRole('radio', { name: /Alpha/ }) as HTMLButtonElement;
    await waitFor(() => expect(alpha.disabled).toBe(false));
    await fireEvent.click(alpha);

    await waitFor(() => expect(mocks.setSetting).toHaveBeenCalledWith('update_channel', 'alpha'));
    expect(mocks.appUpdateState.setChannel).toHaveBeenCalledWith('alpha');
  });

  it('moves and selects release channels with arrow keys', async () => {
    render(UpdatesSettingsPage);

    const stable = await screen.findByRole('radio', { name: /Stable/ }) as HTMLButtonElement;
    const beta = screen.getByRole('radio', { name: /Beta/ }) as HTMLButtonElement;
    await waitFor(() => expect(stable.disabled).toBe(false));
    stable.focus();
    await fireEvent.keyDown(stable, { key: 'ArrowDown' });

    await waitFor(() => expect(mocks.setSetting).toHaveBeenCalledWith('update_channel', 'beta'));
    expect(document.activeElement).toBe(beta);
    expect(beta.getAttribute('aria-checked')).toBe('true');
  });

  it('offers all temporary durations and persists a one-day pause', async () => {
    mocks.choose.mockResolvedValue({ value: 'day', applyToAll: false });
    render(UpdatesSettingsPage);

    const pauseButton = await enabledButton('Pause Automatic Checks');
    await fireEvent.click(pauseButton);

    await waitFor(() => expect(mocks.choose).toHaveBeenCalledOnce());
    const choices = mocks.choose.mock.calls[0][0].choices;
    expect(choices.map((choice: { value: string }) => choice.value))
      .toEqual(['day', 'week', 'month', 'indefinite']);
    await waitFor(() => expect(mocks.appUpdateState.setAutomaticCheckPause).toHaveBeenCalledWith({
      mode: 'until',
      until: now + 24 * 60 * 60_000,
    }));
  });

  it('requires confirmation before persisting an indefinite pause', async () => {
    mocks.choose.mockResolvedValue({ value: 'indefinite', applyToAll: false });
    mocks.confirm.mockResolvedValue(false);
    render(UpdatesSettingsPage);

    await fireEvent.click(await enabledButton('Pause Automatic Checks'));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(mocks.appUpdateState.setAutomaticCheckPause).not.toHaveBeenCalled();
  });

  it('persists an indefinite pause after confirmation', async () => {
    mocks.choose.mockResolvedValue({ value: 'indefinite', applyToAll: false });
    mocks.confirm.mockResolvedValue(true);
    render(UpdatesSettingsPage);

    await fireEvent.click(await enabledButton('Pause Automatic Checks'));

    await waitFor(() => expect(mocks.appUpdateState.setAutomaticCheckPause)
      .toHaveBeenCalledWith({ mode: 'indefinite' }));
  });

  it('shows the paused state and resumes automatic checks', async () => {
    mocks.appUpdateState.automaticCheckPause = { mode: 'indefinite' };
    mocks.appUpdateState.isAutomaticCheckPaused = true;
    mocks.appUpdateState.ensureAutomaticCheckPause.mockResolvedValue({ mode: 'indefinite' });
    render(UpdatesSettingsPage);

    expect(await screen.findByText('Automatic checks paused indefinitely')).toBeTruthy();
    await fireEvent.click(await enabledButton('Resume Automatic Checks'));

    await waitFor(() => expect(mocks.appUpdateState.resumeAutomaticChecks).toHaveBeenCalledOnce());
  });

  it('reports persistence failures without presenting a changed policy', async () => {
    mocks.choose.mockResolvedValue({ value: 'week', applyToAll: false });
    mocks.appUpdateState.setAutomaticCheckPause.mockRejectedValue(new Error('disk unavailable'));
    render(UpdatesSettingsPage);

    await fireEvent.click(await enabledButton('Pause Automatic Checks'));

    await waitFor(() => expect(mocks.notificationError).toHaveBeenCalledWith('disk unavailable'));
    expect(screen.getByText('Automatic checks are active')).toBeTruthy();
  });

  it('resets both the release channel and a paused policy', async () => {
    mocks.getSetting.mockResolvedValue('beta');
    mocks.appUpdateState.channel = 'beta';
    mocks.appUpdateState.automaticCheckPause = { mode: 'indefinite' };
    mocks.appUpdateState.isAutomaticCheckPaused = true;
    mocks.appUpdateState.ensureAutomaticCheckPause.mockResolvedValue({ mode: 'indefinite' });
    render(UpdatesSettingsPage);

    const reset = await screen.findByRole('button', { name: 'Reset' }) as HTMLButtonElement;
    await waitFor(() => expect(reset.disabled).toBe(false));
    await fireEvent.click(reset);

    await waitFor(() => expect(mocks.setSetting).toHaveBeenCalledWith('update_channel', 'stable'));
    expect(mocks.appUpdateState.setChannel).toHaveBeenCalledWith('stable');
    expect(mocks.appUpdateState.resumeAutomaticChecks).toHaveBeenCalledOnce();
  });
});

async function enabledButton(name: string): Promise<HTMLButtonElement> {
  const button = await screen.findByRole('button', { name }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  return button;
}
