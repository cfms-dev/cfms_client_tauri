// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { locale } from 'svelte-i18n';
import '$lib/shared/i18n';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
import LoginPage from '$lib/app/authentication/LoginPage.svelte';

const mocks = vi.hoisted(() => ({ login: vi.fn(), keyLogin: vi.fn(), pick: vi.fn(), release: vi.fn(), clear: vi.fn(), cancel: vi.fn(), prepare: vi.fn(), unlock: vi.fn(), discard: vi.fn(), setup: vi.fn(), goto: vi.fn(), server: vi.fn(), preferences: vi.fn(), tasks: vi.fn(), loadAppearance: vi.fn() }));
vi.mock('$lib/api', async (original) => ({
  ...await original<typeof import('$lib/api')>(), login: mocks.login, loginWithPublicKey: mocks.keyLogin,
  pickAuthPrivateKey: mocks.pick, releaseAuthPrivateKey: mocks.release, clearAuthSession: mocks.clear,
  cancelPublicKeyAuthentication: mocks.cancel, preparePreferenceUnlock: mocks.prepare, unlockPreferenceDek: mocks.unlock,
  discardLockedPreferenceData: mocks.discard,
  setupPreferenceDek: mocks.setup, getServerState: mocks.server, loadUserPreference: mocks.preferences,
  getAuthStatus: vi.fn().mockImplementation(async () => status), checkCachedAvatar: vi.fn().mockResolvedValue(null), getUserAvatar: vi.fn().mockResolvedValue(null),
  reloadTasksForUser: mocks.tasks, getDownloadTasks: vi.fn().mockResolvedValue([]), validateFileShortcuts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$lib/features/settings/appearance.svelte.ts', () => ({ appearanceStore: { load: mocks.loadAppearance } }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/shared/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));
vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }));
const key = { keyRef: 'key-1', filename: 'id_ed25519', algorithm: 'ssh-ed25519', fingerprint: 'ab'.repeat(32), encrypted: false };
const status = { user_id: 'user-1', username: 'alice', nickname: 'Alice', has_token: true, token_exp: 2e9, permissions: [], groups: [], needs_preference_dek_setup: true };
beforeEach(() => {
  locale.set('en'); authStore.clear();
  const server = { connected: true, server_address: 'example.test:443', server_name: 'Example Server', protocol_version: 28, lockdown: false, lockdown_reason: null, extension_flags: [] };
  serverStateStore.apply(server); mocks.server.mockResolvedValue(server);
  mocks.release.mockResolvedValue(undefined); mocks.clear.mockResolvedValue(undefined); mocks.cancel.mockResolvedValue(undefined);
  mocks.pick.mockResolvedValue(key); mocks.prepare.mockResolvedValue('ready'); mocks.unlock.mockResolvedValue(undefined);
  mocks.discard.mockResolvedValue(undefined);
  mocks.keyLogin.mockResolvedValue(status); mocks.preferences.mockResolvedValue({}); mocks.tasks.mockResolvedValue(0); mocks.loadAppearance.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); authStore.clear(); serverStateStore.clear(); vi.clearAllMocks(); });
