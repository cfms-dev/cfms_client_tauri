// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadStore } from '$lib/stores.svelte';
import type { DownloadTaskDto } from '$lib/api';
import TasksPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  getDocumentInfo: vi.fn(),
  getDocument: vi.fn(),
  getDownloadTasks: vi.fn(),
  getUploadTasks: vi.fn(),
  setDownloads: vi.fn(),
  setUploads: vi.fn(),
  notifySuccess: vi.fn(),
  confirmDialog: vi.fn(),
  deleteDownloadedFiles: vi.fn(),
  removeTransferRecords: vi.fn(),
  controlTransferTasks: vi.fn(),
}));

vi.mock('$lib/api', () => ({
  cancelDownload: vi.fn(),
  controlTransferTasks: mocks.controlTransferTasks,
  deleteDownloadedFiles: mocks.deleteDownloadedFiles,
  getDocument: mocks.getDocument,
  getDocumentInfo: mocks.getDocumentInfo,
  getDownloadTasks: mocks.getDownloadTasks,
  getUploadTasks: mocks.getUploadTasks,
  openDownloadedFile: vi.fn(),
  pauseDownload: vi.fn(),
  removeTransferRecords: mocks.removeTransferRecords,
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

vi.mock('$lib/dialogs.svelte', () => ({
  dialogStore: { confirm: mocks.confirmDialog },
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
  stopDownloadBatchAndWait: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/keyboard', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/keyboard')>(),
  registerKeyboardCommands: () => () => undefined,
}));

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
  menuScale: () => ({ duration: 0 }),
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
  mocks.confirmDialog.mockResolvedValue(true);
  mocks.deleteDownloadedFiles.mockResolvedValue({ succeeded: [], failed: [] });
  mocks.removeTransferRecords.mockResolvedValue({ succeeded: [], failed: [] });
  mocks.controlTransferTasks.mockResolvedValue({ succeeded: [], failed: [] });
});

describe('bulk selection and cleanup', () => {
  async function openManagement() {
    await fireEvent.click(screen.getByRole('button', { name: /tasks.more(Selected|Filtered)Actions/ }));
  }
  async function selectAll() {
    const checkbox = screen.getByRole('checkbox', { name: 'tasks.selectAllMatching' }) as HTMLElement & { checked: boolean };
    checkbox.checked = true;
    await fireEvent.change(checkbox);
  }

  it('hides unavailable menu actions and avoids a duplicate all-finished cleanup action', async () => {
    downloadStore.tasks.set('complete', batchTask('complete', 'completed'));
    await renderLoadedPage();
    const actions = screen.getByRole('toolbar', { name: 'tasks.bulkActions' });
    const pauseAndResume = within(actions).getAllByRole('button', { name: 'tasks.actionOnFiltered' });
    expect(pauseAndResume).toHaveLength(2);
    expect(pauseAndResume.every(button => button.hasAttribute('disabled'))).toBe(true);
    await openManagement();
    expect(screen.getAllByRole('menuitem').map(item => item.textContent?.trim())).toEqual(['tasks.cleanup.completed (1)']);
  });

  it('restores focus to the more button after Escape without changing batch expansion', async () => {
    downloadStore.tasks.set('complete', batchTask('complete', 'completed'));
    await renderLoadedPage();
    const trigger = screen.getByRole('button', { name: 'tasks.moreFilteredActions' });
    trigger.focus();
    await fireEvent.click(trigger);
    const item = screen.getByRole('menuitem', { name: 'tasks.cleanup.completed (1)' });
    await waitFor(() => expect(document.activeElement).toBe(item));
    await fireEvent.keyDown(item, { key: 'Escape' });
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('button', { name: /tasks.expandBatchNamed/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('selects a batch without expanding its children', async () => {
    downloadStore.tasks.set('complete', batchTask('complete', 'completed'));
    await renderLoadedPage();
    const checkbox = screen.getByRole('checkbox', { name: /tasks.selectBatch/ }) as HTMLElement & { checked: boolean };
    checkbox.checked = true;
    await fireEvent.change(checkbox);
    expect(screen.getByText('tasks.selectedScope')).toBeTruthy();
    expect(screen.getByRole('button', { name: /tasks.expandBatchNamed/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('selects and clears all 67 matches beyond the rendered virtual rows', async () => {
    const tasks = Array.from({ length: 67 }, (_, i) => ({ ...batchTask(`file-${i}`, 'completed'), batch_id: null }));
    for (const task of tasks) downloadStore.tasks.set(task.task_id, task);
    await renderLoadedPage();
    expect(screen.getAllByRole('checkbox').length).toBeLessThan(68);
    await selectAll();
    await openManagement();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'tasks.cleanup.completed (67)' }));
    await waitFor(() => expect(mocks.removeTransferRecords).toHaveBeenCalledWith('download', tasks.map(t => t.task_id)));
  });

  it('clears selection when filters change and only acts on matching failed tasks', async () => {
    downloadStore.tasks.set('complete', batchTask('complete', 'completed'));
    downloadStore.tasks.set('failed', batchTask('failed', 'failed'));
    await renderLoadedPage();
    await selectAll();
    expect(screen.getByText('tasks.selectedScope')).toBeTruthy();
    await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'attention' } });
    expect(screen.getByText('tasks.filteredScope')).toBeTruthy();
    await openManagement();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'tasks.cleanup.failed (1)' }));
    await waitFor(() => expect(mocks.removeTransferRecords).toHaveBeenCalledWith('download', ['failed']));
  });

  it('confirms stopping work and waits for acknowledgement before removing records', async () => {
    const tasks = ['pending', 'downloading', 'paused'].map((status, i) => batchTask(`file-${i}`, status as DownloadTaskDto['status']));
    for (const task of tasks) downloadStore.tasks.set(task.task_id, task);
    let acknowledge!: (result: { succeeded: string[]; failed: Array<{ id: string; error: string }> }) => void;
    mocks.controlTransferTasks.mockReturnValue(new Promise(resolve => { acknowledge = resolve; }));
    await renderLoadedPage();
    await openManagement();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'tasks.cleanup.active (3)' }));
    await waitFor(() => expect(mocks.controlTransferTasks).toHaveBeenCalledWith('download', tasks.map(t => t.task_id), 'cancel_and_remove', ['batch-1']));
    expect(mocks.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'tasks.stopAndClearTitle', danger: true }));
    expect(downloadStore.remove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('tab', { name: /tasks.uploads/ }).hasAttribute('disabled')).toBe(true));
    acknowledge({ succeeded: ['file-0', 'file-1'], failed: [{ id: 'file-2', error: 'Cancellation timeout' }] });
    await waitFor(() => expect(downloadStore.remove).toHaveBeenCalledWith('file-0'));
    expect(downloadStore.remove).not.toHaveBeenCalledWith('file-2');
    await fireEvent.click(screen.getByText('tasks.showFailureDetails'));
    expect(screen.getByText('Cancellation timeout', { exact: false })).toBeTruthy();
  });

  it('leaves the queue intact when stopping is not confirmed', async () => {
    downloadStore.tasks.set('pending', batchTask('pending', 'pending'));
    mocks.confirmDialog.mockResolvedValueOnce(false);
    await renderLoadedPage();
    await openManagement();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'tasks.cleanup.active (1)' }));
    expect(mocks.controlTransferTasks).not.toHaveBeenCalled();
    expect(downloadStore.remove).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  cleanup();
  downloadStore.tasks.clear();
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

