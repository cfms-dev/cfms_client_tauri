import '$lib/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UploadTaskDto } from '$lib/api';
import { buildUploadTaskRows } from '$lib/transfer-batches';
import UploadTaskGroupHeader from './UploadTaskGroupHeader.svelte';

vi.mock('$lib/motion/transitions', () => ({ menuScale: () => ({ duration: 0 }) }));
vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }));
afterEach(cleanup);

function task(index: number, status: UploadTaskDto['status']): UploadTaskDto {
  return {
    upload_id: `u${index}`, task_id: null, file_name: `${index}.txt`, source_path: `D:/${index}.txt`,
    kind: 'file', target_parent_id: null, status, progress: 0, current_bytes: 0, total_bytes: 10,
    message: null, error: null, created_at: 1, updated_at: 1, completed_at: null,
    retry_count: 0, max_retries: 3, source_available: true,
    batch_id: 'batch', batch_name: ':P', batch_created_at: 1, batch_index: index,
  };
}

describe('UploadTaskGroupHeader', () => {
  it.each(['zh-CN', 'en'])('uses plain batch text and scoped icon controls in %s', async language => {
    locale.set(language);
    const [row] = buildUploadTaskRows([task(0, 'uploading'), task(1, 'paused'), task(2, 'completed')], new Set());
    if (row.kind !== 'group') throw new Error('Expected batch');
    const onToggle = vi.fn();
    const onControl = vi.fn();
    render(UploadTaskGroupHeader, { group: row.group, expanded: false, onToggle, onControl, onRemove: vi.fn() });
    const title = screen.getByText(':P');
    expect(title.closest('button, fluent-button')).toBeNull();
    const pause = screen.getByRole('button', { name: language === 'en' ? 'Pause batch “:P” (1)' : '暂停批次“:P”（1）' });
    expect(pause.getAttribute('title')).toBe(pause.getAttribute('aria-label'));
    expect(pause.textContent?.trim()).toBe('');
    await fireEvent.click(title);
    await fireEvent.click(pause);
    expect(onToggle).not.toHaveBeenCalled();
    expect(onControl).toHaveBeenCalledWith('pause');
    expect(screen.getByRole('button', { name: language === 'en' ? 'Resume batch “:P” (1)' : '继续批次“:P”（1）' })).toBeTruthy();
  });

  it('cleans the matching category and returns menu focus without toggling the batch', async () => {
    locale.set('en');
    const [row] = buildUploadTaskRows([task(0, 'completed'), task(1, 'failed')], new Set(), '', 'history');
    if (row.kind !== 'group') throw new Error('Expected batch');
    const onRemove = vi.fn();
    const onToggle = vi.fn();
    render(UploadTaskGroupHeader, { group: row.group, expanded: false, onToggle, onControl: vi.fn(), onRemove });
    const more = screen.getByRole('button', { name: 'More actions: batch “:P”' });
    more.focus();
    await fireEvent.click(more);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('Clear completed records (1)');
    await fireEvent.click(items[0]);
    expect(onRemove).toHaveBeenCalledWith('completed');
    expect(onToggle).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(more));
  });
});
