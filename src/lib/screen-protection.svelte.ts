import { browser } from '$app/environment';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { loadUserPreference, saveUserPreference, setAndroidContentProtected } from '$lib/api';
import type { UserPreference } from '$lib/api';
import { getAppPlatform, type AppPlatform } from '$lib/platform';

const DEFAULT_SCREENSHOT_PROTECTION = true;
const DESKTOP_PLATFORMS = new Set<AppPlatform>(['windows', 'macos', 'linux']);

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
  const platform = getAppPlatform();
  return platform === 'android' || DESKTOP_PLATFORMS.has(platform);
}

async function setNativeContentProtection(enabled: boolean) {
  const platform = getAppPlatform();
  if (platform === 'android') {
    await setAndroidContentProtected(enabled);
    return;
  }

  if (DESKTOP_PLATFORMS.has(platform)) {
    await getCurrentWindow().setContentProtected(enabled);
  }
}