function batchTask(taskId: string, status: DownloadTaskDto['status']): DownloadTaskDto {
  return {
    task_id: taskId,
    file_id: `file-${taskId}`,
    filename: `${taskId}.pdf`,
    file_path: `C:/Downloads/${taskId}.pdf`,
    status,
    progress: status === 'completed' ? 1 : 0,
    current_bytes: status === 'completed' ? 10 : 0,
    total_bytes: 10,
    message: null,
    error: status === 'failed' ? 'server rejected request' : null,
    created_at: 1,
    started_at: null,
    completed_at: 2,
    priority: 0,
    retry_count: 0,
    max_retries: 3,
    scheduled_time: null,
    stage: status === 'completed' ? 4 : 0,
    bandwidth_limit: null,
    pause_position: null,
    supports_resume: true,
    batch_id: 'batch-1',
    batch_name: 'Evidence bundle',
    batch_created_at: 1,
    batch_estimated_total: 2,
  };
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

describe('terminal download batch cleanup', () => {
  beforeEach(() => {
    downloadStore.tasks.set('complete', batchTask('complete', 'completed'));
    downloadStore.tasks.set('failed', batchTask('failed', 'failed'));
  });

  it('offers separate file deletion and record removal for a mixed-result batch', async () => {
    await renderLoadedPage();
    await fireEvent.click(screen.getByRole('button', { name: /tasks.expandBatchNamed/ }));

    await fireEvent.click(screen.getByRole('button', { name: /tasks.moreBatchActions/ }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'tasks.deleteBatchFiles (1)' }));
    await waitFor(() => expect(mocks.deleteDownloadedFiles).toHaveBeenCalledWith(['complete']));
    expect(mocks.confirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'tasks.deleteBatchFilesTitle',
      danger: true,
    }));

    const moreButton = screen.getByRole('button', { name: /tasks.moreBatchActions/ });
    await waitFor(() => expect(moreButton.hasAttribute('disabled')).toBe(false));
    await fireEvent.click(moreButton);
    const removeButton = screen.getByRole('menuitem', { name: 'tasks.removeBatchRecords (2)' });
    await waitFor(() => expect(removeButton.hasAttribute('disabled')).toBe(false));
    await fireEvent.click(removeButton);
    await waitFor(() => expect(mocks.removeTransferRecords).toHaveBeenCalledWith(
      'download',
      expect.arrayContaining(['complete', 'failed']),
    ));
    expect(mocks.confirmDialog).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'tasks.removeBatchRecordsTitle',
    }));
  });

  it('does nothing when destructive file deletion is not confirmed', async () => {
    mocks.confirmDialog.mockResolvedValueOnce(false);
    await renderLoadedPage();
    await fireEvent.click(screen.getByRole('button', { name: /tasks.expandBatchNamed/ }));
    await fireEvent.click(screen.getByRole('button', { name: /tasks.moreBatchActions/ }));
    await fireEvent.click(screen.getByRole('menuitem', { name: 'tasks.deleteBatchFiles (1)' }));

    expect(mocks.deleteDownloadedFiles).not.toHaveBeenCalled();
  });
});
