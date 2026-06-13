import { browser } from '$app/environment';
import { getSetting, loadUserPreference, saveUserPreference, setSetting } from './api';

const SETTINGS_KEY = 'app_lock_settings_v1';
const PIN_ITERATIONS = 180_000;
const PIN_LENGTH = 4;

export type AppLockMethod = 'pin' | 'platform';

export interface PlatformCredentialRecord {
  id: string;
  label: string;
  createdAt: number;
}

interface PinRecord {
  salt: string;
  hash: string;
  iterations: number;
  length: number;
}

export interface AppLockSettings {
  version: 1;
  enabled: boolean;
  pin: PinRecord | null;
  platformCredentials: PlatformCredentialRecord[];
  updatedAt: number;
}

const defaultSettings = (): AppLockSettings => ({
  version: 1,
  enabled: false,
  pin: null,
  platformCredentials: [],
  updatedAt: Date.now(),
});

class AppLockStoreImpl {
  settings = $state<AppLockSettings>(defaultSettings());
  initialized = $state(false);
  locked = $state(false);
  platformAvailable = $state(false);
  busy = $state(false);
  private scopeKey: string | null = null;

  get pinLength() {
    return this.settings.pin?.length ?? PIN_LENGTH;
  }

  get hasPin() {
    return this.settings.pin !== null;
  }

  get hasPlatformCredential() {
    return this.settings.platformCredentials.length > 0;
  }

  get hasAnyMethod() {
    return this.hasPin || this.hasPlatformCredential;
  }

  get canLock() {
    return this.settings.enabled && this.hasAnyMethod;
  }

  get methods(): AppLockMethod[] {
    const methods: AppLockMethod[] = [];
    if (this.hasPin) methods.push('pin');
    if (this.hasPlatformCredential) methods.push('platform');
    return methods;
  }

  async init(scopeKey: string) {
    if (this.initialized && this.scopeKey === scopeKey) return;
    await this.refreshPlatformAvailability();

    try {
      const preferences = await loadUserPreference();
      const appLockSettings = parseSettingsValue(preferences.app_lock);

      if (isDefaultSettings(appLockSettings)) {
        const legacySettings = await loadLegacySettings();
        if (legacySettings && !isDefaultSettings(legacySettings)) {
          this.settings = legacySettings;
          this.scopeKey = scopeKey;
          this.initialized = true;
          await this.persist();
          await clearLegacySettings();
          return;
        }
      }

      this.settings = appLockSettings;
      this.scopeKey = scopeKey;
      this.initialized = true;
    } catch {
      this.settings = defaultSettings();
      this.scopeKey = null;
      this.initialized = false;
    }
  }

  async refreshPlatformAvailability() {
    this.platformAvailable = await isPlatformAuthenticatorAvailable();
  }

  async setEnabled(enabled: boolean) {
    if (enabled && !this.hasAnyMethod) {
      throw new Error('Set up at least one unlock method first.');
    }

    this.settings = {
      ...this.settings,
      enabled,
      updatedAt: Date.now(),
    };
    await this.persist();
  }

  async setPin(pin: string) {
    validatePin(pin);
    const salt = randomBytes(16);
    const hash = await hashPin(pin, salt, PIN_ITERATIONS);
    this.settings = {
      ...this.settings,
      enabled: true,
      pin: {
        salt: bytesToBase64Url(salt),
        hash: bytesToBase64Url(hash),
        iterations: PIN_ITERATIONS,
        length: pin.length,
      },
      updatedAt: Date.now(),
    };
    await this.persist();
  }

  async removePin() {
    this.settings = {
      ...this.settings,
      enabled: this.settings.platformCredentials.length > 0 ? this.settings.enabled : false,
      pin: null,
      updatedAt: Date.now(),
    };
    await this.persist();
  }

  async verifyPin(pin: string) {
    const record = this.settings.pin;
    if (!record) return false;
    const hash = await hashPin(pin, base64UrlToBytes(record.salt), record.iterations);
    return constantTimeEqual(hash, base64UrlToBytes(record.hash));
  }

