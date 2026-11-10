// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
import EscalationControl from '$lib/features/authentication/EscalationControl.svelte';
import EscalationCountdown from '$lib/features/authentication/EscalationCountdown.svelte';
import { ensureEscalation, escalationFlow } from '$lib/features/authentication/escalation.svelte.ts';

const mocks = vi.hoisted(() => ({ inventory: vi.fn(), escalate: vi.fn(), drop: vi.fn() }));
vi.mock('$lib/api', () => ({ getUserAuthentication: mocks.inventory, requestEscalation: mocks.escalate, dropEscalation: mocks.drop }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));
vi.mock('$lib/shared/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));
vi.mock('$lib/shared/appearance', () => ({ isReducedMotionEnabled: () => true }));
vi.mock('svelte-i18n', () => ({ _: { subscribe(run: (t: (key: string) => string) => void) { run((key) => key); return () => {}; } } }));

const status = { username: 'alice', user_id: 'aabbccdd-0000-4000-8000-000000000001', nickname: 'Alice', has_token: true, token_exp: 2e9, permissions: [], groups: [] };
const emptyPolicy = { escalation: { revision: 0, chains: [] } };

Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: () => ({ cancel() {}, currentTime: 0, effect: {}, finished: Promise.resolve() }),
});

beforeEach(() => {
  authStore.apply(status);
  serverStateStore.connected = true;
  mocks.inventory.mockResolvedValue({ policies: emptyPolicy });
  mocks.escalate.mockResolvedValue({ ...status, escalation_exp: Date.now() / 1000 + 300 });
  mocks.drop.mockResolvedValue({ ...status, escalation_exp: null });
});
afterEach(() => { cleanup(); authStore.clear(); serverStateStore.clear(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('elevation controls', () => {
  it('shares one pending flow and resolves all callers after password verification', async () => {
    mocks.inventory.mockResolvedValue({
      policies: { escalation: { chains: [[{ method: 'password', credential_ids: ['p'] }]] } },
      methods: { password: { purposes: ['escalation'] } },
      credentials: [{ method: 'password', credential_id: 'p', active: true }],
    });
    render(EscalationControl);
    const first = ensureEscalation();
    expect(ensureEscalation()).toBe(first);
    const password = await screen.findByLabelText('login.password');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(mocks.inventory).toHaveBeenCalledOnce();
    await fireEvent.input(password, { target: { value: 'proof' } });
    await fireEvent.click(screen.getByRole('button', { name: 'dialog.twoFactor.verify' }));
    expect(await first).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(escalationFlow.busy).toBe(false);
    expect(await ensureEscalation()).toBe(true);
    expect(mocks.inventory).toHaveBeenCalledOnce();
    expect(mocks.drop).not.toHaveBeenCalled();
  });

  it('returns false when inventory cannot be loaded and allows another attempt', async () => {
    mocks.inventory.mockRejectedValueOnce(new Error('Unavailable'));
    render(EscalationControl);
    expect(await ensureEscalation()).toBe(false);
    expect(mocks.escalate).not.toHaveBeenCalled();
    expect(await ensureEscalation()).toBe(true);
    expect(mocks.inventory).toHaveBeenCalledTimes(2);
  });

  it('can start a fresh verification after cancelling the previous dialog', async () => {
    mocks.inventory.mockResolvedValue({
      policies: { escalation: { chains: [[{ method: 'password', credential_ids: ['p'] }]] } },
      methods: { password: { purposes: ['escalation'] } },
      credentials: [{ method: 'password', credential_id: 'p', active: true }],
    });
    render(EscalationControl);
    const first = ensureEscalation();
    await screen.findByLabelText('login.password');
    await fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(await first).toBe(false);
    const second = ensureEscalation();
    const password = await screen.findByLabelText('login.password');
    await fireEvent.input(password, { target: { value: 'new-proof' } });
    await fireEvent.click(screen.getByRole('button', { name: 'dialog.twoFactor.verify' }));
    expect(await second).toBe(true);
    expect(mocks.inventory).toHaveBeenCalledTimes(2);
    expect(mocks.escalate).toHaveBeenCalledOnce();
  });

  it.each(['cancel', 'disconnect', 'logout', 'unmount'] as const)('settles pending callers on %s and ignores a late result', async (reason) => {
    let finish!: (value: typeof status & { escalation_exp: number }) => void;
    mocks.escalate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { unmount } = render(EscalationControl);
    const pending = ensureEscalation();
    await waitFor(() => expect(mocks.escalate).toHaveBeenCalledOnce());
    if (reason === 'disconnect') serverStateStore.connected = false;
    else if (reason === 'logout') authStore.clear();
    else if (reason === 'unmount') unmount();
    else escalationFlow.cancel();
    await tick();
    expect(await pending).toBe(false);
    finish({ ...status, escalation_exp: Date.now() / 1000 + 300 });
    await tick();
    expect(authStore.escalationExp).toBeNull();
    expect(escalationFlow.busy).toBe(false);
  });

  it('drops elevation on a second click, preserving login and removing the countdown', async () => {
    authStore.escalationExp = Date.now() / 1000 + 300;
    serverStateStore.connected = false;
    render(EscalationControl);
    render(EscalationCountdown);
    const exit = screen.getByRole('button', { name: 'authentication.exitEscalation' });
    expect(exit.getAttribute('data-active')).toBe('true');
    expect(exit.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('timer')).toBeTruthy();
    await fireEvent.click(exit);
    await waitFor(() => expect(authStore.escalationExp).toBeNull());
    expect(mocks.drop).toHaveBeenCalledOnce();
    expect(mocks.inventory).not.toHaveBeenCalled();
    expect(mocks.escalate).not.toHaveBeenCalled();
    expect(authStore.isLoggedIn).toBe(true);
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByRole('button', { name: 'authentication.escalate' }).getAttribute('data-active')).toBe('false');
  });

  it.each([0, 2])('directly exchanges a token for an empty elevation policy at revision %s', async (revision) => {
    mocks.inventory.mockResolvedValue({ policies: { escalation: { revision, chains: [] } } });
    render(EscalationControl);
    await fireEvent.click(screen.getByRole('button', { name: 'authentication.escalate' }));
    await waitFor(() => expect(mocks.escalate).toHaveBeenCalledWith());
    expect(authStore.escalationExp).toBeGreaterThan(Date.now() / 1000);
  });

  it('collects a fresh password only when the escalation policy requires one', async () => {
    mocks.inventory.mockResolvedValue({
      policies: { escalation: { chains: [[{ method: 'password', credential_ids: ['p'] }]] } },
      methods: { password: { purposes: ['escalation'] } },
      credentials: [{ method: 'password', credential_id: 'p', active: true }],
    });
    render(EscalationControl);
    await fireEvent.click(screen.getByRole('button', { name: 'authentication.escalate' }));
    const password = await screen.findByLabelText('login.password');
    expect(mocks.escalate).not.toHaveBeenCalled();
    await fireEvent.input(password, { target: { value: 'fresh-proof' } });
    await fireEvent.click(screen.getByRole('button', { name: 'dialog.twoFactor.verify' }));
    await waitFor(() => expect(mocks.escalate).toHaveBeenCalledWith('password', { password: 'fresh-proof' }));
  });

  it('shows a countdown based on expiry and removes it when the clock reaches expiration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:00:00Z'));
    authStore.escalationExp = Date.now() / 1000 + 2;
    render(EscalationCountdown);
    expect(screen.getByRole('timer').textContent).toContain('00:02');
    await vi.advanceTimersByTimeAsync(2000);
    await tick();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(authStore.isLoggedIn).toBe(true);
  });

  it.each(['totp', 'recovery'])('submits a fresh %s code and keeps elevation inactive on failure', async (kind) => {
    mocks.inventory.mockResolvedValue({
      policies: { escalation: { chains: [[{ method: 'totp', credential_ids: ['t'] }]] } },
      methods: { totp: { purposes: ['escalation'] } },
      credentials: [{ method: 'totp', credential_id: 't', active: true }],
    });
    mocks.escalate.mockRejectedValue(new Error('Invalid verification code'));
    render(EscalationControl);
    await fireEvent.click(screen.getByRole('button', { name: 'authentication.escalate' }));
    await screen.findByLabelText('dialog.twoFactor.enterTotp');
    if (kind === 'recovery') {
      await fireEvent.click(screen.getByRole('button', { name: 'dialog.twoFactor.useRecovery' }));
    }
    const code = kind === 'totp' ? '123456' : 'backup-code';
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: code } });
    if (kind === 'recovery') await fireEvent.click(screen.getByRole('button', { name: 'dialog.twoFactor.verify' }));
    await waitFor(() => expect(mocks.escalate).toHaveBeenCalledWith('totp', { token: code }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(authStore.escalationExp).toBeNull();
    expect(authStore.isLoggedIn).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(mocks.escalate).toHaveBeenCalledTimes(1);
  });

  it('keeps callers pending after invalid verification and completes after a successful retry', async () => {
    mocks.inventory.mockResolvedValue({
      policies: { escalation: { chains: [[{ method: 'totp', credential_ids: ['t'] }]] } },
      methods: { totp: { purposes: ['escalation'] } },
      credentials: [{ method: 'totp', credential_id: 't', active: true }],
    });
    mocks.escalate.mockRejectedValueOnce(new Error('Invalid verification code'));
    render(EscalationControl);
    const completed = vi.fn();
    const pending = ensureEscalation();
    void pending.then(completed);
    await screen.findByLabelText('dialog.twoFactor.enterTotp');
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '123456' } });
    await screen.findByRole('alert');
    expect(completed).not.toHaveBeenCalled();
    expect(authStore.escalationExp).toBeNull();
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '' } });
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '654321' } });
    expect(await pending).toBe(true);
    expect(mocks.escalate).toHaveBeenCalledTimes(2);
  });
});
