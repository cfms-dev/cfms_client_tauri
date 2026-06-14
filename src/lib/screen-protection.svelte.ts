import { browser } from '$app/environment';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { platform, type Platform } from '@tauri-apps/plugin-os';
import { loadUserPreference, saveUserPreference, setAndroidContentProtected } from '$lib/api';
import type { UserPreference } from '$lib/api';

const DEFAULT_SCREENSHOT_PROTECTION = true;

class ScreenProtectionStoreImpl {
  userEnabled = $state(DEFAULT_SCREENSHOT_PROTECTION);
  initialized = $state(false);
  supported = $state(true);

  private scopeKey: string | null = null;
  private applied: boolean | null = null;
  private operationId = 0;

  async init(scopeKey: string) {
    if (this.initialized && this.scopeKey === scopeKey) return;

    this.scopeKey = scopeKey;
    this.initialized = false;
    this.userEnabled = DEFAULT_SCREENSHOT_PROTECTION;

    try {
      const preferences = await loadUserPreference();
      this.userEnabled = normalizePreference(preferences);
    } catch {
      this.userEnabled = DEFAULT_SCREENSHOT_PROTECTION;
    } finally {
      this.initialized = true;
    }
  }

  async setUserEnabled(enabled: boolean) {
    const preferences = await loadUserPreference();
    const next: UserPreference = {
      ...preferences,
      screenshot_protection_enabled: enabled,
    };
    await saveUserPreference(next);
    this.userEnabled = enabled;
    this.initialized = true;
  }

  resetForSignedOut() {
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
  return preferences.screenshot_protection_enabled !== false;
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
