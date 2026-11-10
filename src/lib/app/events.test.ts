// @vitest-environment jsdom

import '$lib/shared/i18n';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import type { DownloadTaskDto, ServiceEvent, UploadTaskDto } from '$lib/api';
import { initEventListeners, stopEventListeners } from '$lib/app/events';
import { downloadStore } from "$lib/features/transfers/download-state.svelte.ts";
import { eventLog } from "$lib/features/diagnostics/event-log.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import { uploadStore } from "$lib/features/transfers/upload-state.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";

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

describe('native event subscription ownership', () => {
  it('shares initialization and releases a subscription that finishes after disposal', async () => {
    let complete!: (unlisten: () => void) => void;
    vi.mocked(listen).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const first = initEventListeners();
    expect(initEventListeners()).toBe(first);
    stopEventListeners();
    const unlisten = vi.fn();
    complete(unlisten);
    await first;
    expect(unlisten).toHaveBeenCalledOnce();
    expect(listen).toHaveBeenCalledOnce();
  });

  it('cleans up partial registration and allows a fresh initialization after failure', async () => {
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValueOnce(unlisten).mockRejectedValueOnce(new Error('native event setup failed'));
    await expect(initEventListeners()).rejects.toThrow('native event setup failed');
    expect(unlisten).toHaveBeenCalledOnce();
    await initEventListeners();
    expect(eventCallbacks.size).toBe(3);
  });
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

describe('connection security events', () => {
  afterEach(() => serverStateStore.clear());

  it('discards old connection updates and deduplicates unchanged warnings', async () => {
    serverStateStore.connectionId = 20;
    serverStateStore.connected = true;
    serverStateStore.remoteAddress = 'wss://example.test';
    await initEventListeners();
    const warning = vi.spyOn(notificationStore, 'warning');
    const status = { state: 'unknown', reasons: ['timeout'], checked_at: 1, valid_until: null } as const;
    const emit = (id: number, time: number) => eventCallbacks.get('cfms:event')!({ payload: { event: 'ConnectionSecurityChanged', data: { connection_id: id, status: { ...status, checked_at: time } } } });
    emit(19, 1);
    expect(serverStateStore.revocation).toBeNull();
    emit(20, 1); emit(20, 2);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(serverStateStore.revocation?.checked_at).toBe(2);
  });

  it('marks the current revoked connection disconnected and ignores a stale restoration', async () => {
    serverStateStore.connectionId = 20;
    serverStateStore.connected = true;
    serverStateStore.remoteAddress = 'wss://example.test';
    await initEventListeners();
    const revoked = { state: 'revoked', reasons: ['certificate_revoked'], checked_at: 1, valid_until: null };
    eventCallbacks.get('cfms:event')!({ payload: { event: 'ConnectionSecurityChanged', data: { connection_id: 20, status: revoked } } });
    expect(serverStateStore.connected).toBe(false);
    eventCallbacks.get('cfms:event')!({ payload: { event: 'ConnectionRestored', data: { connection_id: 19, status: revoked } } });
    expect(serverStateStore.connectionId).toBe(20);
    expect(serverStateStore.connected).toBe(false);
  });
});

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
