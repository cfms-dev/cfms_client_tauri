// @vitest-environment jsdom
import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '$lib/features/authentication/auth-state.svelte.ts';
import { serverStateStore } from '$lib/features/connection/connection-state.svelte.ts';
import { notificationStore } from '$lib/shared/notifications/notifications.svelte.ts';
import OverviewPage from './OverviewPage.svelte';
import { stubInstantAnimations } from '../../test/dom-fixtures';

const mocks = vi.hoisted(() => ({
  goto: vi.fn(),
  getDirectoryInfo: vi.fn(),
  getDocument: vi.fn(),
  getDocumentInfo: vi.fn(),
  listDirectoryPage: vi.fn(),
  loadUserPreference: vi.fn(),
  mutateFilePreferences: vi.fn(),
  searchFiles: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/api', async (original) => ({
  ...(await original<typeof import('$lib/api')>()),
  getDirectoryInfo: mocks.getDirectoryInfo,
  getDocument: mocks.getDocument,
  getDocumentInfo: mocks.getDocumentInfo,
  listDirectoryPage: mocks.listDirectoryPage,
  loadUserPreference: mocks.loadUserPreference,
  mutateFilePreferences: mocks.mutateFilePreferences,
  searchFiles: mocks.searchFiles,
}));

beforeEach(() => {
  stubInstantAnimations();
  locale.set('en');
  document.documentElement.dataset.reduceMotion = 'true';
  authStore.apply({
    user_id: 'self',
    username: 'alice',
    nickname: 'Alice',
    has_token: true,
    token_exp: 1_900_000_000,
    permissions: ['search'],
    groups: [],
  });
  serverStateStore.apply({
    connection_id: 1,
    connected: true,
    server_address: 'wss://files.test',
    server_name: 'The Document Database of CFMS',
    protocol_version: 30,
    lockdown: false,
    lockdown_reason: null,
    extension_flags: [],
  });
  notificationStore.clear();
  mocks.goto.mockReset();
  mocks.getDirectoryInfo.mockReset().mockResolvedValue({ directory_id: 'dir-1', name: '111' });
  mocks.getDocument.mockReset().mockResolvedValue({
    task_id: 't-1',
    file_id: 'doc-1',
    filename: 'Hello.txt',
    file_path: 'C:/downloads/Hello.txt',
  });
  mocks.getDocumentInfo.mockReset();
  mocks.listDirectoryPage.mockReset();
  mocks.loadUserPreference.mockReset().mockResolvedValue({
    record_recent_visits: true,
    recent_visits: [
      { type: 'directory', id: 'dir-recent', name: '111', visitedAt: 1_795_665_643_000 },
    ],
    favourites: {
      directories: { 'dir-fav': '222' },
      files: {},
    },
  });
  mocks.mutateFilePreferences.mockReset().mockResolvedValue({
    recent_visits: [],
    favorites: [],
  });
  mocks.searchFiles.mockReset().mockResolvedValue({
    documents: [
      {
        id: 'doc-hello',
        title: 'Hello World',
        parent_id: 'parent-folder-1',
        size: 365_803,
        last_modified: 1_795_586_521,
      },
    ],
    directories: [
      {
        id: 'dir-sys',
        name: 'System Folder',
        created_time: 1_791_389_663,
      },
    ],
    total_count: 2,
    page_size: 24,
    next_cursor: null,
    has_more: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  authStore.clear();
  serverStateStore.clear();
  notificationStore.clear();
  delete document.documentElement.dataset.reduceMotion;
});

describe('OverviewPage redesign', () => {
  it('renders the server name with Google Sans Flex and sans-serif panel titles', async () => {
    const { container } = render(OverviewPage);
    await vi.waitFor(() => expect(screen.getByText('111')).toBeTruthy());

    const heading = screen.getByRole('heading', {
      level: 1,
      name: 'The Document Database of CFMS',
    });
    expect(heading.classList.contains('home-server-title')).toBe(true);

    const panelHeadings = container.querySelectorAll('.blueprint-panel h2');
    expect(panelHeadings).toHaveLength(2);
    for (const h2 of panelHeadings) {
      expect(h2.getAttribute('style')).toContain('var(--font-md3-sans)');
    }
  });

  it('defaults to search mode with search permission and only shows submit when input has text', async () => {
    const { container } = render(OverviewPage);
    await tick();

    const modeBtn = container.querySelector<HTMLButtonElement>('[data-home-mode-toggle]')!;
    expect(modeBtn.getAttribute('aria-label')).toContain('Search mode');
    expect(container.querySelector('[data-home-submit]')).toBeNull();

    const input = screen.getByRole('combobox');
    await fireEvent.input(input, { target: { value: '122' } });
    expect(container.querySelector('[data-home-submit]')).not.toBeNull();
  });

  it('falls back to jump mode when the user lacks search permission', async () => {
    authStore.apply({
      user_id: 'self',
      username: 'alice',
      nickname: 'Alice',
      has_token: true,
      token_exp: 1_900_000_000,
      permissions: [],
      groups: [],
    });
    const { container } = render(OverviewPage);
    await tick();

    const modeBtn = container.querySelector<HTMLButtonElement>('[data-home-mode-toggle]')!;
    expect(modeBtn.getAttribute('aria-label')).toContain('Jump mode');
  });

  it('transitions to search preview on input, preserves text when switching modes, and opens search dialog on submit', async () => {
    const { container } = render(OverviewPage);
    await tick();

    const input = screen.getByRole('combobox') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '122' } });

    await vi.waitFor(() => expect(mocks.searchFiles).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(screen.getByText('Hello World')).toBeTruthy());

    const root = container.querySelector('.home-overview')!;
    const panels = container.querySelector('.home-panels')!;
    expect(root.classList.contains('home-overview--preview')).toBe(true);
    expect(panels.classList.contains('home-panels--hidden')).toBe(true);

    // Toggle to jump mode: preserves input text and collapses preview back to Figure 1 state
    const modeBtn = container.querySelector<HTMLButtonElement>('[data-home-mode-toggle]')!;
    await fireEvent.click(modeBtn);
    expect(input.value).toBe('122');
    expect(root.classList.contains('home-overview--preview')).toBe(false);
    expect(panels.classList.contains('home-panels--hidden')).toBe(false);
    expect(container.querySelector('#home-search-preview-list')).toBeNull();

    // Toggle back to search mode: immediately restores Figure 2 search preview
    await fireEvent.click(modeBtn);
    await vi.waitFor(() => expect(root.classList.contains('home-overview--preview')).toBe(true));
    expect(container.querySelector('#home-search-preview-list')).not.toBeNull();

    // Submit in search mode: opens the ServerSearchDialog directly on the Home page
    const submitBtn = container.querySelector<HTMLButtonElement>('[data-home-submit]')!;
    await fireEvent.click(submitBtn);
    await vi.waitFor(() => expect(screen.getByRole('dialog', { name: 'Search Files' })).toBeTruthy());
  });

  it('navigates to folder or document parent when clicking a search preview item', async () => {
    render(OverviewPage);
    await tick();

    const input = screen.getByRole('combobox');
    await fireEvent.input(input, { target: { value: '122' } });
    await vi.waitFor(() => expect(screen.getByText('Hello World')).toBeTruthy());

    await fireEvent.click(screen.getByText('Hello World'));
    await vi.waitFor(() =>
      expect(mocks.goto).toHaveBeenCalledWith('/home/files?folder=parent-folder-1'),
    );
    expect(notificationStore.entries.at(-1)?.text).toContain(
      'Opened the parent folder for Hello World.',
    );

    await fireEvent.click(screen.getByText('System Folder'));
    await vi.waitFor(() =>
      expect(mocks.goto).toHaveBeenCalledWith('/home/files?folder=dir-sys&name=System+Folder'),
    );
  });

  it('executes jump mode: directory first, fallback to document on 404, and error message on double 404', async () => {
    const { container } = render(OverviewPage);
    await tick();

    // Switch to jump mode
    const modeBtn = container.querySelector<HTMLButtonElement>('[data-home-mode-toggle]')!;
    await fireEvent.click(modeBtn);

    const input = container.querySelector<HTMLInputElement>('.home-box-input')!;

    // 1. Valid directory ID
    mocks.listDirectoryPage.mockResolvedValueOnce({
      folders: [],
      documents: [],
      parent_id: null,
      next_cursor: null,
      has_more: false,
    });
    await fireEvent.input(input, { target: { value: 'dir-82eb30' } });
    await fireEvent.click(container.querySelector<HTMLButtonElement>('[data-home-submit]')!);
    await vi.waitFor(() =>
      expect(mocks.goto).toHaveBeenCalledWith('/home/files?folder=dir-82eb30'),
    );

    // 2. Directory 404 -> falls back to getDocumentInfo and navigates to parent with document selection params
    mocks.goto.mockReset();
    mocks.listDirectoryPage.mockRejectedValueOnce(new Error('Server returned 404: Not found'));
    mocks.getDocumentInfo.mockResolvedValueOnce({
      document_id: 'doc-82eb30',
      title: 'Confidential.pdf',
      parent_id: 'folder-parent-9',
    });
    await fireEvent.input(input, { target: { value: 'doc-82eb30' } });
    await fireEvent.click(container.querySelector<HTMLButtonElement>('[data-home-submit]')!);
    await vi.waitFor(() =>
      expect(mocks.goto).toHaveBeenCalledWith(
        '/home/files?folder=folder-parent-9&document=doc-82eb30&documentName=Confidential.pdf',
      ),
    );

    // 3. Both directory and document return 404 -> reports jumpObjectUnavailable error without navigating
    mocks.goto.mockReset();
    notificationStore.clear();
    mocks.listDirectoryPage.mockRejectedValueOnce(new Error('Server returned 404: Not found'));
    mocks.getDocumentInfo.mockRejectedValueOnce(new Error('Server returned 404: Not found'));
    await fireEvent.input(input, { target: { value: 'missing-id' } });
    await fireEvent.click(container.querySelector<HTMLButtonElement>('[data-home-submit]')!);
    await vi.waitFor(() => expect(notificationStore.entries).toHaveLength(1));
    expect(notificationStore.entries[0].type).toBe('error');
    expect(notificationStore.entries[0].text).toBe(
      'The object does not exist or you do not have permission to access it.',
    );
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('collapses home panels out of flow during preview and restores them when preview closes', async () => {
    vi.useFakeTimers();
    try {
      delete document.documentElement.dataset.reduceMotion;
      const { container } = render(OverviewPage);
      await tick();

      const input = screen.getByRole('combobox') as HTMLInputElement;
      const panels = container.querySelector<HTMLElement>('.home-panels')!;
      expect(panels.classList.contains('home-panels--hidden')).toBe(false);
      expect(panels.classList.contains('home-panels--collapsed')).toBe(false);

      await fireEvent.input(input, { target: { value: '111' } });
      expect(panels.classList.contains('home-panels--hidden')).toBe(true);
      expect(panels.classList.contains('home-panels--collapsed')).toBe(false);

      await vi.advanceTimersByTimeAsync(200);
      expect(panels.classList.contains('home-panels--collapsed')).toBe(true);

      await fireEvent.input(input, { target: { value: '' } });
      expect(panels.classList.contains('home-panels--hidden')).toBe(false);
      expect(panels.classList.contains('home-panels--collapsed')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