function usernameControl(): HTMLInputElement {
  const control = screen.getByLabelText('Username').shadowRoot?.querySelector('input');
  if (!control) throw new Error('Fluent username input is not registered');
  return control;
}
async function publicKeyForm() {
  await fireEvent.input(usernameControl(), { target: { value: 'alice' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Sign-in options' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Public key' }));
  await fireEvent.click(screen.getByRole('button', { name: /Choose private key/ }));
  await screen.findByText('id_ed25519');
  return screen.getByRole('button', { name: 'Login' }).closest('form')!;
}
describe('dual-method sign-in', () => {
  it('preserves protocol 30 username whitespace in password and public-key requests', async () => {
    mocks.login.mockRejectedValueOnce('Server returned 401: rejected');
    mocks.keyLogin.mockRejectedValueOnce('Server returned 401: rejected');
    render(LoginPage);
    await fireEvent.input(usernameControl(), { target: { value: ' Alice ' } });
    await fireEvent.input(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'secret' } });
    await fireEvent.submit(screen.getByRole('button', { name: 'Login' }).closest('form')!);
    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith(' Alice ', 'secret'));
    await fireEvent.click(screen.getByRole('button', { name: 'Sign-in options' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Public key' }));
    await fireEvent.click(screen.getByRole('button', { name: /Choose private key/ }));
    await screen.findByText('id_ed25519');
    await fireEvent.submit(screen.getByRole('button', { name: 'Login' }).closest('form')!);
    await waitFor(() => expect(mocks.keyLogin).toHaveBeenCalledWith(' Alice ', 'key-1', '', expect.any(Function)));
  });
  it('starts with collapsed options and toggles the icon buttons without changing the selected method', async () => {
    render(LoginPage);
    const toggle = screen.getByRole('button', { name: 'Sign-in options' });
    expect(toggle.querySelector('.material-symbols-outlined')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Public key' })).toBeNull();
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Password' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Public key' }));
    expect(screen.getByRole('button', { name: 'Public key' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Public key' })).toBeNull();
    expect(screen.getByRole('button', { name: /Choose private key/ })).toBeTruthy();
    await fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Public key' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows recovery help beside the password field without an obsolete encryption warning', async () => {
    render(LoginPage);
    expect(screen.queryByRole('heading', { name: 'Sign in with your password' })).toBeNull();
    const recovery = screen.getByRole('button', { name: 'Forgot password?' });
    const field = screen.getByLabelText('Password', { selector: 'input' });
    expect(field.closest('.login-credential-content')?.contains(recovery)).toBe(true);
    await fireEvent.click(recovery);
    const dialog = await screen.findByRole('dialog', { name: 'Forgot Password' });
    expect(dialog.textContent).toContain('contact your system administrator');
    expect(dialog.textContent).not.toContain('data encryption key');
    await fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Sign-in options' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Public key' }));
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sign in with your public key' })).toBeNull();
  });

  it('preserves username and clears the password when changing methods', async () => {
    render(LoginPage);
    await fireEvent.input(usernameControl(), { target: { value: 'alice' } });
    await fireEvent.input(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'secret' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sign-in options' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Public key' }));
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('alice');
    expect(screen.queryByLabelText('Password', { selector: 'input' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Password' }));
    expect((screen.getByLabelText('Password', { selector: 'input' }) as HTMLInputElement).value).toBe('');
  });
  it('does not repeat a public-key request and unlocks a provisioned device without any account password', async () => {
    render(LoginPage);
    const form = await publicKeyForm();
    await fireEvent.submit(form); await fireEvent.submit(form);
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
    expect(mocks.keyLogin).toHaveBeenCalledOnce();
    expect(mocks.keyLogin).toHaveBeenCalledWith('alice', 'key-1', '', expect.any(Function));
    expect(mocks.login).not.toHaveBeenCalled(); expect(mocks.setup).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/home/overview'), { timeout: 3000 });
  });
  it('asks for the old password only when migration is required and cancels without deleting data', async () => {
    mocks.prepare.mockResolvedValue('password_required');
    render(LoginPage);
    await fireEvent.submit(await publicKeyForm());
    await screen.findByRole('dialog', { name: 'Unlock existing data once' });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mocks.clear).toHaveBeenCalled());
    expect(mocks.unlock).not.toHaveBeenCalled(); expect(mocks.tasks).not.toHaveBeenCalled(); expect(mocks.goto).not.toHaveBeenCalled();
    expect(mocks.discard).not.toHaveBeenCalled();
  });
  it('continues public-key sign-in with defaults after confirmed local data deletion without the old password', async () => {
    mocks.prepare.mockResolvedValue('password_required');
    render(LoginPage);
    await fireEvent.submit(await publicKeyForm());
    await screen.findByRole('dialog', { name: 'Unlock existing data once' });
    await fireEvent.click(screen.getByRole('button', { name: 'Forgot the old password? Clear local data' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Clear and continue signing in' }));
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/home/overview'), { timeout: 3000 });
    expect(mocks.discard).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.preferences).toHaveBeenCalled();
    expect(mocks.tasks).toHaveBeenCalled();
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(mocks.setup).not.toHaveBeenCalled();
  });
});
