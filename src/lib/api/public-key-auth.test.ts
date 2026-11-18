import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { generateUserAuthPublicKey, getManagedAuthKeys, loginWithPublicKey, preparePreferenceUnlock, selectManagedAuthKey, unlockPreferenceDek, respondPublicKeyInteraction } from './auth';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), Channel: class { onmessage?: (event: unknown) => void } }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(invoke).mockResolvedValue({ has_token: true }); });
describe('native public-key bridge', () => {
  it('transmits a native key reference and relays authentication interactions', async () => {
    const receive = vi.fn();
    await loginWithPublicKey('alice', 'native-key', 'passphrase', receive, true);
    const [name, args] = vi.mocked(invoke).mock.calls[0];
    expect(name).toBe('login_with_public_key');
    expect(args).toMatchObject({ username: 'alice', keyRef: 'native-key', passphrase: 'passphrase', mfa: true });
    (args as { onInteraction: { onmessage: (event: unknown) => void } }).onInteraction.onmessage({ kind: 'select_key', interaction_id: 'step2' });
    expect(receive).toHaveBeenCalledWith({ kind: 'select_key', interaction_id: 'step2' });
  });
  it('keeps preference migration separate from password change and DEK rewrapping', async () => {
    await preparePreferenceUnlock(); await unlockPreferenceDek('old-password');
    expect(invoke).toHaveBeenNthCalledWith(1, 'prepare_preference_unlock');
    expect(invoke).toHaveBeenNthCalledWith(2, 'unlock_preference_dek', { password: 'old-password' });
  });
  it('targets the requested continuation interaction', async () => {
    await respondPublicKeyInteraction('step-2', 'second-native-key', '');
    expect(invoke).toHaveBeenCalledWith('respond_public_key_interaction', { interactionId: 'step-2', keyRef: 'second-native-key', passphrase: '' });
  });
  it('queries, selects, and generates device-managed authentication keypairs', async () => {
    await getManagedAuthKeys();
    expect(invoke).toHaveBeenNthCalledWith(1, 'get_managed_auth_keys');
    await selectManagedAuthKey('managed-1');
    expect(invoke).toHaveBeenNthCalledWith(2, 'select_managed_auth_key', { keyId: 'managed-1' });
    await generateUserAuthPublicKey('Laptop TPM');
    expect(invoke).toHaveBeenNthCalledWith(3, 'generate_user_auth_public_key', { label: 'Laptop TPM' });
  });
});
