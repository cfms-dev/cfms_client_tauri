// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_UPDATE_CHECK_PAUSE,
  MAX_UPDATE_CHECK_TIMER_MS,
  UPDATE_CHECK_PAUSE_DURATIONS,
  UPDATE_CHECK_PAUSE_SETTING_KEY,
  serializeUpdateCheckPause,
} from '$lib/features/updates/update-check-pause';
import { AppUpdateState } from '$lib/features/updates/app-update-state.svelte.ts';

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  checkAppUpdate: vi.fn(),
  installAppUpdate: vi.fn(),
  dismiss: vi.fn(),
  reset: vi.fn(),
  report: vi.fn(),
}));

vi.mock('$lib/api', () => ({
  getSetting: mocks.getSetting,
  setSetting: mocks.setSetting,
}));

vi.mock('$lib/api/updates', () => ({
  checkAppUpdate: mocks.checkAppUpdate,
  installAppUpdate: mocks.installAppUpdate,
}));

vi.mock('$lib/features/updates/update-notifications', () => ({
  updateNotificationReporter: {
    dismiss: mocks.dismiss,
    reset: mocks.reset,
    report: mocks.report,
  },
}));

const now = Date.UTC(2026, 8, 11, 8, 0, 0);

function mockStoredPause(value: string | null) {
  mocks.getSetting.mockImplementation(async (key: string) => {
    if (key === UPDATE_CHECK_PAUSE_SETTING_KEY) return value;
    if (key === 'update_channel') return 'stable';
    return null;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.setSetting.mockResolvedValue(undefined);
  mocks.checkAppUpdate.mockResolvedValue(null);
  mocks.installAppUpdate.mockResolvedValue(undefined);
  mocks.report.mockResolvedValue(undefined);
  mockStoredPause(serializeUpdateCheckPause(ACTIVE_UPDATE_CHECK_PAUSE));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('automatic update check scheduling', () => {
  it('checks once at startup when automatic checks are active', async () => {
    const state = new AppUpdateState();

    await state.initializeAutomaticChecks();

    expect(mocks.checkAppUpdate).toHaveBeenCalledOnce();
    expect(state.automaticCheckSettled).toBe(true);
    state.disposeAutomaticChecks();
  });

  it('skips the startup network check while paused but settles the decision', async () => {
    mockStoredPause(serializeUpdateCheckPause({ mode: 'indefinite' }));
    const state = new AppUpdateState();

    await state.initializeAutomaticChecks();

    expect(mocks.checkAppUpdate).not.toHaveBeenCalled();
    expect(state.automaticCheckSettled).toBe(true);
    expect(state.isAutomaticCheckPaused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    state.disposeAutomaticChecks();
  });

  it('uses a bounded timer for a 30-day pause and does not duplicate it on reinitialization', async () => {
    const pause = { mode: 'until', until: now + UPDATE_CHECK_PAUSE_DURATIONS.month } as const;
    mockStoredPause(serializeUpdateCheckPause(pause));
    const state = new AppUpdateState();
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await state.initializeAutomaticChecks();
    await state.initializeAutomaticChecks();

    expect(mocks.checkAppUpdate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    expect(timeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), MAX_UPDATE_CHECK_TIMER_MS);
    state.disposeAutomaticChecks();
    timeoutSpy.mockRestore();
  });

  it('expires a temporary pause and checks exactly once', async () => {
    const pause = { mode: 'until', until: now + 1_000 } as const;
    mockStoredPause(serializeUpdateCheckPause(pause));
    const state = new AppUpdateState();
    await state.initializeAutomaticChecks();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.setSetting).toHaveBeenCalledWith(
      UPDATE_CHECK_PAUSE_SETTING_KEY,
      serializeUpdateCheckPause(ACTIVE_UPDATE_CHECK_PAUSE),
    );
    expect(mocks.checkAppUpdate).toHaveBeenCalledOnce();
    expect(state.automaticCheckPause).toEqual(ACTIVE_UPDATE_CHECK_PAUSE);
    state.disposeAutomaticChecks();
  });

  it('allows a forced manual check during an indefinite pause without changing the pause', async () => {
    mockStoredPause(serializeUpdateCheckPause({ mode: 'indefinite' }));
    const state = new AppUpdateState();
    await state.initializeAutomaticChecks();

    await state.check({ force: true });

    expect(mocks.checkAppUpdate).toHaveBeenCalledOnce();
    expect(state.automaticCheckPause).toEqual({ mode: 'indefinite' });
    expect(mocks.setSetting).not.toHaveBeenCalled();
    state.disposeAutomaticChecks();
  });

  it('resumes persistently and starts an immediate check', async () => {
    mockStoredPause(serializeUpdateCheckPause({ mode: 'indefinite' }));
    const state = new AppUpdateState();
    await state.initializeAutomaticChecks();

    await state.resumeAutomaticChecks();
    await vi.waitFor(() => expect(mocks.checkAppUpdate).toHaveBeenCalledOnce());

    expect(mocks.setSetting).toHaveBeenCalledWith(
      UPDATE_CHECK_PAUSE_SETTING_KEY,
      serializeUpdateCheckPause(ACTIVE_UPDATE_CHECK_PAUSE),
    );
    expect(state.automaticCheckPause).toEqual(ACTIVE_UPDATE_CHECK_PAUSE);
    state.disposeAutomaticChecks();
  });

  it('keeps the previous policy when persistence fails', async () => {
    mockStoredPause(serializeUpdateCheckPause({ mode: 'indefinite' }));
    mocks.setSetting.mockRejectedValueOnce(new Error('disk unavailable'));
    const state = new AppUpdateState();
    await state.ensureAutomaticCheckPause();

    await expect(state.setAutomaticCheckPause({ mode: 'until', until: now + 1_000 }))
      .rejects.toThrow('disk unavailable');
    expect(state.automaticCheckPause).toEqual({ mode: 'indefinite' });
  });
});
