import { browser } from '$app/environment';
import { authenticate, checkStatus, type AuthOptions } from '$lib/shared/platform/native-biometric';
import { createAndroidPasskey, getAndroidPasskey, getAndroidPasskeyAvailability, initializeAppLock, getAppLock, configureAppLock, appLockActivity, lockApp, verifyAppLockPin, beginAppLockPrompt, finishAppLockPrompt, type AppLockSettings, type AppLockSnapshot, type AppLockChange } from '$lib/api';
import { isMobilePlatform } from '$lib/shared/platform/platform';
export type { AppLockSettings, PlatformCredentialRecord } from '$lib/api';
export type AppLockMethod = 'pin' | 'biometric' | 'platform';
export interface BiometricPromptLabels { reason: string; title: string; subtitle: string; cancelTitle: string; fallbackTitle: string }
const ANDROID_PASSKEY_RP_ID = 'cfms-dev.github.io';
const defaultSettings = (): AppLockSettings => ({ version: 1, enabled: false, pin: null, biometricEnabled: false, platformCredentials: [], timedLockEnabled: false, timedLockMs: 300_000, updatedAt: Date.now() });
class AppLockStoreImpl {
  settings = $state<AppLockSettings>(defaultSettings());
  initialized = $state(false);
  initializationFailed = $state(false);
  locked = $state(false);
  pinSetupActive = $state(false);
  biometricAvailable = $state(false);
  platformAvailable = $state(false);
  busy = $state(false);
  failedAttempts = $state(0);
  lockoutUntil = $state(0);
  disconnectRequired = $state(false);
  private scopeKey: string | null = null;
  private generation = 0;
  private revision = 0;
  private lockRequested = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  get pinLength() { return this.settings.pin?.length ?? 4; }
  get hasPin() { return this.settings.pin !== null; }
  get hasPlatformCredential() { return this.settings.platformCredentials.length > 0; }
  get hasBiometric() { return this.settings.biometricEnabled; }
  get hasAnyMethod() { return this.hasPin || this.hasBiometric || this.hasPlatformCredential; }
  get canLock() { return this.settings.enabled && this.hasAnyMethod; }
  get canUseRootBackBackground() { return this.canLock && this.settings.timedLockEnabled; }
  get methods(): AppLockMethod[] { return [...(this.hasPin ? ['pin' as const] : []), ...(this.hasBiometric ? ['biometric' as const] : []), ...(this.hasPlatformCredential ? ['platform' as const] : [])]; }
  private apply(snapshot: AppLockSnapshot) {
    if (snapshot.revision < this.revision) return;
    if (this.lockRequested && !snapshot.locked) return;
    this.revision = snapshot.revision;
    this.settings = snapshot.settings; this.locked = snapshot.locked;
    this.failedAttempts = snapshot.failedAttempts; this.lockoutUntil = snapshot.lockoutUntil; this.disconnectRequired = snapshot.disconnectRequired;
  }
  async init(scopeKey: string) {
    if (this.initialized && this.scopeKey === scopeKey) return;
    this.resetForSignedOut(); this.scopeKey = scopeKey;
    const generation = this.generation;
    await Promise.all([this.refreshBiometricAvailability(), this.refreshPlatformAvailability()]);
    try {
      const snapshot = await initializeAppLock();
      if (generation !== this.generation) return;
      this.apply(snapshot); this.initialized = true; this.initializationFailed = false;
      if (browser) this.timer = setInterval(() => { void this.refresh().catch(() => {}); }, 1000);
    } catch { if (generation === this.generation) { this.initializationFailed = true; this.initialized = false; } }
  }
  async refresh() {
    if (!this.initialized) return;
    const generation = this.generation; const snapshot = await getAppLock();
    if (generation === this.generation) this.apply(snapshot);
  }
  async refreshPlatformAvailability() { this.platformAvailable = await isPlatformAuthenticatorAvailable(); }
  async refreshBiometricAvailability() { this.biometricAvailable = await isBiometricAuthenticatorAvailable(); }
  private async change(change: AppLockChange) {
    const generation = this.generation; const snapshot = await configureAppLock(change);
    if (generation === this.generation) this.apply(snapshot);
  }
  setEnabled(enabled: boolean) { return this.change({ operation: 'enabled', enabled }); }
  setPin(pin: string) { return this.change({ operation: 'pin', pin }); }
  removePin() { return this.change({ operation: 'remove_pin' }); }
  setBiometricEnabled(enabled: boolean) { return this.change({ operation: 'biometric', enabled }); }
  removePlatformCredential(id: string) { return this.change({ operation: 'remove_credential', id }); }
  setTimedLock(enabled: boolean, timeout: number) { return this.change({ operation: 'timed', enabled, timeout }); }
  resetToDefaults() { return this.change({ operation: 'reset' }); }
  async verifyPin(pin: string) {
    const generation = this.generation; const snapshot = await verifyAppLockPin(pin);
    if (generation !== this.generation) return false;
    this.apply(snapshot); return !snapshot.locked && !snapshot.disconnectRequired;
  }
  private async prompt(method: 'platform' | 'biometric', operation: () => Promise<boolean>) {
    const generation = this.generation;
    const ticket = await beginAppLockPrompt(method);
    if (generation !== this.generation) return false;
    let accepted: boolean;
    try { accepted = await operation(); }
    catch (error) {
      if (generation === this.generation) {
        const snapshot = await finishAppLockPrompt(ticket, 'cancelled');
        if (generation === this.generation) this.apply(snapshot);
      }
      throw error;
    }
    if (generation !== this.generation) return false;
    const snapshot = await finishAppLockPrompt(ticket, accepted ? 'accepted' : 'failed');
    if (generation !== this.generation) return false;
    this.apply(snapshot); return !snapshot.locked && !snapshot.disconnectRequired;
  }
  verifyPlatformCredential() { return this.prompt('platform', () => this.promptPlatformCredential()); }
  verifyBiometric(labels: BiometricPromptLabels) {
    return this.prompt('biometric', async () => {
      const options: AuthOptions = { allowDeviceCredential: false, cancelTitle: labels.cancelTitle, fallbackTitle: labels.fallbackTitle, title: labels.title, subtitle: labels.subtitle, confirmationRequired: false };
      await authenticate(labels.reason, options); return true;
    });
  }
  lock() {
    if (!this.canLock) return false;
    this.lockRequested = true;
    this.locked = true;
    const generation = this.generation;
    void lockApp().then(snapshot => {
      if (generation === this.generation) { this.lockRequested = false; this.apply(snapshot); }
    }).catch(() => { if (generation === this.generation) this.lockRequested = false; });
    return true;
  }
  recordActivity() {
    if (!this.initialized) return;
    const generation = this.generation;
    void appLockActivity().then(snapshot => { if (generation === this.generation) this.apply(snapshot); }).catch(() => {});
  }
  lockForBackground() {
    if (!this.canUseRootBackBackground) return false;
    this.lockRequested = true;
    const generation = this.generation; this.locked = true;
    void appLockActivity(true).then(snapshot => {
      if (generation === this.generation) { this.lockRequested = false; this.apply(snapshot); }
    }).catch(() => { if (generation === this.generation) this.lockRequested = false; });
    return true;
  }
  setPinSetupActive(active: boolean) { this.pinSetupActive = active; }
  resetForSignedOut() {
    this.generation += 1; this.revision = 0; this.lockRequested = false; if (this.timer) clearInterval(this.timer); this.timer = null;
    this.scopeKey = null; this.settings = defaultSettings(); this.initialized = false; this.initializationFailed = false;
    this.locked = false; this.pinSetupActive = false; this.failedAttempts = 0; this.lockoutUntil = 0; this.disconnectRequired = false;
  }
  async registerPlatformCredential(displayName: string) {
    const generation = this.generation;
    if (await shouldUseAndroidPasskeys()) {
      const requestJson = createAndroidPasskeyRegistrationRequest(
        displayName,
        this.settings.platformCredentials.map((item) => item.id),
      );
      const credential = await createAndroidPasskey(requestJson);
      if (!credential.id) {
        throw new Error('No Android passkey was created.');
      }

      if (generation !== this.generation) return;
      await this.change({ operation: 'credential', credential: { id: credential.id, label: displayName || 'Android passkey', createdAt: Date.now() } });
      return;
    }

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
    if (generation !== this.generation) return;
    await this.change({ operation: 'credential', credential: { id, label: displayName || 'Platform passkey', createdAt: Date.now() } });
  }

