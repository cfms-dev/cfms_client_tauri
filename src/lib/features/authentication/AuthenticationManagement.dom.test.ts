import { stubInstantAnimations } from '../../../test/dom-fixtures';
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import type { AuthPolicy } from '$lib/api';
import AuthenticationManagement from '$lib/features/authentication/AuthenticationManagement.svelte';
import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';

const mocks = vi.hoisted(() => ({ inventory: vi.fn(), policies: vi.fn(), register: vi.fn(), update: vi.fn(), remove: vi.fn(), totp: vi.fn(), setup: vi.fn(), verify: vi.fn(), cancel: vi.fn(), changePassword: vi.fn(), reset: vi.fn(), clear: vi.fn(), goto: vi.fn() }));
vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  getTwoFactorStatus: mocks.totp, changePassword: mocks.changePassword, clearAuthSession: mocks.clear,
  setupTwoFactor: mocks.setup, validateTwoFactor: mocks.verify, cancelTwoFactorSetup: mocks.cancel,
  resetUserPassword: mocks.reset,
  getUserAuthentication: mocks.inventory, setUserAuthPolicies: mocks.policies,
  registerUserAuthPublicKey: mocks.register, updateUserAuthPublicKey: mocks.update, deleteUserAuthPublicKey: mocks.remove,
}));
vi.mock('$app/navigation', () => ({ beforeNavigate: vi.fn(), goto: mocks.goto }));
vi.mock('$lib/shared/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));
vi.mock('qrcode', () => ({ toDataURL: async () => 'data:image/png;base64,AA==' }));
vi.mock('svelte-i18n', () => ({ _: { subscribe(run: (t: (key: string) => string) => void) { run((key) => key); return () => {}; } } }));
beforeEach(stubInstantAnimations);

const userId = 'aabbccdd-0000-4000-8000-000000000001';
const inventory = (escalation: AuthPolicy = { revision: 0, chains: [] }) => ({
  user_id: userId,
  methods: { password: { purposes: ['login', 'mfa', 'escalation'] }, publickey: { purposes: ['login', 'mfa', 'escalation'] } },
  credentials: [{ method: 'password', credential_id: 'password-id', active: true, label: 'Password', key_identity: null }],
  policies: { login: { revision: 3, chains: [[{ method: 'password', credential_ids: ['password-id'] }]] }, mfa: { revision: 0, chains: [] }, escalation },
});

beforeEach(() => {
  authStore.apply({ user_id: userId, username: 'alice', nickname: 'Alice', has_token: true, token_exp: 2e9, escalation_exp: Date.now() / 1000 + 300, permissions: ['super_configure_auth_methods', 'super_list_user_auth_methods'], groups: [] });
  mocks.inventory.mockResolvedValue(inventory());
  mocks.totp.mockResolvedValue({ configured: false, enabled: false, backup_codes_count: 0 });
  mocks.setup.mockResolvedValue({ secret: 'SECRET', provisioning_uri: 'otpauth://totp/account', backup_codes: ['recovery-code'] });
  mocks.verify.mockResolvedValue(undefined);
  mocks.policies.mockResolvedValue({ policies: { mfa: { revision: 1, chains: [[{ method: 'password', credential_ids: ['password-id'] }]] } } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); authStore.clear(); });

describe('authentication management', () => {
  it('explains duplicate alternatives and prevents submitting them', async () => {
    render(AuthenticationManagement);
    await fireEvent.click(await screen.findByRole('tab', { name: 'authManagement.flowsTab' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.addAlternative' }));
    expect(screen.getByText('authManagement.duplicateAlternatives')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'authManagement.savePolicies' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.policies).not.toHaveBeenCalled();
  });
  it('keeps self inventory read-only without configuration permission', async () => {
    authStore.permissions = [];
    render(AuthenticationManagement);
    await screen.findByText('authManagement.readOnly');
    expect((screen.getByRole('button', { name: 'authManagement.addKey' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'settings.password.action' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'settings.twofa.enable' })).toBeNull();
  });
  it('does not read another account with configuration permission alone', async () => {
    authStore.permissions = ['super_configure_auth_methods'];
    render(AuthenticationManagement, { userId: 'other-account' });
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
    expect(mocks.inventory).not.toHaveBeenCalled();
  });
  it('reloads server-pruned policies and revisions after deleting a public key', async () => {
    const original = inventory();
    const credential = { method: 'publickey', credential_id: 'key-id', active: true, label: 'Work key', key_identity: null };
    original.credentials.push(credential);
    original.policies.escalation = { revision: 4, chains: [[{ method: 'publickey', credential_ids: ['key-id'] }]] };
    mocks.inventory.mockResolvedValueOnce(original).mockResolvedValue(inventory({ revision: 5, chains: [] }));
    mocks.remove.mockResolvedValue({ credential_id: 'key-id' });
    vi.spyOn(dialogStore, 'confirm').mockResolvedValue(true);
    render(AuthenticationManagement);
    await fireEvent.click(await screen.findByRole('button', { name: 'common.delete' }));
    await waitFor(() => expect(mocks.inventory).toHaveBeenCalledTimes(2));
    await fireEvent.click(screen.getByRole('tab', { name: 'authManagement.flowsTab' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.purposes.escalation' }));
    expect(screen.getByText('authManagement.empty.escalation')).toBeTruthy();
    expect(screen.queryByText('authManagement.unsaved')).toBeNull();
  });
  it('keeps unsaved policy edits until refresh is confirmed', async () => {
    const confirm = vi.spyOn(dialogStore, 'confirm').mockResolvedValue(false);
    render(AuthenticationManagement);
    await fireEvent.click(await screen.findByRole('tab', { name: 'authManagement.flowsTab' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.purposes.mfa' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.addAlternative' }));

    await fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.inventory).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'authManagement.savePolicies' }) as HTMLButtonElement).disabled).toBe(false);

    confirm.mockResolvedValue(true);
    await fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
    await waitFor(() => expect(mocks.inventory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'authManagement.savePolicies' })).toBeNull());
  });

  it('reads another account by UUID and keeps writes disabled without elevation', async () => {
    authStore.escalationExp = null;
    const otherId = 'other-account-uuid';
    mocks.inventory.mockResolvedValue({ ...inventory(), user_id: otherId });
    render(AuthenticationManagement, { userId: otherId, username: 'bob' });
    await screen.findByRole('heading', { name: 'authentication.password' });
    expect(mocks.inventory).toHaveBeenCalledWith(otherId);
    expect(mocks.totp).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'authManagement.addKey' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('authManagement.elevationRequired').getAttribute('role')).toBe('status');
  });

  it('submits only modified policies with their original revisions and preserves edits on conflict', async () => {
    mocks.policies.mockRejectedValue(new Error('Server returned 409: Conflict\nCFMS_ERROR_DATA:{"reason":"revision_conflict"}'));
    render(AuthenticationManagement, { userId });
    await screen.findByRole('tab', { name: 'authManagement.flowsTab' });
    await fireEvent.click(screen.getByRole('tab', { name: 'authManagement.flowsTab' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.purposes.mfa' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.addAlternative' }));
    const group = screen.getByRole('group');
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.savePolicies' }));
    await waitFor(() => expect(mocks.policies).toHaveBeenCalledWith([{ purpose: 'mfa', expected_revision: 0, chains: [[{ method: 'password', credential_ids: ['password-id'] }]] }], userId));
    expect((await screen.findByRole('alert')).textContent).toBe('authManagement.errors.revision_conflict');
    expect((within(group).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'authManagement.savePolicies' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('registers a public key without granting it a policy', async () => {
    mocks.register.mockResolvedValue({ credential_id: 'key-id', fingerprint: 'abc123', label: 'Work key' });
    render(AuthenticationManagement);
    await screen.findByRole('heading', { name: 'authentication.password' });
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.addKey' }));
    await fireEvent.input(screen.getByLabelText('authManagement.publicKey'), { target: { value: 'ssh-ed25519 AAAA' } });
    await fireEvent.input(screen.getByLabelText('authManagement.keyLabel'), { target: { value: 'Work key' } });
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.registerKey' }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith('ssh-ed25519 AAAA', 'Work key', undefined));
    expect(await screen.findByText('Work key')).toBeTruthy();
    expect(mocks.policies).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'authManagement.savePolicies' })).toBeNull();
  });

  it.each([undefined, 'other-account-uuid'])('clears all elevation alternatives for %s using the current revision only after saving', async (target) => {
    const original = inventory();
    original.policies.escalation = { revision: 7, chains: [original.policies.login.chains[0], original.policies.login.chains[0]] };
    mocks.inventory.mockResolvedValue({ ...original, user_id: target ?? userId });
    mocks.policies.mockResolvedValue({ policies: { escalation: { revision: 8, chains: [] } } });
    render(AuthenticationManagement, { userId: target });
    await fireEvent.click(await screen.findByRole('tab', { name: 'authManagement.flowsTab' }));
    expect(screen.queryByRole('button', { name: 'authManagement.clearEscalation' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.purposes.escalation' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.clearEscalation' }));
    expect(screen.getByText('authManagement.empty.escalation')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'authManagement.selectedStep' })).toBeNull();
    expect(mocks.policies).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('tab', { name: 'authManagement.methodsTab' }));
    await fireEvent.click(screen.getByRole('tab', { name: 'authManagement.flowsTab' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.savePolicies' }));
    await waitFor(() => expect(mocks.policies).toHaveBeenCalledWith([
      { purpose: 'escalation', expected_revision: 7, chains: [] },
    ], target));
    await waitFor(() => expect(screen.queryByText('authManagement.unsaved')).toBeNull());
    expect(screen.getByText('authManagement.empty.escalation')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'authManagement.clearEscalation' })).toBeNull();
  });

  it('can clear elevation by deleting its last alternative and preserves the empty draft on conflict', async () => {
    const original = inventory();
    original.policies.escalation = { revision: 1, chains: original.policies.login.chains };
    mocks.inventory.mockResolvedValue(original);
    mocks.policies.mockRejectedValue(new Error('Server returned 409: Conflict\nCFMS_ERROR_DATA:{"reason":"revision_conflict"}'));
    render(AuthenticationManagement);
    await fireEvent.click(await screen.findByRole('tab', { name: 'authManagement.flowsTab' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.purposes.escalation' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.removeAlternative' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.savePolicies' }));
    await waitFor(() => expect(mocks.policies).toHaveBeenCalledWith([
      { purpose: 'escalation', expected_revision: 1, chains: [] },
    ], undefined));
    expect((await screen.findByRole('alert')).textContent).toBe('authManagement.errors.revision_conflict');
    expect(screen.getByText('authManagement.empty.escalation')).toBeTruthy();
    expect(screen.getByText('authManagement.unsaved')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'authManagement.savePolicies' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('prevents clearing or saving an elevation policy after elevation expires', async () => {
    const original = inventory();
    original.policies.escalation = { revision: 1, chains: original.policies.login.chains };
    mocks.inventory.mockResolvedValue(original);
    render(AuthenticationManagement);
    await fireEvent.click(await screen.findByRole('tab', { name: 'authManagement.flowsTab' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.purposes.escalation' }));
    const clear = screen.getByRole('button', { name: 'authManagement.clearEscalation' }) as HTMLButtonElement;
    authStore.escalationExp = null;
    await waitFor(() => expect(clear.disabled).toBe(true));
    await fireEvent.click(clear);
    expect(screen.queryByText('authManagement.empty.escalation')).toBeNull();
    authStore.escalationExp = Date.now() / 1000 + 300;
    await waitFor(() => expect(clear.disabled).toBe(false));
    await fireEvent.click(clear);
    authStore.escalationExp = null;
    const save = screen.getByRole('button', { name: 'authManagement.savePolicies' }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(true));
    await fireEvent.click(save);
    expect(mocks.policies).not.toHaveBeenCalled();
  });

  it('preserves drafts across purposes and tabs, and saves all changes atomically', async () => {
    mocks.policies.mockResolvedValue({ policies: {
      mfa: { revision: 1, chains: [[{ method: 'password', credential_ids: ['password-id'] }]] },
      escalation: { revision: 1, chains: [[{ method: 'password', credential_ids: ['password-id'] }]] },
    } });
    render(AuthenticationManagement);
    await fireEvent.click(await screen.findByRole('tab', { name: 'authManagement.flowsTab' }));
    for (const purpose of ['mfa', 'escalation']) {
      await fireEvent.click(screen.getByRole('button', { name: `authManagement.purposes.${purpose}` }));
      await fireEvent.click(screen.getByRole('button', { name: 'authManagement.addAlternative' }));
    }
    await fireEvent.click(screen.getByRole('tab', { name: 'authManagement.methodsTab' }));
    await fireEvent.click(screen.getByRole('tab', { name: 'authManagement.flowsTab' }));
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.savePolicies' }));
    await waitFor(() => expect(mocks.policies).toHaveBeenCalledWith([
      { purpose: 'mfa', expected_revision: 0, chains: [[{ method: 'password', credential_ids: ['password-id'] }]] },
      { purpose: 'escalation', expected_revision: 0, chains: [[{ method: 'password', credential_ids: ['password-id'] }]] },
    ], undefined));
    expect(screen.queryByText('authManagement.unsaved')).toBeNull();
  });

  it('adds ordered public-key steps and edits the selected graph node', async () => {
    const keyInventory = {
      ...inventory(),
      credentials: ['a', 'b'].map((id) => ({ method: 'publickey', credential_id: id, active: true, label: `Key ${id}`, key_identity: id })),
      policies: { ...inventory().policies, login: { revision: 3, chains: [[{ method: 'publickey', credential_ids: ['a'] }]] } },
    };
    mocks.inventory.mockResolvedValue(keyInventory);
    render(AuthenticationManagement);
    await fireEvent.click(await screen.findByRole('tab', { name: 'authManagement.flowsTab' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.addStep' }));
    expect((screen.getByRole('button', { name: 'authManagement.savePolicies' }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Key b' }));
    expect(screen.queryByText('authManagement.distinctKeysUnavailable')).toBeNull();
    await fireEvent.click(screen.getAllByRole('button', { name: /authManagement.selectedStep: authentication.publickey/ })[0]);
    expect((screen.getByRole('checkbox', { name: 'Key a' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Key b' }) as HTMLInputElement).checked).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.savePolicies' }));
    await waitFor(() => expect(mocks.policies).toHaveBeenCalledWith([
      { purpose: 'login', expected_revision: 3, chains: [[{ method: 'publickey', credential_ids: ['a'] }, { method: 'publickey', credential_ids: ['b'] }]] },
    ], undefined));
  });

  it('does not offer extra password steps and stops policy editing when elevation expires', async () => {
    render(AuthenticationManagement);
    await fireEvent.click(await screen.findByRole('tab', { name: 'authManagement.flowsTab' }));
    expect(screen.queryByRole('button', { name: 'authManagement.addStep' })).toBeNull();
    authStore.escalationExp = null;
    await waitFor(() => expect((screen.getByRole('button', { name: 'authManagement.addAlternative' }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('asks before discarding an unsaved flow when the administrator closes it', async () => {
    const confirm = vi.spyOn(dialogStore, 'confirm').mockResolvedValue(false);
    const { component } = render(AuthenticationManagement);
    await fireEvent.click(await screen.findByRole('tab', { name: 'authManagement.flowsTab' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.purposes.mfa' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.addAlternative' }));
    expect(await component.canLeave()).toBe(false);
    expect(screen.getByText('authManagement.unsaved')).toBeTruthy();
    confirm.mockResolvedValue(true);
    expect(await component.canLeave()).toBe(true);
  });

  it('uses the existing password dialog and returns to login after a self-service change', async () => {
    const success = vi.spyOn(notificationStore, 'success');
    authStore.permissions = ['configure_auth_methods'];
    mocks.changePassword.mockResolvedValue(undefined); mocks.clear.mockResolvedValue(undefined); mocks.goto.mockResolvedValue(undefined);
    render(AuthenticationManagement);
    await fireEvent.click(await screen.findByRole('button', { name: 'settings.password.action' }));
    expect(screen.getByText('settings.password.tip')).toBeTruthy();
    expect(screen.queryByLabelText('dialog.changePassword.currentPassword')).toBeNull();
    await fireEvent.input(screen.getByLabelText('dialog.changePassword.newPassword'), { target: { value: 'new-password' } });
    await fireEvent.click(screen.getByRole('button', { name: /dialog.changePassword.title/ }));
    await waitFor(() => expect(mocks.changePassword).toHaveBeenCalledWith('alice', 'new-password'));
    await waitFor(() => expect(mocks.goto).toHaveBeenCalledWith('/login', { replaceState: true }));
    expect(mocks.clear).toHaveBeenCalled();
    expect(authStore.isLoggedIn).toBe(false);
    expect(success).toHaveBeenCalledWith('settings.password.changed');
  });

  it.each(['setup', 'recovery'])('preserves the policy draft when the second leave confirmation is cancelled (%s)', async (phase) => {
    const { component } = render(AuthenticationManagement);
    await fireEvent.click(await screen.findByRole('button', { name: 'settings.twofa.enable' }));
    await screen.findByText('authManagement.scanCode');
    if (phase === 'recovery') {
      await fireEvent.input(screen.getByLabelText('settings.twofa.verificationCode'), { target: { value: '123456' } });
      await fireEvent.click(screen.getByRole('button', { name: 'settings.twofa.verifyEnable' }));
      await screen.findByText('recovery-code');
    }
    await fireEvent.click(screen.getByRole('tab', { name: 'authManagement.flowsTab' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.purposes.mfa' }));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.addAlternative' }));
    vi.spyOn(dialogStore, 'confirm').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await component.canLeave()).toBe(false);
    expect(screen.getByText('authManagement.unsaved')).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('resets the selected account password without signing out the administrator', async () => {
    authStore.permissions = ['super_configure_auth_methods', 'super_list_user_auth_methods'];
    mocks.reset.mockResolvedValue(true);
    mocks.inventory.mockResolvedValue({ ...inventory(), user_id: 'other-account' });
    render(AuthenticationManagement, { userId: 'other-account', username: 'bob' });
    await fireEvent.click(await screen.findByRole('button', { name: 'manage.resetPassword' }));
    const dialog = await screen.findByRole('dialog');
    await fireEvent.input(within(dialog).getByLabelText('dialog.changePassword.newPassword'), { target: { value: 'new-password' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'manage.resetPassword' }));
    await waitFor(() => expect(mocks.reset).toHaveBeenCalledWith('other-account', 'new-password', false, false));
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(authStore.isLoggedIn).toBe(true);
  });
});
