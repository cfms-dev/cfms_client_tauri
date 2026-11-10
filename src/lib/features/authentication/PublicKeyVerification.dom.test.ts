// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locale } from 'svelte-i18n';
import '$lib/shared/i18n';
import PublicKeyVerification from '$lib/features/authentication/PublicKeyVerification.svelte';
import PreferenceUnlockDialog from '$lib/features/authentication/PreferenceUnlockDialog.svelte';
import AuthenticationDialog from '$lib/features/authentication/AuthenticationDialog.svelte';

const mocks = vi.hoisted(() => ({ pick: vi.fn(), release: vi.fn(), respond: vi.fn(), cancel: vi.fn() }));
vi.hoisted(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) }); });
vi.mock('$lib/api', async (original) => ({ ...await original<typeof import('$lib/api')>(), pickAuthPrivateKey: mocks.pick, releaseAuthPrivateKey: mocks.release, respondPublicKeyInteraction: mocks.respond, cancelPublicKeyAuthentication: mocks.cancel }));
vi.mock('$lib/shared/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));
vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));
const key = { keyRef: 'native-handle', filename: 'id_ed25519', algorithm: 'ssh-ed25519', fingerprint: 'abcdef'.repeat(10), encrypted: true };
beforeEach(() => { locale.set('en'); mocks.pick.mockResolvedValue(key); mocks.release.mockResolvedValue(undefined); mocks.cancel.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
async function select() {
  await fireEvent.click(screen.getByRole('button', { name: /Choose private key/ }));
  const pass = await screen.findByLabelText('Private key passphrase');
  await fireEvent.input(pass, { target: { value: 'key-passphrase' } });
  return pass;
}

describe('public-key verification', () => {
  it('does not submit or lose the form when the native picker is cancelled', async () => {
    mocks.pick.mockResolvedValue(null);
    const verify = vi.fn();
    render(PublicKeyVerification, { onVerify: verify, onCancel: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: /Choose private key/ }));
    await waitFor(() => expect(mocks.pick).toHaveBeenCalledOnce());
    expect(verify).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Verify' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('sends only a native handle and clears the passphrase after a failed attempt', async () => {
    const verify = vi.fn().mockRejectedValue('publicKey.wrongPassphrase');
    render(PublicKeyVerification, { onVerify: verify, onCancel: vi.fn() });
    const pass = await select();
    await fireEvent.submit(pass.closest('form')!);
    await screen.findByRole('alert');
    expect(verify).toHaveBeenCalledWith('native-handle', 'key-passphrase', expect.any(Function));
    expect((pass as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('alert').textContent).toContain('could not be unlocked');
  });
  it('serializes continuation submissions and releases selections on destroy', async () => {
    let finish!: () => void;
    mocks.respond.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const complete = vi.fn();
    const view = render(PublicKeyVerification, { interactionId: 'next-step', onCancel: vi.fn(), onComplete: complete });
    const pass = await select();
    await fireEvent.submit(pass.closest('form')!);
    await fireEvent.submit(pass.closest('form')!);
    expect(mocks.respond).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true);
    finish();
    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    view.unmount();
  });
  it('offers public-key MFA only when the caller enables that capability', async () => {
    render(AuthenticationDialog, { methods: ['publickey'], title: 'MFA', onVerify: vi.fn(), onCancel: vi.fn(), allowPublicKey: true });
    expect(screen.getByRole('button', { name: /Choose private key/ })).toBeTruthy();
  });
});

describe('one-time preference migration', () => {
  it('keeps the dialog open and drops the password when migration fails', async () => {
    const unlock = vi.fn().mockRejectedValue('publicKey.migrationFailed');
    const cancel = vi.fn();
    render(PreferenceUnlockDialog, { onUnlock: unlock, onDiscard: vi.fn(), onCancel: cancel });
    const input = screen.getByLabelText('Password protecting existing data') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'old-password' } });
    await fireEvent.submit(input.closest('form')!);
    await screen.findByRole('alert');
    expect(unlock).toHaveBeenCalledWith('old-password');
    expect(input.value).toBe('');
    expect(cancel).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('requires confirmation and allows backing out without clearing data', async () => {
    const discard = vi.fn();
    render(PreferenceUnlockDialog, { onUnlock: vi.fn(), onDiscard: discard, onCancel: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Forgot the old password? Clear local data' }));
    expect(screen.getByText(/Downloaded files and server data are unaffected/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(discard).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Password protecting existing data')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Password protecting existing data'));
    expect(discard).not.toHaveBeenCalled();
  });
  it('blocks duplicate clears and allows retrying a failed clear without a password', async () => {
    let reject!: (error: string) => void;
    const discard = vi.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
    const unlock = vi.fn();
    render(PreferenceUnlockDialog, { onUnlock: unlock, onDiscard: discard, onCancel: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Forgot the old password? Clear local data' }));
    const confirm = screen.getByRole('button', { name: 'Clear and continue signing in' });
    await fireEvent.click(confirm);
    await fireEvent.click(confirm);
    expect(discard).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    reject('publicKey.discardFailed');
    expect((await screen.findByRole('alert')).textContent).toContain('Please retry');
    await fireEvent.click(screen.getByRole('button', { name: 'Clear and continue signing in' }));
    expect(discard).toHaveBeenCalledTimes(2);
    expect(unlock).not.toHaveBeenCalled();
  });
});
