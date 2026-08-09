import { describe, expect, it } from 'vitest';
import type { DownloadTaskDto } from './api';
import type { DownloadBatchSnapshot } from './download-batch-control';
import {
  buildDownloadTaskSections, canDeleteDownloadTaskGroupFiles, downloadTaskGroupSection,
} from './download-task-groups';

function task(
  taskId: string,
  status: DownloadTaskDto['status'],
  batchId: string | null = 'batch-1',
): DownloadTaskDto {
  return {
    task_id: taskId,
    file_id: `file-${taskId}`,
    filename: `${taskId}.pdf`,
    file_path: `C:/Downloads/${taskId}.pdf`,
    status,
    progress: status === 'completed' ? 1 : 0.5,
    current_bytes: status === 'completed' ? 10 : 5,
    total_bytes: 10,
    message: null,
    error: status === 'failed' ? 'network error' : null,
    created_at: 1,
    started_at: null,
    completed_at: ['completed', 'failed', 'cancelled'].includes(status) ? 2 : null,
    priority: 0,
    retry_count: 0,
    max_retries: 3,
    scheduled_time: null,
    stage: 0,
    bandwidth_limit: null,
    pause_position: null,
    supports_resume: true,
    batch_id: batchId,
    batch_name: batchId ? 'Evidence bundle' : null,
    batch_estimated_total: batchId ? 2 : null,
  };
}

const snapshot: DownloadBatchSnapshot = {
  batchId: 'batch-live',
  batchName: 'Live folder',
  batchRootId: 'root-1',
  batchCreatedAt: 5,
  phase: 'collecting',
  paused: false,
  discovered: 4,
  queued: 0,
  failed: 0,
};

describe('download task groups', () => {
  it('assigns a mixed-state batch to one highest-priority section', () => {
    const sections = buildDownloadTaskSections([
      task('failed', 'failed'),
      task('running', 'downloading'),
    ], new Set());

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ section: 'attention', count: 2 });
    expect(sections[0].rows.map((row) => row.kind)).toEqual(['group']);
  });

  it('keeps expanded children with their aggregate batch section', () => {
    const sections = buildDownloadTaskSections([
      task('complete', 'completed'),
      task('paused', 'paused'),
    ], new Set(['batch-1']));

    expect(sections).toHaveLength(1);
    expect(sections[0].section).toBe('waiting');
    expect(sections[0].rows.map((row) => row.kind))
      .toEqual(['group', 'group-task', 'group-task']);
  });

  it('places an active snapshot-only batch in progress exactly once', () => {
    const sections = buildDownloadTaskSections([], new Set(), [snapshot]);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ section: 'active', count: 4 });
    expect(sections[0].rows).toHaveLength(1);
  });

  it('filters batch visibility without recalculating its aggregate progress', () => {
    const sections = buildDownloadTaskSections([
      { ...task('match', 'completed'), filename: 'report.pdf' },
      { ...task('hidden', 'downloading'), filename: 'notes.pdf' },
    ], new Set(['batch-1']), [], 'report');

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ section: 'active', count: 2 });
    const [groupRow, childRow] = sections[0].rows;
    expect(groupRow.kind).toBe('group');
    if (groupRow.kind === 'group') {
      expect(groupRow.group.total).toBe(2);
      expect(groupRow.group.completed).toBe(1);
      expect(groupRow.group.progress).toBe(0.5);
    }
    expect(childRow).toMatchObject({ kind: 'group-task', task: { task_id: 'match' } });
    expect(sections[0].rows).toHaveLength(2);
  });

  it('searches snapshot-only batches by their displayed batch name', () => {
    expect(buildDownloadTaskSections([], new Set(), [snapshot], 'live folder')).toHaveLength(1);
    expect(buildDownloadTaskSections([], new Set(), [snapshot], 'report')).toEqual([]);
  });

  it('uses attention before active, then waiting and history', () => {
    const sections = buildDownloadTaskSections([
      task('failed', 'failed'),
      task('active', 'downloading'),
    ], new Set());
    const row = sections[0].rows[0];
    expect(row.kind).toBe('group');
    if (row.kind === 'group') expect(downloadTaskGroupSection(row.group)).toBe('attention');
  });

  it('keeps completed transfer progress after local files are deleted', () => {
    const sections = buildDownloadTaskSections([
      task('available', 'completed'),
      task('removed', 'deleted'),
    ], new Set());
    const row = sections[0].rows[0];

    expect(row.kind).toBe('group');
    if (row.kind === 'group') {
      expect(row.group).toMatchObject({ completed: 2, deleted: 1, progress: 1 });
      expect(canDeleteDownloadTaskGroupFiles(row.group)).toBe(true);
    }

    const deletedOnlyRow = buildDownloadTaskSections([
      task('removed-1', 'deleted'),
      task('removed-2', 'deleted'),
    ], new Set())[0].rows[0];
    expect(deletedOnlyRow.kind).toBe('group');
    if (deletedOnlyRow.kind === 'group') {
      expect(canDeleteDownloadTaskGroupFiles(deletedOnlyRow.group)).toBe(false);
    }
  });
});
