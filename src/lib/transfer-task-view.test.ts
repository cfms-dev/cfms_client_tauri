import { describe, expect, it } from 'vitest';
import type { DownloadTaskDto, UploadTaskDto } from './api';
import {
  downloadCapabilities, downloadPhaseMessageKey, downloadSection, downloadStatusMessageKey,
  matchesTransferQuery, sortSectionTasks, uploadCapabilities, uploadSection, uploadStatusMessageKey,
} from './transfer-task-view';

const download = (status: DownloadTaskDto['status']): DownloadTaskDto => ({
  task_id: 'd1', file_id: 'f1', filename: 'Report.pdf', file_path: 'C:/Files/Report.pdf',
  status, progress: 0, current_bytes: 0, total_bytes: 10, message: null, error: null,
  created_at: 1, started_at: null, completed_at: null, priority: 0, retry_count: 0,
  max_retries: 3, scheduled_time: null, stage: 0, bandwidth_limit: null,
  pause_position: null, supports_resume: true,
});

const upload = (status: UploadTaskDto['status'], available = true): UploadTaskDto => ({
  upload_id: 'u1', task_id: null, file_name: 'Report.pdf', source_path: 'C:/Files/Report.pdf',
  kind: 'file', target_parent_id: null, status, progress: 0, current_bytes: 0,
  total_bytes: 10, message: null, error: null, created_at: 1, updated_at: 1,
  completed_at: null, retry_count: 0, max_retries: 3, source_available: available,
});

describe('transfer task projection', () => {
  it('maps automatic retry to active and paused work to waiting', () => {
    expect(downloadSection(download('scheduled'))).toBe('active');
    expect(downloadSection(download('paused'))).toBe('waiting');
  });

  it('maps interrupted uploads to attention', () => {
    expect(uploadSection(upload('interrupted'))).toBe('attention');
  });

  it.each([
    ['failed', 'attention'], ['downloading', 'active'], ['decrypting', 'active'],
    ['verifying', 'active'], ['scheduled', 'active'], ['pending', 'waiting'],
    ['paused', 'waiting'], ['completed', 'history'], ['cancelled', 'history'],
    ['deleted', 'history'],
  ] as const)('maps download %s to %s', (status, section) => {
    expect(downloadSection(download(status))).toBe(section);
  });

  it.each([
    ['failed', 'attention'], ['interrupted', 'attention'], ['uploading', 'active'],
    ['pending', 'waiting'], ['paused', 'waiting'], ['completed', 'history'],
    ['cancelled', 'history'], ['skipped', 'history'],
  ] as const)('maps upload %s to %s', (status, section) => {
    expect(uploadSection(upload(status))).toBe(section);
  });

  it('distinguishes file deletion from record removal', () => {
    expect(downloadCapabilities(download('completed'))).toMatchObject({
      open: true, deleteFile: true, removeRecord: true,
    });
    expect(downloadCapabilities(download('deleted'))).toMatchObject({
      open: false, deleteFile: false, removeRecord: true,
    });
  });

  it('requires source availability before restarting an interrupted upload', () => {
    expect(uploadCapabilities(upload('interrupted', true)).restart).toBe(true);
    expect(uploadCapabilities(upload('interrupted', false))).toMatchObject({ restart: false, reselect: true });
  });

  it('searches names and paths case-insensitively', () => {
    expect(matchesTransferQuery(download('completed'), 'files/report')).toBe(true);
    expect(matchesTransferQuery(upload('completed'), 'REPORT.PDF')).toBe(true);
  });

  it('sorts live work oldest-first and history newest-first', () => {
    const older = { ...download('completed'), task_id: 'older', created_at: 1 };
    const newer = { ...download('completed'), task_id: 'newer', created_at: 9 };
    expect(sortSectionTasks([newer, older], 'active').map((task) => task.task_id))
      .toEqual(['older', 'newer']);
    expect(sortSectionTasks([older, newer], 'history').map((task) => task.task_id))
      .toEqual(['newer', 'older']);
  });

  it.each([
    [0, 'tasks.phases.receiving'],
    [1, 'tasks.phases.decrypting'],
    [2, 'tasks.phases.cleaning'],
    [3, 'tasks.phases.verifying'],
    [99, 'tasks.phases.transferring'],
  ])('localizes active download stage %s', (stage, key) => {
    expect(downloadPhaseMessageKey({ ...download('downloading'), stage })).toBe(key);
  });

  it.each(['pending', 'paused', 'completed', 'failed', 'cancelled'] as const)(
    'does not expose diagnostic phase copy for %s downloads',
    (status) => {
      expect(downloadPhaseMessageKey({ ...download(status), stage: 0 })).toBeNull();
    },
  );

  it('projects structured download and upload statuses to translation keys', () => {
    expect(downloadStatusMessageKey('scheduled')).toBe('tasks.retryWaiting');
    expect(downloadStatusMessageKey('deleted')).toBe('tasks.fileDeleted');
    expect(uploadStatusMessageKey('interrupted')).toBe('tasks.interrupted');
    expect(uploadStatusMessageKey('skipped')).toBe('tasks.skipped');
  });
});
