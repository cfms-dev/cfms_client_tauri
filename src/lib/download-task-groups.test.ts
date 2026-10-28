import { describe, expect, it } from 'vitest';
import type { DownloadTaskDto } from './api';
import type { DownloadBatchSnapshot } from './download-batch-control';
import {
  buildDownloadTaskRows, buildDownloadTaskSections, canDeleteDownloadTaskGroupFiles,
  canRemoveDownloadTaskGroupRecords, downloadTaskGroupSection,
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
  rateLimited: 0,
  rateLimitWaiting: false,
};

describe('download task groups', () => {
  it('prioritizes live and preparing work, including snapshot-only batches, with stable ties', () => {
    const tasks = [
      { ...task('history', 'completed', null), created_at: 50 },
      { ...task('mixed-failed', 'failed', 'mixed'), batch_created_at: 1 },
      { ...task('mixed-running', 'downloading', 'mixed'), batch_created_at: 1 },
      { ...task('scheduled', 'scheduled', null), created_at: 3 },
      { ...task('paused', 'paused', null), created_at: 60 },
    ];
    const snapshots = [snapshot, { ...snapshot, batchId: 'paused-batch', batchCreatedAt: 100, paused: true }];
    const ids = (input: DownloadTaskDto[]) => buildDownloadTaskRows(input, new Set(), snapshots)
      .map(row => row.kind === 'group' ? row.group.id : row.task.task_id);
    expect(ids(tasks)).toEqual(['batch-live', 'scheduled', 'mixed', 'paused-batch', 'paused', 'history']);
    expect(ids([...tasks].reverse())).toEqual(ids(tasks));
  });

  it('keeps download children in arrival order when status or input order changes', () => {
    const tasks = [
      { ...task('b', 'downloading'), created_at: 2 },
      { ...task('a', 'completed'), created_at: 2 },
      { ...task('first', 'failed'), created_at: 1 },
    ];
    const children = (input: DownloadTaskDto[]) => buildDownloadTaskRows(input, new Set(['batch-1']))
      .flatMap(row => row.kind === 'group-task' ? [row.task.task_id] : []);
    expect(children(tasks)).toEqual(['first', 'a', 'b']);
    expect(children([...tasks].reverse().map(task => ({ ...task, status: 'completed' })))).toEqual(children(tasks));
  });

  it('counts remaining records after cleanup rather than a stale admission estimate', () => {
    const [section] = buildDownloadTaskSections([
      { ...task('remaining', 'completed'), batch_estimated_total: 67 },
    ], new Set());
    expect(section.rows[0]).toMatchObject({ kind: 'group', group: { total: 1, completed: 1, progress: 1 } });
  });
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

  it('keeps a 634-task expanded batch complete and ordered for virtualization', () => {
    const tasks = Array.from({ length: 634 }, (_, index) =>
      ({ ...task(`task-${index}`, 'completed'), created_at: index }),
    );

    const sections = buildDownloadTaskSections(tasks, new Set(['batch-1']));

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ section: 'history', count: 634 });
    expect(sections[0].rows).toHaveLength(635);
    expect(sections[0].rows[0]).toMatchObject({ kind: 'group', group: { total: 634 } });
    expect(sections[0].rows.slice(1).map((row) => row.kind))
      .toEqual(Array.from({ length: 634 }, () => 'group-task'));
    expect(sections[0].rows.slice(1).map((row) => row.kind === 'group-task' ? row.task.task_id : null))
      .toEqual(Array.from({ length: 634 }, (_, index) => `task-${index}`));
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
      expect(groupRow.group.progress).toBe(0.75);
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

  it('surfaces queue-time and scheduled rate limits in the aggregate batch state', () => {
    const rateLimitedTask = {
      ...task('limited', 'scheduled'),
      error: 'server rejected request (429): slow down',
      scheduled_time: 30,
    };
    const liveSnapshot = { ...snapshot, failed: 2, rateLimited: 2, rateLimitWaiting: true };
    const sections = buildDownloadTaskSections(
      [rateLimitedTask],
      new Set(),
      [{ ...liveSnapshot, batchId: 'batch-1', batchName: 'Evidence bundle' }],
    );
    const row = sections[0].rows[0];

    expect(row.kind).toBe('group');
    if (row.kind === 'group') {
      expect(row.group).toMatchObject({
        scheduled: 1,
        rateLimited: 1,
        queueRateLimited: 2,
        rateLimitWaiting: true,
        failed: 2,
      });
    }
  });

  it('allows terminal mixed-result batches to delete successful files or remove records', () => {
    const row = buildDownloadTaskSections([
      task('available', 'completed'),
      task('failed', 'failed'),
    ], new Set())[0].rows[0];

    expect(row.kind).toBe('group');
    if (row.kind === 'group') {
      expect(canDeleteDownloadTaskGroupFiles(row.group)).toBe(true);
      expect(canRemoveDownloadTaskGroupRecords(row.group)).toBe(true);
    }
  });

  it('does not expose terminal batch cleanup while work is still pending', () => {
    const row = buildDownloadTaskSections([
      task('available', 'completed'),
      task('pending', 'pending'),
    ], new Set())[0].rows[0];

    expect(row.kind).toBe('group');
    if (row.kind === 'group') {
      expect(canDeleteDownloadTaskGroupFiles(row.group)).toBe(false);
      expect(canRemoveDownloadTaskGroupRecords(row.group)).toBe(false);
    }
  });
});
