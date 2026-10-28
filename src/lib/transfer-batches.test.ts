import { describe, expect, it } from 'vitest';
import type { UploadTaskDto } from './api';
import { buildUploadTaskRows, canControlTransfer, matchesCleanup, summarizeTransfers } from './transfer-batches';

function task(index: number, status: UploadTaskDto['status'] = 'pending'): UploadTaskDto {
  return {
    upload_id: `upload-${index}`, task_id: null, file_name: `${index}.txt`, source_path: `D:/${index}.txt`,
    kind: 'file', target_parent_id: 'folder', status, progress: 0, current_bytes: 0, total_bytes: 10,
    message: null, error: null, created_at: 1, updated_at: 1, completed_at: null,
    retry_count: 0, max_retries: 3, source_available: true,
    batch_id: 'batch', batch_name: 'Documents', batch_created_at: 1, batch_index: index,
  };
}

describe('transfer batches', () => {
  it('places active batches first, then sorts by time and stable ID without splitting them', () => {
    const tasks = [
      { ...task(0, 'completed'), batch_id: 'history', batch_created_at: 20 },
      { ...task(1, 'completed'), batch_id: 'mixed', batch_created_at: 1 },
      { ...task(2, 'uploading'), batch_id: 'mixed', batch_created_at: 1 },
      { ...task(3, 'paused'), batch_id: null, created_at: 30 },
      { ...task(4, 'uploading'), batch_id: null, created_at: 1 },
    ];
    const ids = (input: UploadTaskDto[]) => buildUploadTaskRows(input, new Set(['mixed']))
      .map(row => row.kind === 'group' ? row.group.id : row.task.upload_id);
    expect(ids(tasks)).toEqual(['mixed', 'upload-1', 'upload-2', 'upload-4', 'upload-3', 'history']);
    expect(ids([...tasks].reverse())).toEqual(ids(tasks));
  });

  it('keeps child order stable across status changes, missing indices, and filtering', () => {
    const tasks = [task(2), task(0, 'completed'), task(1, 'uploading'),
      { ...task(4, 'failed'), batch_index: undefined, created_at: 2 },
      { ...task(3, 'failed'), batch_index: undefined, created_at: 2 }];
    const children = (input: UploadTaskDto[], query = '') => buildUploadTaskRows(input, new Set(['batch']), query)
      .flatMap(row => row.kind === 'task' ? [row.task.upload_id] : []);
    expect(children(tasks)).toEqual(['upload-0', 'upload-1', 'upload-2', 'upload-3', 'upload-4']);
    expect(children(tasks.map(task => ({ ...task, status: 'completed' })))).toEqual(children(tasks));
    expect(children(tasks, 'Documents')).toEqual(children(tasks));
    expect(children(tasks, '3.txt')).toEqual(['upload-3']);
  });

  it('keeps 67 uploads in one batch and reveals every child in selection order', () => {
    const tasks = Array.from({ length: 67 }, (_, index) => task(index));
    expect(buildUploadTaskRows(tasks, new Set())).toHaveLength(1);
    const rows = buildUploadTaskRows([...tasks].reverse(), new Set(['batch']));
    expect(rows).toHaveLength(68);
    expect(rows.slice(1).map(row => row.kind === 'task' && row.task.upload_id)).toEqual(tasks.map(t => t.upload_id));
  });

  it('filters batch members without losing the full batch summary', () => {
    const tasks = [task(0, 'completed'), task(1, 'failed'), task(2)];
    const rows = buildUploadTaskRows(tasks, new Set(['batch']), '', 'attention');
    expect(rows).toHaveLength(2);
    expect(rows[0].kind === 'group' && rows[0].group.tasks).toHaveLength(3);
    expect(rows[0].kind === 'group' && rows[0].group.matching.map(t => t.upload_id)).toEqual(['upload-1']);
    expect(buildUploadTaskRows(tasks, new Set(), 'Documents')).toHaveLength(4);
  });

  it('uses bytes only when the sizes of all members are known', () => {
    const large = { ...task(0), total_bytes: 90, current_bytes: 45 };
    const small = { ...task(1, 'completed'), current_bytes: 10 };
    expect(summarizeTransfers([large, small]).progress).toBe(0.55);
    expect(summarizeTransfers([large, { ...small, total_bytes: 0 }]).progress).toBe(0.5);
  });

  it('separates removing history from stopping work and includes interrupted records', () => {
    expect(matchesCleanup(task(0, 'interrupted'), 'failed')).toBe(true);
    expect(matchesCleanup(task(0, 'interrupted'), 'active')).toBe(false);
    expect(matchesCleanup(task(0, 'paused'), 'active')).toBe(true);
    expect(matchesCleanup(task(0, 'uploading'), 'finished')).toBe(false);
    expect(canControlTransfer({ ...task(0, 'failed'), source_available: false }, 'retry')).toBe(false);
  });
});
