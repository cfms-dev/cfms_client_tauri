import { describe, expect, it, vi } from 'vitest';
import type { UploadEnqueueRequest, UploadTaskDto } from './api';
import { UploadStoreImpl } from './stores.svelte';

const mocks = vi.hoisted(() => ({ enqueueUploadBatch: vi.fn() }));
vi.mock('./api', () => ({ enqueueUploadBatch: mocks.enqueueUploadBatch }));

function task(id: string, revision = 1, status: UploadTaskDto['status'] = 'pending'): UploadTaskDto {
  return { upload_id: id, task_id: null, file_name: id, source_path: id, kind: 'file', target_parent_id: null,
    status, progress: 0, current_bytes: 0, total_bytes: 10, message: null, error: null,
    created_at: 1, updated_at: 1, completed_at: null, retry_count: 0, max_retries: 3, source_available: true, revision };
}

describe('backend-owned upload state', () => {
  it('submits all 67 files with one IPC call and no page callback or frontend runner', async () => {
    const store = new UploadStoreImpl();
    const tasks = Array.from({ length: 67 }, (_, index) => task(`upload-${index}`));
    mocks.enqueueUploadBatch.mockResolvedValue({ tasks, failed: [] });
    const requests = tasks.map(t => ({ uploadId: t.upload_id })) as UploadEnqueueRequest[];
    const result = await store.addBatch(requests);
    expect(mocks.enqueueUploadBatch).toHaveBeenCalledExactlyOnceWith(requests);
    expect(store.allTasks).toHaveLength(67);
    expect(result.tasks).toHaveLength(67);
  });

  it('keeps newer events when a refresh returns an older snapshot', () => {
    const store = new UploadStoreImpl();
    store.applyTask(task('file', 3, 'completed'));
    store.setAll([task('file', 2, 'uploading')]);
    expect(store.tasks.get('file')?.status).toBe('completed');
  });

  it('does not resurrect removed records through events or snapshots', () => {
    const store = new UploadStoreImpl();
    store.applyTask(task('file'));
    store.remove('file');
    expect(store.applyTask(task('file', 4))).toBe(false);
    store.setAll([task('file', 5)]);
    expect(store.allTasks).toHaveLength(0);
    store.clear();
    store.setAll([task('file', 6)]);
    expect(store.allTasks).toHaveLength(1);
  });
});
