import '#lib/shared/i18n.ts';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListDirectoryPageResponse, UploadTaskDto } from '#lib/api.ts';
import { authStore } from "#lib/features/authentication/auth-state.svelte.ts";
import { notificationStore } from "#lib/shared/notifications/notifications.svelte.ts";
import { serverStateStore } from "#lib/features/connection/connection-state.svelte.ts";
import { uploadStore } from "#lib/features/transfers/upload-state.svelte.ts";
import { fileManagerNavigationStore } from '#lib/features/files/file-manager-navigation.ts';
import { dialogStore } from '#lib/shared/ui/dialogs.svelte.ts';
import SnackBarHost from '#lib/shared/ui/SnackBarHost.svelte';
import FilesPage from '#lib/app/files/FileWorkspace.svelte';
import { deferred } from '../../../test/deferred';
import { replaceProperty, stubInstantAnimations } from '../../../test/dom-fixtures';
import { directoryPage } from '../../../test/directory-fixtures';

const mocks = vi.hoisted(() => ({
  listDirectoryPage: vi.fn(), listDirectory: vi.fn(), getDocumentInfo: vi.fn(), searchFiles: vi.fn(), open: vi.fn(), pickDirectory: vi.fn(),
  classifyUploadPath: vi.fn(), inspectUploadDirectoryConflicts: vi.fn(), goto: vi.fn(),
  events: new Map<string, (event: { payload: unknown }) => void>(),
  drop: null as ((event: { payload: unknown }) => void) | null,
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: { url: new URL('https://example.test/home/files') } }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    mocks.events.set(name, callback);
    return () => mocks.events.delete(name);
  }),
}));
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async (callback: typeof mocks.drop) => { mocks.drop = callback; return vi.fn(); } }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('#lib/shared/platform/directory-picker.ts', () => ({ pickDirectory: mocks.pickDirectory }));
vi.mock('#lib/shared/platform/platform.ts', () => ({ isMobilePlatform: () => false, supportsKeyboardShortcuts: () => true }));
vi.mock('#lib/api.ts', async (original) => ({
  ...await original<typeof import('#lib/api.ts')>(),
  listDirectoryPage: mocks.listDirectoryPage, listDirectory: mocks.listDirectory,
  getDocumentInfo: mocks.getDocumentInfo,
  searchFiles: mocks.searchFiles,
  loadUserPreference: async () => ({}), classifyUploadPath: mocks.classifyUploadPath,
  mutateFilePreferences: async () => ({ recent_visits: [] }),
  inspectUploadDirectoryConflicts: mocks.inspectUploadDirectoryConflicts,
}));

function page(names: string[], cursor: string | null = null): ListDirectoryPageResponse {
  return directoryPage({
    documents: names.map((id, index) => ({ id, title: `${id}.txt`, size: index + 1, last_modified: 1 })),
    next_cursor: cursor, has_more: cursor !== null,
  });
}

function deferredPage() {
  return deferred<ListDirectoryPageResponse>();
}

async function openFiles() {
  const result = render(FilesPage);
  await vi.waitFor(() => screen.getByText('alpha.txt'));
  await tick();
  return result;
}

async function uploadCompleted() {
  vi.useFakeTimers();
  mocks.events.get('cfms:upload-task')!({ payload: { status: 'completed', target_parent_id: null } });
  await vi.advanceTimersByTimeAsync(250);
  await tick();
}

