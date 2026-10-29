import './i18n';
import { get } from 'svelte/store';
import { _, locale, waitLocale } from 'svelte-i18n';
import { beforeEach, describe, expect, it } from 'vitest';
import type { UploadTaskDto, DownloadTaskDto } from './api';
import { transferFailureReason } from './transfer-failure-reason';

const upload: UploadTaskDto = {
  upload_id: 'u1', task_id: null, file_name: 'Report.pdf', source_path: 'C:/Report.pdf',
  kind: 'file', target_parent_id: null, status: 'interrupted', progress: 0.4,
  current_bytes: 4, total_bytes: 10, message: null, error: null, created_at: 1,
  updated_at: 2, completed_at: null, retry_count: 0, max_retries: 3, source_available: true,
};

const reason = (task: UploadTaskDto | DownloadTaskDto) => transferFailureReason(task, get(_));

describe('transfer failure reason', () => {
  beforeEach(async () => { locale.set('en'); await waitLocale(); });

  it('prefers the error and falls back to a nonempty upload message', () => {
    expect(reason({ ...upload, error: 'Permission denied', message: 'Other reason' })).toBe('Permission denied');
    expect(reason({ ...upload, error: '  ', message: 'Source removed' })).toBe('Source removed');
    expect(reason({ ...upload, status: 'failed', message: 'Source removed' })).toBe('Source removed');
  });

  it('localizes both historical and current recovery messages', async () => {
    const messages = ['Upload was interrupted when the application closed', 'Upload did not finish in the previous session'];
    for (const message of messages) {
      expect(reason({ ...upload, message })).toBe('This upload was unfinished when the previous session ended. Restart the upload.');
    }
    locale.set('zh-CN');
    await waitLocale();
    for (const message of messages) {
      expect(reason({ ...upload, message })).toBe('上次会话结束时，上传尚未完成，请重新开始上传。');
    }
  });

  it('does not substitute active progress messages for failures', () => {
    expect(reason({ ...upload, status: 'uploading', message: 'Sending chunk 2' })).toBeNull();
    expect(reason(upload)).toBe('No detailed reason was provided.');
    expect(reason({ ...upload, error: ' \n ', message: ' ' })).toBe('No detailed reason was provided.');
  });

  it('uses download errors without mistaking progress messages for a reason', () => {
    const download: DownloadTaskDto = {
      task_id: 'd1', file_id: 'f1', filename: 'Report.pdf', file_path: 'C:/Report.pdf',
      status: 'failed', progress: 0, current_bytes: 0, total_bytes: 10, message: 'Receiving', error: null,
      created_at: 1, started_at: null, completed_at: null, priority: 0, retry_count: 0,
      max_retries: 3, scheduled_time: null, stage: 0, bandwidth_limit: null, pause_position: null, supports_resume: true,
    };
    expect(reason(download)).toBe('No detailed reason was provided.');
    expect(reason({ ...download, error: 'Checksum mismatch' })).toBe('Checksum mismatch');
  });

  it('keeps the server explanation alongside its summary without metadata', () => {
    expect(reason({ ...upload, status: 'failed', error: 'Server returned 503: storage is offline\nCFMS_ERROR_DATA:{"retry_after_seconds":3}' }))
      .toBe('The server is busy. Try again in 3 seconds.\n\nServer returned 503: storage is offline');
    expect(reason({ ...upload, error: 'Server returned 403: denied\nCFMS_ERROR_DATA:{"scope":"account"}' }))
      .toBe('Server returned 403: denied');
  });
});
