import '$lib/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { locale, waitLocale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadTaskDto, UploadTaskDto } from '$lib/api';
import UploadTaskCard from './UploadTaskCard.svelte';
import DownloadTaskCard from './DownloadTaskCard.svelte';

vi.mock('$lib/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));
afterEach(cleanup);
beforeEach(async () => { locale.set('en'); await waitLocale(); });

const upload: UploadTaskDto = {
  upload_id: 'u1', task_id: null, file_name: 'Report.pdf', source_path: 'C:/Report.pdf',
  kind: 'file', target_parent_id: null, status: 'interrupted', progress: 0, current_bytes: 0,
  total_bytes: 10, message: 'Upload did not finish in the previous session', error: null,
  created_at: 1, updated_at: 2, completed_at: null, retry_count: 0, max_retries: 3, source_available: true,
};
const download: DownloadTaskDto = {
  task_id: 'd1', file_id: 'f1', filename: 'Report.pdf', file_path: 'C:/Report.pdf',
  status: 'failed', progress: 0, current_bytes: 0, total_bytes: 10, message: null, error: 'Checksum mismatch',
  created_at: 1, started_at: null, completed_at: null, priority: 0, retry_count: 0,
  max_retries: 3, scheduled_time: null, stage: 0, bandwidth_limit: null, pause_position: null, supports_resume: true,
};
const actions = {
  onPause: vi.fn(), onResume: vi.fn(), onCancel: vi.fn(), onRemove: vi.fn(),
  onRestart: vi.fn(), onReselect: vi.fn(), onRetry: vi.fn(), onOpen: vi.fn(), onDeleteFile: vi.fn(),
};

describe('transfer failure details in task cards', () => {
  it('shows an interrupted upload message in both the hint and expanded details and updates locale', async () => {
    const view = render(UploadTaskCard, { task: upload, ...actions });
    await fireEvent.click(screen.getByRole('button', { name: 'View failure details' }));
    expect(screen.getByRole('tooltip').textContent).toContain('previous session ended');
    locale.set('zh-CN');
    await waitLocale();
    expect(screen.getByRole('tooltip').textContent).toBe('上次会话结束时，上传尚未完成，请重新开始上传。');
    await fireEvent.click(screen.getByRole('button', { name: '显示详细信息' }));
    expect(screen.getAllByText('上次会话结束时，上传尚未完成，请重新开始上传。')).toHaveLength(2);
    await view.rerender({ task: { ...upload, status: 'uploading', message: null }, ...actions });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.queryByRole('button', { name: '查看失败原因' })).toBeNull();
  });

  it('shows the same full download error in the hint and expanded details', async () => {
    render(DownloadTaskCard, { task: download, ...actions });
    await fireEvent.click(screen.getByRole('button', { name: 'View failure details' }));
    expect(screen.getByRole('tooltip').textContent).toBe('Checksum mismatch');
    await fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getAllByText('Checksum mismatch')).toHaveLength(2);
  });
});
