import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeAppLock, configureAppLock, getAppLock, beginAppLockPrompt, finishAppLockPrompt, type AppLockSnapshot } from '$lib/api';
import { authenticate } from '$lib/shared/platform/native-biometric';
import { appLockStore } from './app-lock.svelte';
import { deferred } from '../../../test/deferred';

vi.mock('$lib/api', () => ({
  initializeAppLock: vi.fn(), configureAppLock: vi.fn(), getAppLock: vi.fn(),
  appLockActivity: vi.fn(), lockApp: vi.fn(), verifyAppLockPin: vi.fn(),
  beginAppLockPrompt: vi.fn(), finishAppLockPrompt: vi.fn(),
  createAndroidPasskey: vi.fn(), getAndroidPasskey: vi.fn(), getAndroidPasskeyAvailability: vi.fn(),
}));
vi.mock('$lib/shared/platform/native-biometric', () => ({ authenticate: vi.fn(), checkStatus: vi.fn() }));
vi.mock('$lib/shared/platform/platform', () => ({ isMobilePlatform: () => false }));

function snapshot(): AppLockSnapshot {
  return { revision: 1, settings: { version: 1, enabled: true, pin: null, biometricEnabled: true, platformCredentials: [], timedLockEnabled: false, timedLockMs: 300_000, updatedAt: 1 }, locked: true, failedAttempts: 0, lockoutUntil: 0, disconnectRequired: false };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { appLockStore.resetForSignedOut(); vi.useRealTimers(); });

describe('native app-lock mirror', () => {
  it('does not restore an old session when initialization finishes after sign-out', async () => {
    const response = deferred<AppLockSnapshot>();
    vi.mocked(initializeAppLock).mockReturnValueOnce(response.promise);
    const initializing = appLockStore.init('old');
    await vi.waitFor(() => expect(initializeAppLock).toHaveBeenCalled());
    appLockStore.resetForSignedOut(); response.resolve(snapshot());
    await initializing;
    expect(appLockStore.initialized).toBe(false);
    expect(appLockStore.locked).toBe(false);
  });
  it('submits a PIN to Rust and keeps only the public configuration snapshot', async () => {
    const publicState = snapshot(); publicState.settings.pin = { length: 4 };
    vi.mocked(configureAppLock).mockResolvedValueOnce(publicState);
    await appLockStore.setPin('1234');
    expect(configureAppLock).toHaveBeenCalledWith({ operation: 'pin', pin: '1234' });
    expect(appLockStore.settings.pin).toEqual({ length: 4 });
  });
  it('completes a cancelled platform prompt without reporting a failed verification', async () => {
    vi.mocked(beginAppLockPrompt).mockResolvedValueOnce(17);
    vi.mocked(finishAppLockPrompt).mockResolvedValueOnce(snapshot());
    const cancelled = new DOMException('cancelled', 'NotAllowedError');
    vi.mocked(authenticate).mockRejectedValueOnce(cancelled);
    await expect(appLockStore.verifyBiometric({ reason: '', title: '', subtitle: '', cancelTitle: '', fallbackTitle: '' })).rejects.toBe(cancelled);
    expect(finishAppLockPrompt).toHaveBeenCalledWith(17, 'cancelled');
    expect(appLockStore.failedAttempts).toBe(0);
    expect(appLockStore.locked).toBe(true);
  });
  it('does not let an older native response replace a newer lock snapshot', async () => {
    const old = deferred<AppLockSnapshot>();
    appLockStore.initialized = true;
    vi.mocked(getAppLock).mockReturnValueOnce(old.promise);
    const refreshing = appLockStore.refresh();
    vi.mocked(configureAppLock).mockResolvedValueOnce({ ...snapshot(), revision: 2 });
    await appLockStore.setEnabled(true);
    old.resolve({ ...snapshot(), revision: 1, locked: false });
    await refreshing;
    expect(appLockStore.locked).toBe(true);
  });
});
