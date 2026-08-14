// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TasksPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  getDocumentInfo: vi.fn(),
  getDocument: vi.fn(),
  getDownloadTasks: vi.fn(),
  getUploadTasks: vi.fn(),
  setDownloads: vi.fn(),
  setUploads: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock('$lib/api', () => ({
  cancelDownload: vi.fn(),
  controlTransferTasks: vi.fn(),
  deleteDownloadedFiles: vi.fn(),
  getDocument: mocks.getDocument,
  getDocumentInfo: mocks.getDocumentInfo,
  getDownloadTasks: mocks.getDownloadTasks,
  getUploadTasks: mocks.getUploadTasks,
  openDownloadedFile: vi.fn(),
  pauseDownload: vi.fn(),
  removeTransferRecords: vi.fn(),
  resumeDownload: vi.fn(),
  retryDownload: vi.fn(),
  retryUploadTask: vi.fn(),
  uploadDirectory: vi.fn(),
  uploadDocumentFile: vi.fn(),
}));

vi.mock('$lib/stores.svelte', () => ({
  downloadStore: {
    tasks: new Map(),
    speeds: new Map(),
    setAll: mocks.setDownloads,
    remove: vi.fn(),
  },
  uploadStore: {
    allTasks: [],
    tasks: new Map(),
    setAll: mocks.setUploads,
    remove: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    registerRunner: vi.fn(),
  },
  notificationStore: {
    success: mocks.notifySuccess,
    error: vi.fn(),
  },
}));

vi.mock('$lib/download-batch-control', () => ({
  downloadBatchSnapshots: {
    subscribe(run: (value: never[]) => void) {
      run([]);
      return () => undefined;
    },
  },
  pauseActiveDownloadBatches: vi.fn(),
  resumeActiveDownloadBatches: vi.fn(),
  stopActiveDownloadBatch: vi.fn(),
}));

vi.mock('$lib/keyboard', () => ({
  registerKeyboardCommands: () => () => undefined,
}));

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string, options?: { values?: { name?: string } }) => string) => void) {
      run((key, options) => options?.values?.name ? `${key}:${options.values.name}` : key);
      return () => undefined;
    },
  },
}));

const originalAnimate = Element.prototype.animate;

beforeAll(() => {
  Element.prototype.animate = vi.fn(() => {
    const animation = {
      cancel: vi.fn(), commitStyles: vi.fn(), currentTime: 0, effect: null,
      finished: Promise.resolve(), finish: vi.fn(), id: '', oncancel: null,
      onfinish: null, onremove: null, pending: false, persist: vi.fn(),
      play: vi.fn(), playbackRate: 1, playState: 'finished', ready: Promise.resolve(),
      remove: vi.fn(), replaceState: 'active', reverse: vi.fn(), startTime: 0,
      timeline: null, updatePlaybackRate: vi.fn(),
    } as unknown as Animation;
    queueMicrotask(() => animation.onfinish?.(new Event('finish') as AnimationPlaybackEvent));
    return animation;
  });
});

afterAll(() => {
  Element.prototype.animate = originalAnimate;
});

beforeEach(() => {
  mocks.getDocumentInfo.mockResolvedValue({ title: 'Report.pdf' });
  mocks.getDocument.mockResolvedValue({
    task_id: 'task-1',
    file_id: 'document-42',
    filename: 'Report.pdf',
    file_path: 'downloads/Report.pdf',
  });
  mocks.getDownloadTasks.mockResolvedValue([]);
  mocks.getUploadTasks.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderLoadedPage() {
  render(TasksPage);
  await waitFor(() => {
    expect(mocks.getDownloadTasks).toHaveBeenCalledOnce();
    expect(mocks.getUploadTasks).toHaveBeenCalledOnce();
  });
}

async function openDialogAndSubmit(documentId = 'document-42') {
  await fireEvent.click(screen.getByRole('button', { name: 'tasks.downloadByIdAction' }));
  const dialog = screen.getByRole('dialog', { name: 'tasks.downloadByIdTitle' });
  const input = within(dialog).getByRole('textbox', { name: 'files.documentId' });
  await fireEvent.input(input, { target: { value: documentId } });
  await fireEvent.click(within(dialog).getByRole('button', { name: 'tasks.downloadByIdAction' }));
  return { dialog, input };
}

describe('direct document ID downloads', () => {
  it('resolves the title, queues the download, and reveals the new download task', async () => {
    mocks.getDocumentInfo.mockResolvedValue({ title: '  Quarterly report.pdf  ' });
    await renderLoadedPage();

    await fireEvent.click(screen.getByRole('tab', { name: /tasks.uploads/ }));
    const search = screen.getByPlaceholderText('tasks.searchPlaceholder') as HTMLInputElement;
    const filter = screen.getByRole('combobox') as HTMLSelectElement;
    await fireEvent.input(search, { target: { value: 'old filter' } });
    await fireEvent.change(filter, { target: { value: 'history' } });

    await openDialogAndSubmit();

    await waitFor(() => expect(mocks.getDocument).toHaveBeenCalledOnce());
    expect(mocks.getDocumentInfo).toHaveBeenCalledWith('document-42');
    expect(mocks.getDocument).toHaveBeenCalledWith('document-42', 'Quarterly report.pdf');
    expect(mocks.getDocumentInfo.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.getDocument.mock.invocationCallOrder[0]);
    expect(mocks.notifySuccess).toHaveBeenCalledWith(
      'tasks.downloadByIdQueued:Quarterly report.pdf',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('tab', { name: /tasks.downloads/ }).getAttribute('aria-selected')).toBe('true');
    expect(search.value).toBe('');
    expect(filter.value).toBe('all');
    expect(mocks.getDownloadTasks).toHaveBeenCalledTimes(2);
  });

  it('keeps the dialog open when metadata validation fails', async () => {
    mocks.getDocumentInfo.mockRejectedValue(new Error('Document not found'));
    await renderLoadedPage();

    const { input } = await openDialogAndSubmit('missing-document');

    expect((await screen.findByRole('alert')).textContent).toContain('Document not found');
    expect((input as HTMLInputElement).value).toBe('missing-document');
    expect(mocks.getDocument).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('rejects metadata without a usable document title', async () => {
    mocks.getDocumentInfo.mockResolvedValue({ title: '   ' });
    await renderLoadedPage();

    await openDialogAndSubmit();

    expect((await screen.findByRole('alert')).textContent).toContain('tasks.downloadByIdMissingTitle');
    expect(mocks.getDocument).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('keeps the entered ID available when queueing fails', async () => {
    mocks.getDocument.mockRejectedValue(new Error('Queue unavailable'));
    await renderLoadedPage();

    const { input } = await openDialogAndSubmit();

    expect((await screen.findByRole('alert')).textContent).toContain('Queue unavailable');
    expect((input as HTMLInputElement).value).toBe('document-42');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