beforeEach(() => {
  stubInstantAnimations();
  replaceProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn() });
  locale.set('en');
  document.documentElement.dataset.reduceMotion = 'true';
  authStore.apply({ user_id: 'self', username: 'alice', nickname: 'Alice', has_token: true, token_exp: 1_900_000_000, permissions: [], groups: [] });
  serverStateStore.updateConnection(true, 'wss://files.test', false);
  fileManagerNavigationStore.rememberTimeline('wss://files.test', 'self', { entries: [], cursor: -1 });
  notificationStore.clear();
  mocks.events.clear();
  mocks.drop = null;
  mocks.listDirectoryPage.mockReset().mockResolvedValue(page(['alpha', 'beta']));
  mocks.listDirectory.mockReset().mockResolvedValue({ folders: [], documents: [], parent_id: null });
  mocks.getDocumentInfo.mockReset();
  mocks.searchFiles.mockReset().mockResolvedValue({
    items: [
      { type: 'directory', id: 'dir-sys', name: '111', parent_id: null, created_time: 1_795_665_643 },
      { type: 'document', id: 'doc-crc', title: 'crc16.c', parent_id: null, size: 4_506, last_modified: 1_795_697_176 },
    ],
    total_count: 2,
    page_size: 24,
    next_cursor: null,
    has_more: false,
  });
  mocks.open.mockReset().mockResolvedValue(['C:/uploads/new.txt']);
  mocks.pickDirectory.mockReset().mockResolvedValue({ path: 'C:/uploads/folder', name: 'folder' });
  mocks.classifyUploadPath.mockReset().mockResolvedValue('file');
  mocks.inspectUploadDirectoryConflicts.mockReset().mockResolvedValue(undefined);
  mocks.goto.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  authStore.clear();
  serverStateStore.clear();
  notificationStore.clear();
  delete document.documentElement.dataset.reduceMotion;
});

describe('upload confirmation', () => {
  it.each(['file-drop', 'folder-drop', 'file-picker', 'folder-picker'])('silently queues one object for %s', async (source) => {
    const enqueue = vi.spyOn(uploadStore, 'addBatch').mockResolvedValue({ tasks: [{ upload_id: 'new' } as UploadTaskDto], failed: [] });
    mocks.classifyUploadPath.mockResolvedValue(source === 'folder-drop' ? 'directory' : 'file');
    const { container } = await openFiles();
    render(SnackBarHost);
    if (source.endsWith('drop')) mocks.drop!({ payload: { type: 'drop', paths: ['C:/uploads/new'] } });
    else await fireEvent.click(screen.getByRole('button', { name: source === 'file-picker' ? 'Upload files' : 'Upload folder' }));
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
    await tick();
    expect(notificationStore.entries).toHaveLength(0);
    expect(container.querySelector('.upload-queued-notice')).toBeNull();
    expect(screen.queryByRole('button', { name: 'View transfers' })).toBeNull();
  });

  it.each(['drop', 'picker'])('shows one actionable toast and no banner for multiple objects from %s', async (source) => {
    const enqueue = vi.spyOn(uploadStore, 'addBatch').mockResolvedValue({
      tasks: [{ upload_id: 'one' }, { upload_id: 'two' }] as UploadTaskDto[], failed: [],
    });
    mocks.open.mockResolvedValue(['C:/uploads/one', 'C:/uploads/two']);
    const { container } = await openFiles();
    render(SnackBarHost);
    if (source === 'drop') mocks.drop!({ payload: { type: 'drop', paths: ['C:/uploads/one', 'C:/uploads/two'] } });
    else await fireEvent.click(screen.getByRole('button', { name: 'Upload files' }));
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(notificationStore.entries).toHaveLength(1));
    expect(notificationStore.entries[0].text).toContain('Added 2 uploads');
    expect(container.querySelector('.upload-queued-notice')).toBeNull();
    await fireEvent.click(await vi.waitFor(() => screen.getByRole('button', { name: 'View transfers' })));
    expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/home/tasks?tab=uploads');
    expect(notificationStore.entries).toHaveLength(0);
  });

  it('keeps enqueue errors and does not show success when no tasks were accepted', async () => {
    vi.spyOn(uploadStore, 'addBatch').mockResolvedValue({ tasks: [], failed: [{ id: 'new', error: 'offline' }] });
    await openFiles();
    mocks.drop!({ payload: { type: 'drop', paths: ['C:/uploads/new'] } });
    await vi.waitFor(() => expect(notificationStore.entries).toHaveLength(1));
    expect(notificationStore.entries[0].type).toBe('error');
    expect(notificationStore.entries[0].text).toContain('offline');
    expect(notificationStore.entries[0].action).toBeUndefined();
  });

  it('only reports errors when a multiple-object selection accepts one task', async () => {
    vi.spyOn(uploadStore, 'addBatch').mockResolvedValue({
      tasks: [{ upload_id: 'accepted' } as UploadTaskDto], failed: [{ id: 'failed', error: 'offline' }],
    });
    await openFiles();
    mocks.drop!({ payload: { type: 'drop', paths: ['C:/uploads/one', 'C:/uploads/two'] } });
    await vi.waitFor(() => expect(notificationStore.entries).toHaveLength(1));
    expect(notificationStore.entries[0].type).toBe('error');
    expect(notificationStore.entries[0].text).toContain('offline');
  });

  it('reports the actual accepted count alongside partial enqueue failures for multiple accepted tasks', async () => {
    vi.spyOn(uploadStore, 'addBatch').mockResolvedValue({
      tasks: [{ upload_id: 'one' }, { upload_id: 'two' }] as UploadTaskDto[], failed: [{ id: 'failed', error: 'offline' }],
    });
    await openFiles();
    mocks.drop!({ payload: { type: 'drop', paths: ['C:/uploads/one', 'C:/uploads/two', 'C:/uploads/three'] } });
    await vi.waitFor(() => expect(notificationStore.entries).toHaveLength(2));
    expect(notificationStore.entries.find((entry) => entry.type === 'success')).toMatchObject({
      text: 'Added 2 uploads. Manage them in Transfers.', action: { label: 'View transfers' },
    });
    expect(notificationStore.entries.find((entry) => entry.type === 'error')?.text).toContain('offline');
  });
});

