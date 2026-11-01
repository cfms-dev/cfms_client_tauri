// @vitest-environment jsdom

import './i18n';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadTaskDto, ServiceEvent, UploadTaskDto } from './api';
import { initEventListeners, stopEventListeners } from './events';
import { downloadStore, eventLog, notificationStore, uploadStore } from './stores.svelte';

const eventCallbacks = vi.hoisted(() => new Map<string, (payload: { payload: unknown }) => void>());

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (payload: { payload: unknown }) => void) => {
    eventCallbacks.set(name, callback);
    return () => eventCallbacks.delete(name);
  }),
}));

function task(taskId: string): DownloadTaskDto {
  return {
    task_id: taskId,
    file_id: 'document-1',
    filename: 'report.pdf',
    file_path: 'C:/Downloads/report.pdf',
    status: 'pending',
    progress: 0,
    current_bytes: 0,
    total_bytes: 0,
    message: null,
    error: null,
    created_at: 1,
    started_at: null,
    completed_at: null,
    priority: 2,
    retry_count: 0,
    max_retries: 3,
    scheduled_time: null,
    stage: 0,
    bandwidth_limit: null,
    pause_position: null,
    supports_resume: true,
    server_task_recreate_count: 1,
    batch_id: 'batch-1',
  };
}

beforeEach(() => {
  locale.set('en');
});

afterEach(() => {
  stopEventListeners();
  eventCallbacks.clear();
  downloadStore.tasks.clear();
  downloadStore.activeBadgeCount = 0;
  uploadStore.clear();
  notificationStore.clear();
  vi.restoreAllMocks();
});

function uploadTask(id: string, overrides: Partial<UploadTaskDto> = {}): UploadTaskDto {
  return {
    upload_id: id, task_id: null, file_name: id, source_path: `C:/uploads/${id}`,
    kind: 'file', target_parent_id: null, status: 'pending', progress: 0,
    current_bytes: 0, total_bytes: 10, message: null, error: null,
    created_at: 1, updated_at: 1, completed_at: null, retry_count: 0,
    max_retries: 3, source_available: true, batch_id: 'upload-batch', revision: 1,
    ...overrides,
  };
}

function emitUpload(task: UploadTaskDto, status: UploadTaskDto['status']) {
  eventCallbacks.get('cfms:upload-task')!({ payload: { ...task, status, revision: 2 } });
}

describe('upload finish notifications', () => {
  it.each([
    { kind: 'file', batch_id: 'upload-batch' },
    { kind: 'directory', batch_id: 'upload-batch' },
    { kind: 'file', batch_id: null },
  ] as const)('silently completes a single $kind with batch $batch_id while keeping its state and log', async (overrides) => {
    const upload = uploadTask('one', overrides);
    uploadStore.setAll([upload]);
    const log = vi.spyOn(eventLog, 'push');
    await initEventListeners();

    emitUpload(upload, 'completed');

    expect(notificationStore.entries).toHaveLength(0);
    expect(uploadStore.tasks.get('one')?.status).toBe('completed');
    expect(log).toHaveBeenCalledWith('success', 'Upload complete: one');
  });

  it.each(['skipped', 'cancelled'] as const)('silently finishes a single %s task', async (status) => {
    const upload = uploadTask('one');
    uploadStore.setAll([upload]);
    await initEventListeners();

    emitUpload(upload, status);

    expect(notificationStore.entries).toHaveLength(0);
    expect(uploadStore.tasks.get('one')?.status).toBe(status);
  });

  it.each(['failed', 'interrupted'] as const)('keeps the error notification for a single %s task', async (status) => {
    const upload = uploadTask('one');
    uploadStore.setAll([upload]);
    await initEventListeners();

    emitUpload(upload, status);

    expect(notificationStore.entries).toHaveLength(1);
    expect(notificationStore.entries[0]).toMatchObject({ type: 'error' });
  });

  it('announces a multiple-task batch only after its last task finishes and ignores duplicate events', async () => {
    const one = uploadTask('one');
    const two = uploadTask('two', { kind: 'directory' });
    uploadStore.setAll([one, two]);
    await initEventListeners();

    emitUpload(one, 'completed');
    expect(notificationStore.entries).toHaveLength(0);
    emitUpload(two, 'completed');
    expect(notificationStore.entries).toHaveLength(1);
    expect(notificationStore.entries[0]).toMatchObject({ type: 'success' });
    emitUpload(two, 'completed');
    expect(notificationStore.entries).toHaveLength(1);
  });

  it('keeps the error notification for a multiple-task batch with failures', async () => {
    const one = uploadTask('one');
    const two = uploadTask('two');
    uploadStore.setAll([one, two]);
    await initEventListeners();

    emitUpload(one, 'failed');
    expect(notificationStore.entries).toHaveLength(0);
    emitUpload(two, 'completed');
    expect(notificationStore.entries).toHaveLength(1);
    expect(notificationStore.entries[0]).toMatchObject({ type: 'error' });
  });
});

describe('download replacement events', () => {
  it('removes the stale id and inserts the recreated task without a ghost record', async () => {
    downloadStore.tasks.set('stale-task', task('stale-task'));
    await initEventListeners();

    const replacement = task('fresh-task');
    const event: ServiceEvent = {
      event: 'DownloadTaskReplaced',
      data: { old_task_id: 'stale-task', task: replacement },
    };
    eventCallbacks.get('cfms:event')?.({ payload: event });

    expect(downloadStore.tasks.has('stale-task')).toBe(false);
    expect(downloadStore.tasks.get('fresh-task')).toEqual(replacement);
    expect(downloadStore.tasks.size).toBe(1);
    expect(downloadStore.activeBadgeCount).toBe(1);
  });
});
