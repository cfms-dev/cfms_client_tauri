// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import AuthenticatorSettings from '$lib/features/authentication/authentication/AuthenticatorSettings.svelte';
import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';

const mocks = vi.hoisted(() => ({ status: vi.fn(), managedStatus: vi.fn(), setup: vi.fn(), verify: vi.fn(), cancel: vi.fn(), disable: vi.fn(), managedDisable: vi.fn(), before: vi.fn(), changed: vi.fn() }));
vi.mock('$lib/api', () => ({ getTwoFactorStatus: mocks.status, getManagedTwoFactorStatus: mocks.managedStatus, setupTwoFactor: mocks.setup, validateTwoFactor: mocks.verify, cancelTwoFactorSetup: mocks.cancel, disableTwoFactor: mocks.disable, disableManagedTwoFactor: mocks.managedDisable }));
vi.mock('qrcode', () => ({ toDataURL: async () => 'data:image/png;base64,AA==' }));
vi.mock('svelte-i18n', () => ({ _: { subscribe(run: (t: (key: string) => string) => void) { run((key) => key); return () => {}; } } }));
const userId = 'aabbccdd-0000-4000-8000-000000000001';
beforeEach(() => {
  authStore.apply({ user_id: userId, username: 'alice', nickname: null, has_token: true, token_exp: 2e9, permissions: ['configure_auth_methods'], groups: [] });
  mocks.status.mockResolvedValue({ configured: false, enabled: false, backup_codes_count: 0 });
  mocks.managedStatus.mockResolvedValue({ configured: true, enabled: true, backup_codes_count: 6 });
  mocks.setup.mockResolvedValue({ secret: 'SECRET', provisioning_uri: 'otpauth://totp/account', backup_codes: ['recovery-one', 'recovery-two'] });
  mocks.before.mockResolvedValue(true);
  mocks.verify.mockResolvedValue(undefined); mocks.cancel.mockResolvedValue(undefined);
  mocks.changed.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); authStore.clear(); });
const mount = (user?: string) => render(AuthenticatorSettings, { userId: user, beforeChange: mocks.before, onChanged: mocks.changed });
async function begin() { await fireEvent.click(await screen.findByRole('button', { name: 'settings.twofa.enable' })); await screen.findByText('authManagement.scanCode'); }

describe('authenticator settings', () => {
  it('shows recovery codes only after verification and refreshes policy state', async () => {
    mount(); await begin();
    expect(screen.queryByText('recovery-one')).toBeNull();
    expect(screen.queryByText('otpauth://totp/account')).toBeNull();
    await fireEvent.input(screen.getByLabelText('settings.twofa.verificationCode'), { target: { value: '123456' } });
    await fireEvent.click(screen.getByRole('button', { name: 'settings.twofa.verifyEnable' }));
    expect(await screen.findByText('recovery-one')).toBeTruthy();
    expect(mocks.verify).toHaveBeenCalledWith('123456');
    await waitFor(() => expect(mocks.changed).toHaveBeenCalledTimes(1));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.recoveryDone' }));
    expect(screen.queryByText('recovery-one')).toBeNull();
  });
  it('keeps setup available after an invalid code, then supports cancellation', async () => {
    mocks.verify.mockRejectedValue(new Error('Invalid verification code'));
    mount(); await begin();
    await fireEvent.input(screen.getByLabelText('settings.twofa.verificationCode'), { target: { value: '000000' } });
    await fireEvent.click(screen.getByRole('button', { name: 'settings.twofa.verifyEnable' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid verification code');
    expect(screen.queryByText('recovery-one')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1));
    await screen.findByRole('button', { name: 'settings.twofa.enable' });
  });
  it('does not start setup or verify when unsaved changes remain unresolved', async () => {
    mocks.before.mockResolvedValue(false);
    mount();
    await fireEvent.click(await screen.findByRole('button', { name: 'settings.twofa.enable' }));
    expect(mocks.setup).not.toHaveBeenCalled();
    mocks.before.mockResolvedValue(true); await begin();
    mocks.before.mockResolvedValue(false);
    await fireEvent.input(screen.getByLabelText('settings.twofa.verificationCode'), { target: { value: '123456' } });
    await fireEvent.click(screen.getByRole('button', { name: 'settings.twofa.verifyEnable' }));
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('never uses self-service setup or status APIs for another account', async () => {
    authStore.permissions = ['super_configure_auth_methods', 'super_list_user_auth_methods'];
    mount('other-account');
    await screen.findByRole('button', { name: 'authManagement.disableAuthenticator' });
    expect(mocks.managedStatus).toHaveBeenCalledWith('other-account');
    expect(mocks.status).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'settings.twofa.enable' })).toBeNull();
    expect(screen.queryByLabelText('settings.twofa.currentPassword')).toBeNull();
  });
  it('does not misreport an unavailable status as an unconfigured authenticator', async () => {
    mocks.status.mockRejectedValue(new Error('offline'));
    mount(); await screen.findByRole('alert');
    expect(screen.queryByText('authManagement.notRegistered')).toBeNull();
    expect(screen.queryByRole('button', { name: 'settings.twofa.enable' })).toBeNull();
  });
  it('uses the managed disable API and preserves the target account', async () => {
    authStore.permissions = ['super_configure_auth_methods', 'super_list_user_auth_methods'];
    vi.spyOn(dialogStore, 'confirm').mockResolvedValue(true);
    mocks.managedDisable.mockResolvedValue(true);
    mount('other-account');
    await fireEvent.click(await screen.findByRole('button', { name: 'authManagement.disableAuthenticator' }));
    await waitFor(() => expect(mocks.managedDisable).toHaveBeenCalledWith('other-account'));
    expect(mocks.disable).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.changed).toHaveBeenCalledTimes(1));
  });
  it('shows and cancels a pending registration from a previous session', async () => {
    mocks.status.mockResolvedValueOnce({ configured: true, enabled: false, backup_codes_count: 10 });
    mount();
    expect(await screen.findByText('authManagement.pendingTotp')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'settings.twofa.enable' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.cancelPendingTotp' }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1));
    await screen.findByRole('button', { name: 'settings.twofa.enable' });
  });
  it('allows cross-user inventory without granting configuration', async () => {
    authStore.permissions = ['super_list_user_auth_methods'];
    mount('other-account');
    await screen.findByText('common.enabled');
    expect(mocks.managedStatus).toHaveBeenCalledWith('other-account');
    expect(screen.queryByRole('button', { name: 'authManagement.disableAuthenticator' })).toBeNull();
  });
  it('does not read cross-user inventory with configuration permission alone', async () => {
    authStore.permissions = ['super_configure_auth_methods'];
    mount('other-account');
    await screen.findByText('authManagement.managedAuthenticator');
    expect(mocks.managedStatus).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it('allows self inventory without configuration permission', async () => {
    authStore.permissions = [];
    mount();
    await screen.findByText('authManagement.notRegistered');
    expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'settings.twofa.enable' })).toBeNull();
  });
});