  async registerPlatformCredential(displayName: string) {
    if (!browser || !window.PublicKeyCredential || !navigator.credentials) {
      throw new Error('Platform passkeys are not available in this WebView.');
    }

    const credential = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'CFMS Client' },
        user: {
          id: toBufferSource(randomBytes(16)),
          name: displayName || 'CFMS user',
          displayName: displayName || 'CFMS user',
        },
        challenge: toBufferSource(randomBytes(32)),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    });

    if (!credential || credential.type !== 'public-key') {
      throw new Error('No platform passkey was created.');
    }

    const publicKeyCredential = credential as PublicKeyCredential;
    const id = bytesToBase64Url(new Uint8Array(publicKeyCredential.rawId));
    const existing = this.settings.platformCredentials.filter((item) => item.id !== id);
    this.settings = {
      ...this.settings,
      enabled: true,
      platformCredentials: [
        ...existing,
        {
          id,
          label: displayName || 'Platform passkey',
          createdAt: Date.now(),
        },
      ],
      updatedAt: Date.now(),
    };
    await this.persist();
  }

  async removePlatformCredential(id: string) {
    const nextCredentials = this.settings.platformCredentials.filter((item) => item.id !== id);
    this.settings = {
      ...this.settings,
      enabled: this.settings.pin || nextCredentials.length > 0 ? this.settings.enabled : false,
      platformCredentials: nextCredentials,
      updatedAt: Date.now(),
    };
    await this.persist();
  }

  async verifyPlatformCredential() {
    if (!browser || !window.PublicKeyCredential || !navigator.credentials || !this.hasPlatformCredential) {
      return false;
    }

    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: toBufferSource(randomBytes(32)),
        allowCredentials: this.settings.platformCredentials.map((item) => ({
          type: 'public-key',
          id: toBufferSource(base64UrlToBytes(item.id)),
        })),
        userVerification: 'required',
        timeout: 60_000,
      },
    });

    return Boolean(credential && credential.type === 'public-key');
  }

  lock() {
    if (this.canLock) this.locked = true;
  }

  unlock() {
    this.locked = false;
  }

  resetForSignedOut() {
    this.settings = defaultSettings();
    this.initialized = false;
    this.locked = false;
    this.scopeKey = null;
  }

  async persist() {
    const preferences = await loadUserPreference();
    await saveUserPreference({
      ...preferences,
      app_lock: this.settings,
    });
  }
}

export const appLockStore = new AppLockStoreImpl();

export function getRequiredPinLength() {
  return PIN_LENGTH;
}

export function isCredentialOperationCancelled(err: unknown) {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { name?: unknown; message?: unknown };
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  return name === 'NotAllowedError'
    || name === 'AbortError'
    || /timed out|not allowed|cancel/i.test(message);
}

async function loadLegacySettings() {
  try {
    const raw = await getSetting(SETTINGS_KEY);
    return parseSettingsJson(raw);
  } catch {
    return null;
  }
}

async function clearLegacySettings() {
  try {
    await setSetting(SETTINGS_KEY, '');
  } catch {
    /* Best-effort cleanup after migration. */
  }
}

function parseSettingsJson(raw: string | null): AppLockSettings {
  if (!raw) return defaultSettings();

  try {
    return parseSettingsValue(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

function parseSettingsValue(value: unknown): AppLockSettings {
  if (!value || typeof value !== 'object') return defaultSettings();
  const parsed = value as Partial<AppLockSettings>;
  return {
    version: 1,
    enabled: Boolean(parsed.enabled),
    pin: isPinRecord(parsed.pin) ? parsed.pin : null,
    platformCredentials: Array.isArray(parsed.platformCredentials)
      ? parsed.platformCredentials.filter(isPlatformCredentialRecord)
      : [],
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  };
}

function isDefaultSettings(settings: AppLockSettings) {
  return !settings.enabled
    && settings.pin === null
    && settings.platformCredentials.length === 0;
}

function isPinRecord(value: unknown): value is PinRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PinRecord>;
  return (
    typeof record.salt === 'string'
    && typeof record.hash === 'string'
    && typeof record.iterations === 'number'
    && typeof record.length === 'number'
  );
}

function isPlatformCredentialRecord(value: unknown): value is PlatformCredentialRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PlatformCredentialRecord>;
  return typeof record.id === 'string'
    && typeof record.label === 'string'
    && typeof record.createdAt === 'number';
}

function validatePin(pin: string) {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
    throw new Error(`PIN must be ${PIN_LENGTH} digits.`);
  }
}

async function isPlatformAuthenticatorAvailable() {
  if (!browser || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function hashPin(pin: string, salt: Uint8Array, iterations: number) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: toBufferSource(salt),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  return new Uint8Array(bits);
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  const normalized = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  normalized.set(bytes);
  return normalized;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
