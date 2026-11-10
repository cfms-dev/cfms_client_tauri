import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListDirectoryResponse, ServerDocumentEntry } from '$lib/api';
import { isImageDocumentName } from '$lib/features/files/image-documents';
import ServerDocumentPicker from '$lib/features/files/ServerDocumentPicker.svelte';
import '$lib/shared/i18n';

const { listDirectory } = vi.hoisted(() => ({ listDirectory: vi.fn() }));
vi.mock('$lib/api', () => ({ listDirectory }));
vi.mock('$lib/shared/platform/platform', () => ({ isMobilePlatform: () => false }));
vi.mock('$lib/shared/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));

const folder = { id: 'pictures', name: 'Pictures', created_time: null };
const image: ServerDocumentEntry = { id: 'image', title: 'avatar.png', size: 100, last_modified: null };
const document: ServerDocumentEntry = { ...image, id: 'text', title: 'notes.txt' };
const listing = (overrides: Partial<ListDirectoryResponse> = {}): ListDirectoryResponse => ({
  folders: [], documents: [], parent_id: null, ...overrides,
});
const animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');

beforeEach(() => {
  locale.set('en');
  listDirectory.mockReset();
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({
    media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  vi.stubGlobal('ResizeObserver', class {
    observe() {} unobserve() {} disconnect() {}
  });
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: () => {
    const animation = {
      cancel: vi.fn(), finished: Promise.resolve(), onfinish: null,
    } as unknown as Animation;
    queueMicrotask(() => animation.onfinish?.(new Event('finish') as AnimationPlaybackEvent));
    return animation;
  } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (animateDescriptor) Object.defineProperty(Element.prototype, 'animate', animateDescriptor);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

function renderPicker() {
  const onSelect = vi.fn();
  render(ServerDocumentPicker, {
    title: 'Choose image',
    documentFilter: (entry) => isImageDocumentName(entry.title),
    onSelect,
    onCancel: vi.fn(),
  });
  return { onSelect };
}

describe('ServerDocumentPicker filtered and empty directories', () => {
  it('shows an empty root without a list viewport or parent action', async () => {
    listDirectory.mockResolvedValue(listing());
    renderPicker();
    expect(await screen.findByText('This directory is empty.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Up one level' })).toBeNull();
    expect(listDirectory).toHaveBeenCalledWith(null);
  });

  it('treats a directory containing only non-image documents as empty', async () => {
    listDirectory.mockResolvedValue(listing({ documents: [document] }));
    renderPicker();
    expect(await screen.findByText('This directory is empty.')).toBeTruthy();
    expect(screen.queryByText('notes.txt')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('keeps folders navigable even when all documents are filtered out', async () => {
    listDirectory.mockResolvedValue(listing({ folders: [folder], documents: [document] }));
    renderPicker();
    expect(await screen.findByRole('button', { name: 'Pictures' })).toBeTruthy();
    expect(screen.queryByText('This directory is empty.')).toBeNull();
    expect(screen.queryByText('notes.txt')).toBeNull();
  });

  it('retains the parent action and empty state through maximize and restore', async () => {
    listDirectory.mockResolvedValueOnce(listing({ folders: [folder] }))
      .mockResolvedValueOnce(listing({ parent_id: 'parent', documents: [document] }))
      .mockResolvedValueOnce(listing({ folders: [folder] }));
    renderPicker();
    await fireEvent.click(await screen.findByRole('button', { name: 'Pictures' }));
    const empty = await screen.findByText('This directory is empty.');
    const parent = screen.getByRole('button', { name: 'Up one level' });
    expect(screen.queryByRole('list')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Maximize dialog' }));
    expect(screen.getByRole('dialog').classList.contains('modal-panel--maximized')).toBe(true);
    expect(empty.isConnected && parent.isConnected).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Restore dialog' }));
    expect(screen.getByRole('dialog').classList.contains('modal-panel--maximized')).toBe(false);
    await fireEvent.click(parent);
    expect(await screen.findByRole('button', { name: 'Pictures' })).toBeTruthy();
    expect(listDirectory).toHaveBeenLastCalledWith('parent');
  });

  it('selects only an image accepted by the avatar filter', async () => {
    listDirectory.mockResolvedValue(listing({ documents: [document, image] }));
    const { onSelect } = renderPicker();
    await fireEvent.click(await screen.findByRole('button', { name: 'avatar.png' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(image);
    expect(screen.queryByText('notes.txt')).toBeNull();
  });

  it('offers a retry when a directory cannot be loaded', async () => {
    listDirectory.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(listing());
    renderPicker();
    await screen.findByText('Unavailable');
    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh' });
    await fireEvent.click(refreshButtons[refreshButtons.length - 1]);
    await waitFor(() => expect(listDirectory).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('This directory is empty.')).toBeTruthy();
  });
});
