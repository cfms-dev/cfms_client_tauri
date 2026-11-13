import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ServerSettings from './ServerSettings.svelte';
import { authStore } from '$lib/features/authentication/auth-state.svelte';
import { serverStateStore } from '$lib/features/connection/connection-state.svelte';

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn(), confirm: vi.fn() }));
vi.mock('$lib/api', async (original) => ({ ...await original<typeof import('$lib/api')>(), listServerSettings: mocks.list, getServerSettings: mocks.get, updateServerSettings: mocks.update }));
vi.mock('$app/navigation', () => ({ beforeNavigate: vi.fn(), goto: vi.fn() }));
vi.mock('$lib/shared/ui/dialogs.svelte', () => ({ dialogStore: { confirm: mocks.confirm } }));
vi.mock('$lib/shared/motion/transitions', () => ({ menuScale: () => ({ duration: 0 }) }));
vi.mock('svelte-i18n', () => ({ _: { subscribe(run: (translate: (key: string) => string) => void) { run((key) => key); return () => {}; } } }));

beforeEach(() => {
  authStore.apply({ user_id: 'uuid', username: 'alice', nickname: null, has_token: true, token_exp: 2e9, permissions: ['view_settings', 'manage_settings'], groups: [] });
  serverStateStore.updateConnection(true, 'server', false);
  mocks.list.mockResolvedValue({ items: [{ namespace: 'policy', option_key: 'limit', title: 'Limit', description: 'Maximum allowed', owner: 'core', schema_version: 1, default: 8, value_schema: { type: 'integer', minimum: 1 } }] });
  mocks.get.mockResolvedValue({ namespace: 'policy', settings: { limit: { value: 4, revision: 3, updated_at: null } } });
  mocks.update.mockResolvedValue({ namespace: 'policy', settings: { limit: { value: 5, revision: 4, updated_at: 1 } } });
  mocks.confirm.mockResolvedValue(false);
});
afterEach(() => { cleanup(); authStore.clear(); serverStateStore.clear(); vi.resetAllMocks(); vi.useRealTimers(); });

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
  const view = render(ServerSettings);
  const input = await screen.findByRole('spinbutton', { name: 'Limit' });
  await fireEvent.input(input, { target: { value: '9' } });
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await screen.findByRole('alert');
  expect((input as HTMLInputElement).value).toBe('9');
  expect((screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
  await view.component.refresh();
  expect(mocks.confirm).toHaveBeenCalledOnce();
  expect(mocks.get).toHaveBeenCalledOnce();
  mocks.confirm.mockResolvedValue(true);
  await view.component.refresh();
  await waitFor(() => expect((screen.getByRole('spinbutton', { name: 'Limit' }) as HTMLInputElement).value).toBe('4'));
});
it('exposes refresh availability and ignores duplicate requests during discovery and reading', async () => {
  let finishDiscovery!: (value: unknown) => void;
  let finishRead!: (value: unknown) => void;
  mocks.list.mockImplementationOnce(() => new Promise((resolve) => { finishDiscovery = resolve; }));
  mocks.get.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  const view = render(ServerSettings);
  expect(view.component.refreshState).toEqual({ disabled: true, busy: true });
  await view.component.refresh();
  expect(mocks.list).toHaveBeenCalledOnce();
  finishDiscovery({ items: [{ namespace: 'policy', option_key: 'enabled', title: 'Enabled', description: '', owner: 'core', schema_version: 1, default: false, value_schema: { type: 'boolean' } }] });
  await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
  await view.component.refresh();
  expect(mocks.list).toHaveBeenCalledOnce();
  expect(view.component.refreshState.busy).toBe(true);
  finishRead({ namespace: 'policy', settings: { enabled: { value: true, revision: 1, updated_at: null } } });
  await screen.findByRole('switch', { name: 'Enabled' });
  expect(view.component.refreshState).toEqual({ disabled: false, busy: false });
  expect(screen.queryByRole('button', { name: 'common.refresh' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'serverSettings.title' })).toBeNull();
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

it('keeps drafts across optional namespace filters and saves hidden edits', async () => {
  const definition = (namespace: string) => ({ namespace, option_key: 'limit', title: 'Limit', description: '', owner: 'core', schema_version: 1, default: 8, value_schema: { type: 'integer' } });
  mocks.list.mockResolvedValue({ items: [definition('policy'), definition('other')] });
  mocks.get.mockImplementation(async (namespace: string) => ({ namespace, settings: { limit: { value: 4, revision: 3, updated_at: null } } }));
  render(ServerSettings);
  const inputs = await screen.findAllByRole('spinbutton', { name: 'Limit' });
  await waitFor(() => expect(screen.getAllByRole('spinbutton')).toHaveLength(2));
  const input = inputs[0];
  await fireEvent.input(input, { target: { value: '9' } });
  await applyNamespaceFilters(['policy']);
  expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
  expect(mocks.confirm).not.toHaveBeenCalled();
  mocks.update.mockImplementation(async (namespace, changes) => ({ namespace, settings: { limit: { value: changes.limit.value, revision: 4, updated_at: 1 } } }));
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledExactlyOnceWith('other', { limit: { value: 9, expected_revision: 3 } }));
  expect(mocks.get).toHaveBeenCalledTimes(2);
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


async function applyNamespaceFilters(names: string[]) {
  await fireEvent.click(screen.getByRole('button', { name: 'serverSettings.filterButton' }));
  for (const name of names) await fireEvent.click(screen.getByRole('option', { name }));
  await fireEvent.click(screen.getByRole('button', { name: 'serverSettings.filterApply' }));
}
function definition(namespace: string) {
  return { namespace, option_key: 'limit', title: `Limit ${namespace}`, description: `Maximum ${namespace}`, owner: 'core', schema_version: 1, default: 8, value_schema: { type: 'integer', minimum: 1 } };
}
function values(namespace: string, value = 4, revision = 3) {
  return { namespace, settings: { limit: { value, revision, updated_at: null } } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('lets a ready namespace save while another is loading and preserves later edits', async () => {
  const pending = deferred<ReturnType<typeof values>>();
  mocks.list.mockResolvedValue({ items: [definition('b'), definition('a')] });
  mocks.get.mockImplementation((ns) => ns === 'a' ? Promise.resolve(values(ns)) : pending.promise);
  mocks.update.mockResolvedValue(values('a', 5, 4));
  const view = render(ServerSettings);
  const input = await screen.findByRole('spinbutton', { name: 'Limit a' });
  expect(screen.queryByRole('spinbutton', { name: 'Limit b' })).toBeNull();
  expect(view.component.refreshState.busy).toBe(true);
  expect(screen.getByText('b::limit')).toBeTruthy();
  expect(screen.queryByText('core::limit')).toBeNull();
  const search = screen.getByRole('searchbox');
  search.focus();
  await fireEvent.input(input, { target: { value: '5' } });
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await screen.findByText('serverSettings.saved');
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith('a', { limit: { value: 5, expected_revision: 3 } });
  await fireEvent.input(input, { target: { value: '6' } });
  pending.resolve(values('b'));
  await screen.findByRole('spinbutton', { name: 'Limit b' });
  expect((input as HTMLInputElement).value).toBe('6');
  expect(document.activeElement).toBe(search);
  expect(view.component.refreshState.busy).toBe(false);
});

it('caps concurrent reads at four and prioritizes the current filter for queued reads', async () => {
  const pending = new Map<string, ReturnType<typeof deferred<ReturnType<typeof values>>>>();
  mocks.list.mockResolvedValue({ items: ['a', 'b', 'c', 'd', 'e', 'f'].map(definition) });
  mocks.get.mockImplementation((ns) => { const request = deferred<ReturnType<typeof values>>(); pending.set(ns, request); return request.promise; });
  render(ServerSettings);
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(4));
  expect(mocks.get.mock.calls.map(([ns]) => ns)).toEqual(['a', 'b', 'c', 'd']);
  await applyNamespaceFilters(['f']);
  pending.get('a')!.resolve(values('a'));
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(5));
  expect(mocks.get.mock.calls[4][0]).toBe('f');
  pending.get('f')!.resolve(values('f'));
  await screen.findByRole('spinbutton', { name: 'Limit f' });
  await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(6));
  expect(mocks.get.mock.calls[5][0]).toBe('e');
});

it('combines multi-selection with search against full definitions, including unloaded items', async () => {
  mocks.list.mockResolvedValue({ items: ['a', 'b', 'c'].map(definition) });
  mocks.get.mockImplementation(() => new Promise(() => {}));
  render(ServerSettings);
  await screen.findByText('a::limit');
  await applyNamespaceFilters(['a', 'c']);
  expect(screen.queryByText('b::limit')).toBeNull();
  expect(screen.getByText('c::limit')).toBeTruthy();
  await fireEvent.input(screen.getByRole('searchbox'), { target: { value: ' C::LIMIT ' } });
  expect(screen.getByText('c::limit')).toBeTruthy();
  expect(screen.queryByText('a::limit')).toBeNull();
  expect(screen.queryByText('serverSettings.noMatches')).toBeNull();
  expect(screen.queryByRole('spinbutton')).toBeNull();
  expect(screen.queryByRole('button', { name: 'serverSettings.restoreDefault' })).toBeNull();
});

it('isolates same-key values, input IDs, resets, and revisions across namespaces', async () => {
  mocks.list.mockResolvedValue({ items: ['a', 'b'].map(definition) });
  mocks.get.mockImplementation(async (ns) => values(ns, ns === 'a' ? 4 : 6, ns === 'a' ? 3 : 9));
  mocks.update.mockImplementation(async (ns, changes) => values(ns, changes.limit.value, 10));
  render(ServerSettings);
  const a = await screen.findByRole('spinbutton', { name: 'Limit a' });
  const b = await screen.findByRole('spinbutton', { name: 'Limit b' });
  expect(a.id).not.toBe(b.id);
  await fireEvent.input(a, { target: { value: '5' } });
  await fireEvent.click(screen.getAllByRole('button', { name: 'serverSettings.restoreDefault' })[1]);
  expect((b as HTMLInputElement).value).toBe('8');
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await screen.findByText('serverSettings.saved');
  expect(mocks.update.mock.calls).toEqual([
    ['a', { limit: { value: 5, expected_revision: 3 } }],
    ['b', { limit: { value: 8, expected_revision: 9 } }],
  ]);
});

it('blocks saving an invalid draft even when it is hidden by filters', async () => {
  mocks.list.mockResolvedValue({ items: ['a', 'b'].map(definition) });
  mocks.get.mockImplementation(async (ns) => values(ns));
  render(ServerSettings);
  const a = await screen.findByRole('spinbutton', { name: 'Limit a' });
  await fireEvent.input(a, { target: { value: '0' } });
  await applyNamespaceFilters(['b']);
  expect(screen.queryByRole('spinbutton', { name: 'Limit a' })).toBeNull();
  expect(screen.getByText('serverSettings.invalidDrafts')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
  await fireEvent.click(screen.getByRole('button', { name: 'serverSettings.clearFilters' }));
  expect((screen.getByRole('spinbutton', { name: 'Limit a' }) as HTMLInputElement).value).toBe('0');
});

it('retries only failed reads and preserves ready drafts', async () => {
  mocks.list.mockResolvedValue({ items: ['a', 'b'].map(definition) });
  mocks.get.mockImplementation(async (ns) => { if (ns === 'b') throw 'CFMS_SETTINGS_READ_TIMEOUT'; return values(ns); });
  render(ServerSettings);
  const a = await screen.findByRole('spinbutton', { name: 'Limit a' });
  await fireEvent.input(a, { target: { value: '7' } });
  await screen.findByText(/serverSettings.readTimeout/);
  expect(screen.getByText('serverSettings.notLoaded')).toBeTruthy();
  mocks.get.mockResolvedValueOnce(values('b'));
  await fireEvent.click(screen.getByRole('button', { name: 'serverSettings.retryNamespace' }));
  await screen.findByRole('spinbutton', { name: 'Limit b' });
  expect((a as HTMLInputElement).value).toBe('7');
  expect(mocks.get.mock.calls.map(([ns]) => ns)).toEqual(['a', 'b', 'b']);
});

it('reports partial save success, stops subsequent writes and retains remaining drafts', async () => {
  mocks.list.mockResolvedValue({ items: ['a', 'b', 'c'].map(definition) });
  mocks.get.mockImplementation(async (ns) => values(ns));
  mocks.update.mockImplementation(async (ns, changes) => { if (ns === 'b') throw 'Server returned 409: conflict'; return values(ns, changes.limit.value, 4); });
  render(ServerSettings);
  for (const ns of ['a', 'b', 'c']) {
    const input = await screen.findByRole('spinbutton', { name: `Limit ${ns}` });
    await fireEvent.input(input, { target: { value: '5' } });
  }
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await screen.findByText('serverSettings.partiallySaved');
  expect(screen.getByRole('alert').textContent).toContain('b: serverSettings.conflict');
  expect(mocks.update.mock.calls.map(([ns]) => ns)).toEqual(['a', 'b']);
  expect((screen.getByRole('spinbutton', { name: 'Limit b' }) as HTMLInputElement).value).toBe('5');
  expect((screen.getByRole('spinbutton', { name: 'Limit c' }) as HTMLInputElement).value).toBe('5');
  expect((screen.getByRole('button', { name: 'common.save' }) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps discovery failures distinct from empty settings and supports retry', async () => {
  mocks.list.mockRejectedValueOnce('CFMS_SETTINGS_READ_TIMEOUT');
  render(ServerSettings);
  await screen.findByText('serverSettings.readTimeout');
  expect(screen.queryByText('serverSettings.empty')).toBeNull();
  await fireEvent.click(screen.getByRole('button', { name: 'serverSettings.retry' }));
  await screen.findByRole('spinbutton', { name: 'Limit' });
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it('reveals slow-loading guidance after five seconds without hiding ready controls', async () => {
  vi.useFakeTimers();
  mocks.list.mockResolvedValue({ items: ['a', 'b'].map(definition) });
  mocks.get.mockImplementation((ns) => ns === 'a' ? Promise.resolve(values(ns)) : new Promise(() => {}));
  render(ServerSettings);
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.getByRole('spinbutton', { name: 'Limit a' })).toBeTruthy();
  expect(screen.queryByText('serverSettings.slowLoading')).toBeNull();
  await vi.advanceTimersByTimeAsync(5000);
  expect(screen.getByText('serverSettings.slowLoading')).toBeTruthy();
  expect((screen.getByRole('spinbutton', { name: 'Limit a' }) as HTMLInputElement).disabled).toBe(false);
});


it('retries all failed namespaces without re-reading a healthy namespace', async () => {
  mocks.list.mockResolvedValue({ items: ['a', 'b', 'c'].map(definition) });
  mocks.get.mockImplementation(async (ns) => { if (ns !== 'a') throw 'offline'; return values(ns); });
  render(ServerSettings);
  const a = await screen.findByRole('spinbutton', { name: 'Limit a' });
  await fireEvent.input(a, { target: { value: '7' } });
  await screen.findByRole('button', { name: 'serverSettings.retryFailed' });
  mocks.get.mockImplementation(async (ns) => values(ns));
  await fireEvent.click(screen.getByRole('button', { name: 'serverSettings.retryFailed' }));
  await screen.findByRole('spinbutton', { name: 'Limit c' });
  expect(mocks.get.mock.calls.map(([ns]) => ns)).toEqual(['a', 'b', 'c', 'b', 'c']);
  expect((a as HTMLInputElement).value).toBe('7');
});

it('allows leaving during background reads and confirms only when a draft exists', async () => {
  mocks.list.mockResolvedValue({ items: ['a', 'b'].map(definition) });
  mocks.get.mockImplementation((ns) => ns === 'a' ? Promise.resolve(values(ns)) : new Promise(() => {}));
  const view = render(ServerSettings);
  const a = await screen.findByRole('spinbutton', { name: 'Limit a' });
  expect(await view.component.canLeave()).toBe(true);
  expect(mocks.confirm).not.toHaveBeenCalled();
  await fireEvent.input(a, { target: { value: '7' } });
  expect(await view.component.canLeave()).toBe(false);
  expect(mocks.confirm).toHaveBeenCalledOnce();
  await view.component.refresh();
  expect(mocks.list).toHaveBeenCalledOnce();
});

it('locks a save batch while filters remain usable and preserves unrelated late reads', async () => {
  const reading = deferred<ReturnType<typeof values>>();
  const saving = deferred<ReturnType<typeof values>>();
  mocks.list.mockResolvedValue({ items: ['a', 'b'].map(definition) });
  mocks.get.mockImplementation((ns) => ns === 'a' ? Promise.resolve(values(ns)) : reading.promise);
  mocks.update.mockReturnValue(saving.promise);
  const view = render(ServerSettings);
  const a = await screen.findByRole('spinbutton', { name: 'Limit a' });
  await fireEvent.input(a, { target: { value: '5' } });
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  expect((a as HTMLInputElement).disabled).toBe(true);
  expect(await view.component.canLeave()).toBe(false);
  expect(mocks.confirm).not.toHaveBeenCalled();
  await applyNamespaceFilters(['b']);
  reading.resolve(values('b'));
  const b = await screen.findByRole('spinbutton', { name: 'Limit b' });
  expect((b as HTMLInputElement).disabled).toBe(true);
  saving.resolve(values('a', 5, 4));
  await screen.findByText('serverSettings.saved');
  expect((b as HTMLInputElement).disabled).toBe(false);
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith('a', { limit: { value: 5, expected_revision: 3 } });
});

it('never offers custom namespaces and cancels staged selection without changing the list', async () => {
  mocks.list.mockResolvedValue({ items: ['a', 'b'].map(definition) });
  mocks.get.mockImplementation(async (ns) => values(ns));
  render(ServerSettings);
  await screen.findByRole('spinbutton', { name: 'Limit a' });
  await fireEvent.click(screen.getByRole('button', { name: 'serverSettings.filterButton' }));
  const panel = screen.getByRole('dialog');
  expect(panel.parentElement).toBe(document.body);
  await fireEvent.click(screen.getByRole('option', { name: 'a' }));
  const search = screen.getByRole('textbox', { name: 'serverSettings.filterSearch' });
  await fireEvent.input(search, { target: { value: 'nonexistent' } });
  await fireEvent.keyDown(search, { key: 'Enter' });
  expect(screen.queryByRole('option')).toBeNull();
  await fireEvent.keyDown(panel, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getAllByRole('spinbutton')).toHaveLength(2);
  await fireEvent.click(screen.getByRole('button', { name: 'serverSettings.filterButton' }));
  expect(screen.getByRole('option', { name: 'a' }).getAttribute('aria-selected')).toBe('false');
  await fireEvent.keyDown(screen.getByRole('textbox', { name: 'serverSettings.filterSearch' }), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('option', { name: 'a' }));
  await fireEvent.keyDown(screen.getByRole('option', { name: 'a' }), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('option', { name: 'b' }));
});

it('keeps account changes from applying a late namespace result to the new session', async () => {
  const oldRead = deferred<ReturnType<typeof values>>();
  mocks.list.mockResolvedValue({ items: [definition('a')] });
  mocks.get.mockReturnValueOnce(oldRead.promise).mockResolvedValue(values('a', 6, 9));
  render(ServerSettings);
  await waitFor(() => expect(mocks.get).toHaveBeenCalledOnce());
  authStore.userId = 'different-account';
  const a = await screen.findByRole('spinbutton', { name: 'Limit a' });
  await fireEvent.input(a, { target: { value: '7' } });
  oldRead.resolve(values('a', 99, 99));
  await Promise.resolve();
  await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'limit' } });
  expect((a as HTMLInputElement).value).toBe('7');
  mocks.update.mockResolvedValue(values('a', 7, 10));
  await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await screen.findByText('serverSettings.saved');
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith('a', { limit: { value: 7, expected_revision: 9 } });
});
