import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ServerSettings from './ServerSettings.svelte';
import { authStore } from '$lib/features/authentication/auth-state.svelte';
import { serverStateStore } from '$lib/features/connection/connection-state.svelte';

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), confirm: vi.fn() }));
vi.mock('$lib/api', async (original) => ({ ...await original<typeof import('$lib/api')>(), listServerSettings: mocks.list, getServerSettings: mocks.get, updateServerSettings: mocks.update }));
vi.mock('$app/navigation', () => ({ beforeNavigate: vi.fn(), goto: vi.fn() }));
vi.mock('$lib/shared/ui/dialogs.svelte', () => ({ dialogStore: { confirm: mocks.confirm } }));
vi.mock('svelte-i18n', () => ({ _: { subscribe(run: (translate: (key: string) => string) => void) { run((key) => key); return () => {}; } } }));

beforeEach(() => {
  authStore.apply({ user_id: 'uuid', username: 'alice', nickname: null, has_token: true, token_exp: 2e9, permissions: ['view_settings', 'manage_settings'], groups: [] });
  serverStateStore.updateConnection(true, 'server', false);
  mocks.list.mockResolvedValue({ items: [{ namespace: 'policy', option_key: 'limit', title: 'Limit', description: 'Maximum allowed', owner: 'core', schema_version: 1, default: 8, value_schema: { type: 'integer', minimum: 1 } }] });
  mocks.get.mockResolvedValue({ namespace: 'policy', settings: { limit: { value: 4, revision: 3, updated_at: null } } });
  mocks.update.mockResolvedValue({ namespace: 'policy', settings: { limit: { value: 5, revision: 4, updated_at: 1 } } });
  mocks.confirm.mockResolvedValue(false);
});
afterEach(() => { cleanup(); authStore.clear(); serverStateStore.clear(); vi.resetAllMocks(); });

it('saves only the edited value and its revision', async () => {
  render(ServerSettings);
  const input = await screen.findByRole('spinbutton', { name: 'Limit' });
  await fireEvent.input(input, { target: { value: '5' } });
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledExactlyOnceWith('policy', { limit: { value: 5, expected_revision: 3 } }));
  await screen.findByText('serverSettings.saved');
  expect((screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
});
it('preserves a conflicting draft and confirms before discarding it to refresh', async () => {
  mocks.update.mockRejectedValue('Server returned 409: conflict');
  render(ServerSettings);
  const input = await screen.findByRole('spinbutton', { name: 'Limit' });
  await fireEvent.input(input, { target: { value: '9' } });
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await screen.findByRole('alert');
  expect((input as HTMLInputElement).value).toBe('9');
  expect((screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
  await fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(mocks.get).toHaveBeenCalledOnce();
  mocks.confirm.mockResolvedValue(true);
  await fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
  await waitFor(() => expect((screen.getByRole('spinbutton', { name: 'Limit' }) as HTMLInputElement).value).toBe('4'));
});
it('allows read-only discovery and blocks discovery for write-only users', async () => {
  authStore.permissions = ['view_settings'];
  const view = render(ServerSettings);
  const input = await screen.findByRole('spinbutton', { name: 'Limit' });
  expect((input as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText('serverSettings.readOnly')).toBeTruthy();
  view.unmount(); mocks.list.mockClear();
  authStore.permissions = ['manage_settings'];
  render(ServerSettings);
  expect(screen.getByText('serverSettings.readRequired')).toBeTruthy();
  expect(mocks.list).not.toHaveBeenCalled();
});
it('ignores a response from the previous account', async () => {
  let resolve!: (value: unknown) => void;
  mocks.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  render(ServerSettings);
  await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
  authStore.clear();
  resolve({ namespace: 'policy', settings: { limit: { value: 99, revision: 3, updated_at: null } } });
  await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull());
});

it('stages defaults and prevents malformed values from being submitted', async () => {
  render(ServerSettings);
  const input = await screen.findByRole('spinbutton', { name: 'Limit' });
  await fireEvent.click(screen.getByRole('button', { name: 'serverSettings.restoreDefault' }));
  expect((input as HTMLInputElement).value).toBe('8');
  expect(mocks.update).not.toHaveBeenCalled();
  await fireEvent.input(input, { target: { value: '0' } });
  expect(screen.getByText('serverSettings.valueInvalid')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps the current namespace and draft when leaving is cancelled', async () => {
  const definition = (namespace: string) => ({ namespace, option_key: 'limit', title: 'Limit', description: '', owner: 'core', schema_version: 1, default: 8, value_schema: { type: 'integer' } });
  mocks.list.mockResolvedValue({ items: [definition('policy'), definition('other')] });
  mocks.get.mockImplementation(async (namespace: string) => ({ namespace, settings: { limit: { value: 4, revision: 3, updated_at: null } } }));
  render(ServerSettings);
  const input = await screen.findByRole('spinbutton', { name: 'Limit' });
  await fireEvent.input(input, { target: { value: '9' } });
  const selector = screen.getByRole('combobox', { name: 'serverSettings.namespace' });
  await fireEvent.change(selector, { target: { value: 'policy' } });
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect((selector as HTMLSelectElement).value).toBe('other');
  expect((input as HTMLInputElement).value).toBe('9');
  expect(mocks.get).toHaveBeenCalledOnce();
});

it('requires a fresh read after an unconfirmed write without replaying the mutation', async () => {
  mocks.update.mockRejectedValue('CFMS_REQUEST_UNCONFIRMED: response lost');
  render(ServerSettings);
  const input = await screen.findByRole('spinbutton', { name: 'Limit' });
  await fireEvent.input(input, { target: { value: '6' } });
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  expect((await screen.findByRole('alert')).textContent).toContain('protocol30.unconfirmed');
  expect((input as HTMLInputElement).value).toBe('6');
  expect((screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.update).toHaveBeenCalledOnce();
});
