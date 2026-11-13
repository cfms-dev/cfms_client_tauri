import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ChangeUsernameDialog from './ChangeUsernameDialog.svelte';
import { authStore } from './auth-state.svelte';
import { serverStateStore } from '$lib/features/connection/connection-state.svelte';
import { stubInstantAnimations } from '../../../test/dom-fixtures';
const mocks = vi.hoisted(() => ({ save: vi.fn(), elevate: vi.fn(), close: vi.fn(), saved: vi.fn() }));
vi.mock('$lib/api', async (original) => ({ ...await original<typeof import('$lib/api')>(), setUserUsername: mocks.save }));
vi.mock('./escalation.svelte', () => ({ ensureEscalation: mocks.elevate }));
vi.mock('svelte-i18n', () => ({ _: { subscribe(run: (translate: (key: string) => string) => void) { run((key) => key); return () => {}; } } }));
const status = { user_id: 'uuid', username: 'alice', nickname: 'Alice', has_token: true, token_exp: 2e9, permissions: ['set_username'], groups: [] };
beforeEach(() => {
  stubInstantAnimations();
  authStore.apply(status); serverStateStore.updateConnection(true, 'server', false);
  mocks.elevate.mockResolvedValue(true);
  mocks.save.mockResolvedValue({ ...status, username: ' Alice ' });
});
afterEach(() => { cleanup(); authStore.clear(); serverStateStore.clear(); vi.resetAllMocks(); });
function open() { return render(ChangeUsernameDialog, { userId: 'uuid', username: 'alice', onClose: mocks.close, onSaved: mocks.saved }); }

it('preserves exact input and keeps the same authenticated account after saving', async () => {
  open();
  const input = screen.getByRole('textbox', { name: 'settings.account.username' });
  await fireEvent.input(input, { target: { value: ' Alice ' } });
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith('uuid', ' Alice '));
  expect(authStore.userId).toBe('uuid'); expect(authStore.hasToken).toBe(true); expect(authStore.username).toBe(' Alice ');
  await waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
});
it('counts Unicode characters and prevents overlong input', async () => {
  open();
  const input = screen.getByRole('textbox', { name: 'settings.account.username' });
  await fireEvent.input(input, { target: { value: '😀'.repeat(64) } });
  expect((screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(false);
  await fireEvent.input(input, { target: { value: '😀'.repeat(65) } });
  expect((screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
});
it('does not write after cancelled elevation or a revoked business permission', async () => {
  mocks.elevate.mockResolvedValueOnce(false);
  open();
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'new' } });
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(mocks.elevate).toHaveBeenCalledOnce());
  expect(mocks.save).not.toHaveBeenCalled();
  mocks.elevate.mockImplementationOnce(async () => { authStore.permissions = []; return true; });
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  expect(mocks.save).not.toHaveBeenCalled();
});
it('ignores a delayed response after switching accounts', async () => {
  let finish!: (value: typeof status) => void;
  mocks.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  open();
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'new' } });
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  authStore.apply({ ...status, user_id: 'other', username: 'bob' });
  finish({ ...status, username: 'new' });
  await Promise.resolve();
  expect(authStore.username).toBe('bob'); expect(mocks.saved).not.toHaveBeenCalled();
});
