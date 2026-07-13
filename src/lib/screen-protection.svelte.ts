import { browser } from '$app/environment';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { platform, type Platform } from '@tauri-apps/plugin-os';
import { loadUserPreference, saveUserPreference, setAndroidContentProtected } from '$lib/api';
import type { UserPreference } from '$lib/api';

const DEFAULT_SCREENSHOT_PROTECTION = true;
const PRIVACY_PREFERENCE_VERSION = 1;

class ScreenProtectionStoreImpl {
  userEnabled = $state(DEFAULT_SCREENSHOT_PROTECTION);
  initialized = $state(false);
  supported = $state(true);

  private scopeKey: string | null = null;
  private applied: boolean | null = null;
  private operationId = 0;
  private initializationId = 0;

  async init(scopeKey: string) {
    if (this.initialized && this.scopeKey === scopeKey) return;

    const initializationId = ++this.initializationId;
    this.scopeKey = scopeKey;
    this.initialized = false;
    this.userEnabled = DEFAULT_SCREENSHOT_PROTECTION;

    try {
      const preferences = await loadUserPreference();
      if (initializationId !== this.initializationId || this.scopeKey !== scopeKey) return;
      this.userEnabled = normalizePreference(preferences);
    } catch {
      if (initializationId !== this.initializationId || this.scopeKey !== scopeKey) return;
      this.userEnabled = DEFAULT_SCREENSHOT_PROTECTION;
    } finally {
      if (initializationId === this.initializationId && this.scopeKey === scopeKey) {
        this.initialized = true;
      }
    }
  }

  async setUserEnabled(enabled: boolean) {
    const scopeKey = this.scopeKey;
    if (!scopeKey || !this.initialized) {
      throw new Error('Screenshot protection preferences are not initialized for this user.');
    }

    const preferences = await loadUserPreference();
    if (this.scopeKey !== scopeKey) {
      throw new Error('The active user changed while loading screenshot protection preferences.');
    }
    const next: UserPreference = {
      ...preferences,
      privacy: {
        version: PRIVACY_PREFERENCE_VERSION,
        screenshot_protection_enabled: enabled,
      },
    };
    await saveUserPreference(next);
    if (this.scopeKey !== scopeKey) return;
    this.userEnabled = enabled;
    this.initialized = true;
  }

  resetForSignedOut() {
    this.initializationId += 1;
    this.scopeKey = null;
    this.initialized = false;
    this.userEnabled = DEFAULT_SCREENSHOT_PROTECTION;
  }

  async apply(enabled: boolean) {
    if (!browser || !isNativeProtectionAvailable()) return;
    if (this.applied === enabled) return;

    const id = ++this.operationId;
    try {
      await setNativeContentProtection(enabled);
      if (id === this.operationId) {
        this.applied = enabled;
        this.supported = true;
      }
    } catch (err) {
      this.supported = false;
      console.warn('Failed to update screenshot protection.', err);
    }
  }
}

export const screenProtectionStore = new ScreenProtectionStoreImpl();

function normalizePreference(preferences: UserPreference) {
  const privacy = preferences.privacy;
  if (
    privacy?.version !== PRIVACY_PREFERENCE_VERSION
    || typeof privacy.screenshot_protection_enabled !== 'boolean'
  ) {
    return DEFAULT_SCREENSHOT_PROTECTION;
  }
  return privacy.screenshot_protection_enabled;
}

function isNativeProtectionAvailable() {
  const currentPlatform = platform();
  return currentPlatform === 'android' || isDesktopPlatform(currentPlatform);
}

async function setNativeContentProtection(enabled: boolean) {
  const currentPlatform = platform();
  if (currentPlatform === 'android') {
    await setAndroidContentProtected(enabled);
    return;
  }

  if (isDesktopPlatform(currentPlatform)) {
    await getCurrentWindow().setContentProtected(enabled);
  }
}

function isDesktopPlatform(value: Platform) {
  return value === 'windows' || value === 'macos' || value === 'linux';
}
