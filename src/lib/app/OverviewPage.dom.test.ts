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
import { replaceProperty, stubInstantAnimations } from '../../test/dom-fixtures';

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
  replaceProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn() });
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
    items: [
      {
        type: 'directory',
        id: 'dir-sys',
        name: 'System Folder',
        parent_id: 'parent-folder-1',
        created_time: 1_791_389_663,
      },
      {
        type: 'document',
        id: 'doc-hello',
        title: 'Hello World',
        parent_id: 'parent-folder-1',
        size: 365_803,
        last_modified: 1_795_586_521,
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
    input.focus();
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

    // Submit in search mode: opens the in-pane ServerSearchView directly on the Home page
    const submitBtn = container.querySelector<HTMLButtonElement>('[data-home-submit]')!;
    await fireEvent.click(submitBtn);
    await vi.waitFor(() => expect(container.querySelector('[data-search-back]')).not.toBeNull());
    await vi.waitFor(() =>
      expect(container.querySelector('[data-search-count]')?.textContent).toContain('2 results'),
    );

    // Consecutive results sharing parent-folder-1 are merged under one clickable parent heading
    const groupHeaders = container.querySelectorAll('[data-search-group-header]');
    expect(groupHeaders).toHaveLength(1);
    expect(groupHeaders[0].getAttribute('data-search-group-header')).toBe('parent-folder-1');

    // Clicking back returns cleanly to the Overview view
    await fireEvent.click(container.querySelector<HTMLButtonElement>('[data-search-back]')!);
    await vi.waitFor(() => expect(container.querySelector('.home-overview')).not.toBeNull());
  });

  it('only shows the search preview dropdown while the search box is focused', async () => {
    const { container } = render(OverviewPage);
    await tick();

    const input = screen.getByRole('combobox') as HTMLInputElement;
    const root = container.querySelector('.home-overview')!;
    const panels = container.querySelector('.home-panels')!;

    // Input value without focus does not open the preview dropdown
    await fireEvent.input(input, { target: { value: '122' } });
    expect(container.querySelector('#home-search-preview-list')).toBeNull();
    expect(root.classList.contains('home-overview--preview')).toBe(false);
    expect(panels.classList.contains('home-panels--hidden')).toBe(false);

    // Focusing the search box opens the dropdown and hides home panels
    input.focus();
    await vi.waitFor(() => expect(screen.getByText('Hello World')).toBeTruthy());
    expect(container.querySelector('#home-search-preview-list')).not.toBeNull();
    expect(root.classList.contains('home-overview--preview')).toBe(true);
    expect(panels.classList.contains('home-panels--hidden')).toBe(true);

    // Moving focus to another control inside the search card keeps the dropdown open
    const submitBtn = container.querySelector<HTMLButtonElement>('[data-home-submit]')!;
    await fireEvent.focusOut(input, { relatedTarget: submitBtn });
    expect(container.querySelector('#home-search-preview-list')).not.toBeNull();

    // Leaving focus hides the dropdown, preserves query text, and restores home panels
    input.blur();
    await tick();
    expect(container.querySelector('#home-search-preview-list')).toBeNull();
    expect(input.value).toBe('122');
    expect(root.classList.contains('home-overview--preview')).toBe(false);
    expect(panels.classList.contains('home-panels--hidden')).toBe(false);

    // Refocusing restores the dropdown with the preserved query
    input.focus();
    await tick();
    expect(container.querySelector('#home-search-preview-list')).not.toBeNull();
    expect(screen.getByText('Hello World')).toBeTruthy();
  });

  it('navigates to folder or document parent when clicking a search preview item', async () => {
    render(OverviewPage);
    await tick();

    const input = screen.getByRole('combobox') as HTMLInputElement;
    input.focus();
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

      input.focus();
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

  it('does not select a preview item on hover when pressing Enter to submit search, while ArrowDown + Enter navigates', async () => {
    const { container } = render(OverviewPage);
    await tick();

    const input = screen.getByRole('combobox') as HTMLInputElement;
    const form = container.querySelector<HTMLFormElement>('.home-search-row')!;
    input.focus();
    await fireEvent.input(input, { target: { value: '122' } });
    await vi.waitFor(() => expect(screen.getByText('Hello World')).toBeTruthy());

    const docRow = screen.getByText('Hello World').closest('button')!;
    await fireEvent.mouseEnter(docRow);
    await tick();

    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(docRow.getAttribute('aria-selected')).toBe('false');
    expect(docRow.classList.contains('search-preview-row--active')).toBe(false);

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    input.dispatchEvent(enterEvent);
    await tick();
    expect(enterEvent.defaultPrevented).toBe(false);
    expect(mocks.goto).not.toHaveBeenCalled();

    await fireEvent.submit(form);
    await vi.waitFor(() => expect(container.querySelector('[data-search-back]')).not.toBeNull());
    expect(mocks.goto).not.toHaveBeenCalled();

    // Return to Overview and verify explicit keyboard selection still navigates on Enter
    await fireEvent.click(container.querySelector<HTMLButtonElement>('[data-search-back]')!);
    await vi.waitFor(() => expect(container.querySelector('.home-overview')).not.toBeNull());

    const reopenedInput = screen.getByRole('combobox') as HTMLInputElement;
    reopenedInput.focus();
    await tick();
    await vi.waitFor(() => expect(screen.getByText('System Folder')).toBeTruthy());

    await fireEvent.keyDown(reopenedInput, { key: 'ArrowDown' });
    await tick();
    expect(reopenedInput.getAttribute('aria-activedescendant')).toBe('home-search-preview-option-0');

    const navEnterEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    reopenedInput.dispatchEvent(navEnterEvent);
    expect(navEnterEvent.defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(mocks.goto).toHaveBeenCalledWith('/home/files?folder=dir-sys&name=System+Folder'),
    );
    expect(container.querySelector('[data-search-back]')).toBeNull();
  });
});