  private async promptPlatformCredential() {
    if (await shouldUseAndroidPasskeys()) {
      if (!this.hasPlatformCredential) return false;

      const credential = await getAndroidPasskey(
        createAndroidPasskeyAuthenticationRequest(
          this.settings.platformCredentials.map((item) => item.id),
        ),
      );
      return Boolean(
        credential.id
        && this.settings.platformCredentials.some((item) => item.id === credential.id),
      );
    }

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

}
export const appLockStore = new AppLockStoreImpl();
export function getRequiredPinLength() { return 4; }
export function isCredentialOperationCancelled(err: unknown) {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { errorCode?: unknown; name?: unknown; message?: unknown };
  const errorCode = typeof candidate.errorCode === 'string' ? candidate.errorCode : '';
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  const message = typeof candidate.message === 'string' ? candidate.message : '';

  return /cancel|userFallback/i.test(errorCode)
    || name === 'NotAllowedError'
    || name === 'AbortError'
    || /timed out|not allowed|cancel|userFallback/i.test(message);
}

async function isPlatformAuthenticatorAvailable() {
  if (isAndroidRuntime()) {
    try {
      const availability = await getAndroidPasskeyAvailability();
      return availability.available || availability.webViewWebAuthn;
    } catch {
      return false;
    }
  }

  if (!browser || !window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function isBiometricAuthenticatorAvailable() {
  if (!browser || !isMobilePlatform()) return false;
  try {
    return (await checkStatus()).isAvailable;
  } catch {
    return false;
  }
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

async function shouldUseAndroidPasskeys() {
  if (!isAndroidRuntime()) return false;
  try {
    return (await getAndroidPasskeyAvailability()).available;
  } catch {
    return false;
  }
}

function isAndroidRuntime() {
  return browser
    && typeof window !== 'undefined'
    && '__TAURI_INTERNALS__' in window
    && /Android/i.test(navigator.userAgent);
}

function createAndroidPasskeyRegistrationRequest(displayName: string, existingCredentialIds: string[]) {
  const userDisplayName = displayName || 'CFMS user';
  return JSON.stringify({
    challenge: bytesToBase64Url(randomBytes(32)),
    rp: {
      name: 'CFMS Client',
      id: ANDROID_PASSKEY_RP_ID,
    },
    user: {
      id: bytesToBase64Url(randomBytes(16)),
      name: userDisplayName,
      displayName: userDisplayName,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    timeout: 60_000,
    attestation: 'none',
    excludeCredentials: existingCredentialIds.map((id) => ({
      type: 'public-key',
      id,
    })),
    authenticatorSelection: {
      requireResidentKey: true,
      residentKey: 'required',
      userVerification: 'required',
    },
  });
}

function createAndroidPasskeyAuthenticationRequest(credentialIds: string[]) {
  return JSON.stringify({
    challenge: bytesToBase64Url(randomBytes(32)),
    rpId: ANDROID_PASSKEY_RP_ID,
    allowCredentials: credentialIds.map((id) => ({
      type: 'public-key',
      id,
    })),
    userVerification: 'required',
    timeout: 60_000,
  });
}