describe('background directory updates', () => {
  it('waits for explicit pagination to finish before refreshing and uses the latest chosen sort', async () => {
    const foreground = deferredPage();
    const background = deferredPage();
    mocks.listDirectoryPage.mockResolvedValueOnce(page(['alpha'], 'next')).mockReturnValueOnce(foreground.promise)
      .mockReturnValueOnce(background.promise);
    const { container } = await openFiles();
    await uploadCompleted();
    expect(mocks.listDirectoryPage).toHaveBeenCalledTimes(2);
    foreground.resolve(page(['beta']));
    await vi.waitFor(() => expect(mocks.listDirectoryPage).toHaveBeenCalledTimes(3));
    await fireEvent.click(container.querySelector('[data-sort-item]')!);
    background.resolve(page(['alpha', 'gamma', 'beta']));
    await vi.waitFor(() => screen.getByText('gamma.txt'));
    const names = [...container.querySelectorAll('[data-file-drag-handle]')].map((element) => element.textContent);
    expect(names).toEqual(['gamma.txt', 'beta.txt', 'alpha.txt']);
  });

  it('keeps rows, selection, focus and the viewport while collecting pages, then reconciles selection', async () => {
    const { container } = await openFiles();
    const alpha = screen.getByText('alpha.txt').closest<HTMLElement>('[data-file-row-index]')!;
    await fireEvent.click(alpha);
    alpha.focus();
    const viewport = container.querySelector<HTMLElement>('.file-table-scroll-viewport')!;
    viewport.scrollTop = 40;
    const first = deferredPage();
    const last = deferredPage();
    mocks.listDirectoryPage.mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    await uploadCompleted();
    expect(screen.getByText('alpha.txt')).toBeTruthy();
    expect(alpha.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(alpha);
    expect(viewport.scrollTop).toBe(40);
    expect(screen.queryByText('Loading directory…')).toBeNull();
    first.resolve(page(['alpha', 'gamma'], 'next'));
    await vi.waitFor(() => expect(mocks.listDirectoryPage).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('gamma.txt')).toBeNull();
    last.resolve(page(['delta']));
    await vi.waitFor(() => screen.getByText('gamma.txt'));
    expect(screen.queryByText('beta.txt')).toBeNull();
    expect(alpha.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(alpha);
    expect(screen.getByText('alpha.txt').closest('[data-file-row-index]')).toBe(alpha);
    mocks.listDirectoryPage.mockResolvedValueOnce(page(['gamma']));
    await uploadCompleted();
    await vi.waitFor(() => expect(screen.queryByText('alpha.txt')).toBeNull());
    expect(container.querySelector('[data-file-row-index][aria-pressed="true"]')).toBeNull();
    expect(container.querySelector('[data-file-row-index][tabindex="0"]')).toBeTruthy();
  });

  it('retains the old list on failure and offers a background retry', async () => {
    await openFiles();
    mocks.listDirectoryPage.mockRejectedValueOnce(new Error('offline'));
    await uploadCompleted();
    await vi.waitFor(() => expect(notificationStore.entries).toHaveLength(1));
    expect(screen.getByText('alpha.txt')).toBeTruthy();
    expect(notificationStore.entries[0]).toMatchObject({ type: 'warning', action: { label: 'Retry' } });
    const pending = deferredPage();
    mocks.listDirectoryPage.mockReturnValueOnce(pending.promise);
    notificationStore.entries[0].action!.onClick();
    await tick();
    expect(screen.getByText('alpha.txt')).toBeTruthy();
    pending.resolve(page(['retry']));
    await vi.waitFor(() => screen.getByText('retry.txt'));
    expect(notificationStore.entries).toHaveLength(0);
  });

  it('keeps explicit refresh loading feedback and ignores a late background response', async () => {
    await openFiles();
    const background = deferredPage();
    const explicit = deferredPage();
    mocks.listDirectoryPage.mockReturnValueOnce(background.promise).mockReturnValueOnce(explicit.promise);
    await uploadCompleted();
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.queryByText('alpha.txt')).toBeNull();
    expect(mocks.listDirectoryPage).toHaveBeenCalledTimes(3);
    explicit.resolve(page(['explicit']));
    await vi.waitFor(() => screen.getByText('explicit.txt'));
    background.resolve(page(['stale']));
    await tick();
    await tick();
    expect(screen.queryByText('stale.txt')).toBeNull();
    expect(screen.getByText('explicit.txt')).toBeTruthy();
  });

  it('discards background results after navigating to another directory', async () => {
    const initial = page(['alpha']);
    initial.folders = [{ id: 'folder', name: 'Child', created_time: null }];
    mocks.listDirectoryPage.mockResolvedValueOnce(initial);
    await openFiles();
    const background = deferredPage();
    mocks.listDirectoryPage.mockReturnValueOnce(background.promise).mockResolvedValueOnce(page(['child']));
    await uploadCompleted();
    await fireEvent.doubleClick(screen.getByText('Child'));
    await vi.waitFor(() => screen.getByText('child.txt'));
    background.resolve(page(['stale']));
    await tick();
    await tick();
    expect(screen.queryByText('stale.txt')).toBeNull();
    expect(screen.getByText('child.txt')).toBeTruthy();
  });

  it('clears the scoped retry notification on navigation and cancels active work on unmount', async () => {
    const initial = page(['alpha']);
    initial.folders = [{ id: 'folder', name: 'Child', created_time: null }];
    mocks.listDirectoryPage.mockResolvedValueOnce(initial);
    const { unmount } = await openFiles();
    mocks.listDirectoryPage.mockRejectedValueOnce(new Error('offline'));
    await uploadCompleted();
    expect(notificationStore.entries).toHaveLength(1);
    mocks.listDirectoryPage.mockResolvedValueOnce(page(['child']));
    await fireEvent.doubleClick(screen.getByText('Child'));
    await vi.waitFor(() => screen.getByText('child.txt'));
    expect(notificationStore.entries).toHaveLength(0);
    const pending = deferredPage();
    mocks.listDirectoryPage.mockReturnValueOnce(pending.promise);
    vi.useFakeTimers();
    mocks.events.get('cfms:upload-task')!({ payload: { status: 'completed', target_parent_id: 'folder' } });
    await vi.advanceTimersByTimeAsync(250);
    unmount();
    pending.reject(new Error('late error'));
    await tick();
    await tick();
    expect(notificationStore.entries).toHaveLength(0);
  });

  it('uses the access-denied state when background refresh discovers revoked permission', async () => {
    await openFiles();
    mocks.listDirectoryPage.mockRejectedValueOnce(new Error('Access denied: permission revoked'));
    await uploadCompleted();
    await vi.waitFor(() => expect(screen.queryByText('alpha.txt')).toBeNull());
    expect(screen.getByText('You do not currently have permission to view the contents of this directory.')).toBeTruthy();
    expect(notificationStore.entries).toHaveLength(0);
  });
});

describe('jump to directory or document by ID', () => {
  it('falls back to document info on directory 404, opens parent directory, and selects the document', async () => {
    await openFiles();
    vi.spyOn(dialogStore, 'prompt').mockResolvedValueOnce('doc-target');
    mocks.listDirectoryPage
      .mockRejectedValueOnce(new Error('Server returned 404: Not found'))
      .mockResolvedValueOnce(page(['other', 'doc-target']));
    mocks.getDocumentInfo.mockResolvedValueOnce({
      document_id: 'doc-target',
      title: 'doc-target.txt',
      parent_id: 'parent-dir',
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Jump to directory' }));

    await vi.waitFor(() => expect(mocks.getDocumentInfo).toHaveBeenCalledWith('doc-target'));
    await vi.waitFor(() => expect(screen.getByText('doc-target.txt')).toBeTruthy());
    const targetRow = screen.getByText('doc-target.txt').closest<HTMLElement>('[data-file-row-index]')!;
    expect(targetRow.getAttribute('aria-pressed')).toBe('true');
    expect(notificationStore.entries.at(-1)?.text).toBe('Located doc-target.txt.');
  });

  it('reports unavailable error and preserves current listing when both directory and document return 404', async () => {
    await openFiles();
    vi.spyOn(dialogStore, 'prompt').mockResolvedValueOnce('missing-object');
    mocks.listDirectoryPage.mockRejectedValueOnce(new Error('Server returned 404: Not found'));
    mocks.getDocumentInfo.mockRejectedValueOnce(new Error('Server returned 404: Not found'));

    await fireEvent.click(screen.getByRole('button', { name: 'Jump to directory' }));

    await vi.waitFor(() => expect(notificationStore.entries).toHaveLength(1));
    expect(notificationStore.entries[0].type).toBe('error');
    expect(notificationStore.entries[0].text).toBe(
      'The object does not exist or you do not have permission to access it.',
    );
    expect(screen.getByText('alpha.txt')).toBeTruthy();
    expect(screen.getByText('beta.txt')).toBeTruthy();
  });
});

describe('toolbar search preview', () => {
  beforeEach(() => {
    authStore.apply({
      user_id: 'self',
      username: 'alice',
      nickname: 'Alice',
      has_token: true,
      token_exp: 1_900_000_000,
      permissions: ['search'],
      groups: [],
    });
  });

  it('ignores Enter and form submit when search query is empty or whitespace-only', async () => {
    const { container } = await openFiles();
    const input = screen.getByRole('combobox') as HTMLInputElement;
    const form = input.closest('form')!;

    input.focus();
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.submit(form);
    expect(container.querySelector('[data-search-back]')).toBeNull();
    expect(mocks.searchFiles).not.toHaveBeenCalled();

    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.submit(form);
    expect(container.querySelector('[data-search-back]')).toBeNull();
    expect(mocks.searchFiles).not.toHaveBeenCalled();

    await fireEvent.input(input, { target: { value: '1' } });
    await vi.waitFor(() => expect(mocks.searchFiles).toHaveBeenCalledOnce());
    mocks.searchFiles.mockClear();

    await fireEvent.input(input, { target: { value: '' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.submit(form);
    expect(container.querySelector('[data-search-back]')).toBeNull();
    expect(mocks.searchFiles).not.toHaveBeenCalled();
  });

  it('stays closed on empty focus and renders a minimal Home-style preview list on non-empty input', async () => {
    const { container } = await openFiles();
    const input = screen.getByRole('combobox') as HTMLInputElement;

    // Focusing an empty search field must not pop up an empty preview box
    input.focus();
    await tick();
    expect(container.querySelector('#files-search-preview-panel')).toBeNull();
    expect(mocks.searchFiles).not.toHaveBeenCalled();

    // Entering a query shows the minimal preview panel without redundant filter, sort, or footer controls
    await fireEvent.input(input, { target: { value: '1' } });
    await vi.waitFor(() => expect(mocks.searchFiles).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(screen.getByText('crc16.c')).toBeTruthy());

    expect(mocks.searchFiles).toHaveBeenCalledWith('1', {
      pageSize: 24,
      cursor: null,
      sortBy: 'name',
      sortOrder: 'asc',
      searchDocuments: true,
      searchDirectories: true,
    });

    const panel = container.querySelector<HTMLElement>('#files-search-preview-panel')!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('#files-search-preview-list')).not.toBeNull();
    expect(panel.querySelectorAll('[role="checkbox"]')).toHaveLength(0);
    expect(panel.querySelectorAll('[data-search-sort]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Advanced search' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All results' })).toBeNull();
    expect(screen.getByText('111')).toBeTruthy();
    expect(screen.getByText('crc16.c')).toBeTruthy();
  });

  it('hides on blur, reopens on refocus, supports keyboard navigation, and opens ServerSearchView on Enter', async () => {
    const { container } = await openFiles();
    const input = screen.getByRole('combobox') as HTMLInputElement;

    input.focus();
    await fireEvent.input(input, { target: { value: '1' } });
    await vi.waitFor(() => expect(screen.getByText('crc16.c')).toBeTruthy());

    // Leaving focus hides the preview while keeping the typed query
    input.blur();
    await tick();
    expect(container.querySelector('#files-search-preview-panel')).toBeNull();
    expect(input.value).toBe('1');

    // Refocusing restores the preview immediately
    input.focus();
    await tick();
    expect(container.querySelector('#files-search-preview-panel')).not.toBeNull();

    // Escape dismisses while focused; ArrowDown reopens and highlights the first option
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(container.querySelector('#files-search-preview-panel')).toBeNull();

    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    await tick();
    expect(container.querySelector('#files-search-preview-panel')).not.toBeNull();
    expect(input.getAttribute('aria-activedescendant')).toBe('files-search-preview-option-0');

    // Submitting via Enter without an active option opens the full ServerSearchView
    await fireEvent.keyDown(input, { key: 'Escape' });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(container.querySelector('[data-search-back]')).not.toBeNull());
  });

  it('opens ServerSearchView on Enter when only hovering a preview item, while ArrowDown + Enter navigates', async () => {
    const { container } = await openFiles();
    const input = screen.getByRole('combobox') as HTMLInputElement;
    const initialDirectoryCalls = mocks.listDirectoryPage.mock.calls.length;

    input.focus();
    await fireEvent.input(input, { target: { value: '1' } });
    await vi.waitFor(() => expect(screen.getByText('crc16.c')).toBeTruthy());

    const docRow = screen.getByText('crc16.c').closest('button')!;
    await fireEvent.mouseEnter(docRow);
    await tick();

    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(docRow.getAttribute('aria-selected')).toBe('false');
    expect(docRow.classList.contains('search-preview-row--active')).toBe(false);

    await fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => expect(container.querySelector('[data-search-back]')).not.toBeNull());
    expect(mocks.listDirectoryPage).toHaveBeenCalledTimes(initialDirectoryCalls);

    // Return to Files view and verify explicit keyboard selection still navigates on Enter
    await fireEvent.click(container.querySelector<HTMLButtonElement>('[data-search-back]')!);
    await vi.waitFor(() => expect(container.querySelector('[data-search-back]')).toBeNull());
    await vi.waitFor(() => expect(screen.getByText('111')).toBeTruthy());

    const reopenedInput = screen.getByRole('combobox') as HTMLInputElement;
    reopenedInput.focus();
    await tick();

    await fireEvent.keyDown(reopenedInput, { key: 'ArrowDown' });
    await tick();
    expect(reopenedInput.getAttribute('aria-activedescendant')).toBe('files-search-preview-option-0');

    await fireEvent.keyDown(reopenedInput, { key: 'Enter' });
    await vi.waitFor(() =>
      expect(mocks.listDirectoryPage).toHaveBeenCalledWith('dir-sys', null, expect.any(Number)),
    );
    expect(container.querySelector('[data-search-back]')).toBeNull();
  });
});
