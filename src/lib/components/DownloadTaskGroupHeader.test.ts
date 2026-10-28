// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloadTaskDto } from '$lib/api';
import type { DownloadTaskGroup } from '$lib/download-task-groups';
import DownloadTaskGroupHeader from './DownloadTaskGroupHeader.svelte';

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string, options?: { values?: Record<string, unknown> }) => string) => void) {
      run((key, options) => {
        const values = options?.values
          ? `:${Object.values(options.values).join(',')}`
          : '';
        return `${key}${values}`;
      });
      return () => undefined;
    },
  },
}));

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
  menuScale: () => ({ duration: 0 }),
}));
vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }));

afterEach(() => cleanup());

const noop = async () => undefined;

function task(overrides: Partial<DownloadTaskDto> = {}): DownloadTaskDto {
  return {
    task_id: 'task-1',
    file_id: 'file-1',
    filename: 'evidence.pdf',
    file_path: '/evidence.pdf',
    status: 'downloading',
    progress: 0.5,
    current_bytes: 50,
    total_bytes: 100,
    message: null,
    error: null,
    created_at: 1,
    started_at: 1,
    completed_at: null,
    priority: 0,
    retry_count: 0,
    max_retries: 3,
    scheduled_time: null,
    stage: 0,
    bandwidth_limit: null,
    pause_position: null,
    supports_resume: true,
    ...overrides,
  };
}

function group(overrides: Partial<DownloadTaskGroup> = {}): DownloadTaskGroup {
  return {
    id: 'batch-1',
    name: 'Evidence bundle',
    rootId: 'root-1',
    createdAt: 1,
    tasks: [],
    total: 39,
    pending: 0,
    scheduled: 0,
    rateLimited: 0,
    queueRateLimited: 0,
    rateLimitWaiting: false,
    running: 0,
    paused: 0,
    completed: 20,
    deleted: 0,
    failed: 0,
    cancelled: 0,
    discovered: 39,
    queued: 20,
    currentBytes: 20,
    totalBytes: 39,
    progress: 20 / 39,
    progressKnown: true,
    preparing: false,
    batchPaused: false,
    phase: null,
    ...overrides,
  };
}

function renderHeader(
  value: DownloadTaskGroup,
  options: {
    expanded?: boolean;
    pendingAction?: 'pause' | 'resume' | 'retry' | 'cancel' | 'delete' | 'remove' | null;
    onToggle?: (groupId: string) => void;
    onPause?: (groupId: string) => Promise<void>;
    onCancel?: (groupId: string) => Promise<void>;
  } = {},
) {
  return render(DownloadTaskGroupHeader, {
    group: value,
    expanded: options.expanded ?? false,
    onToggle: options.onToggle ?? vi.fn(),
    onPause: options.onPause ?? noop,
    onResume: noop,
    onRetry: noop,
    onCancel: options.onCancel ?? noop,
    onStopAndClear: noop,
    onDeleteFiles: noop,
    onRemoveRecords: noop,
    pendingAction: options.pendingAction ?? null,
  });
}

describe('DownloadTaskGroupHeader rate-limit feedback', () => {
  it('explains queue-time throttling instead of falling back to Preparing', () => {
    renderHeader(group({
      preparing: true,
      phase: 'queueing',
      failed: 19,
      queueRateLimited: 19,
    }));

    expect(screen.getByText(/tasks\.batchQueueRateLimitedCount:19/)).toBeTruthy();
    expect(screen.queryByText('tasks.batchProgressPending')).toBeNull();
  });

  it('explains that rate-limited scheduled tasks will retry automatically', () => {
    renderHeader(group({
      pending: 19,
      scheduled: 19,
      rateLimited: 19,
    }));

    expect(screen.getByText('tasks.batchRateLimitedCount:19')).toBeTruthy();
    expect(screen.queryByText('tasks.batchProgressPending')).toBeNull();
  });

  it('keeps every material state in the rendered summary', () => {
    const { container } = renderHeader(group({
      pending: 4,
      scheduled: 2,
      rateLimited: 1,
      running: 3,
      paused: 2,
      failed: 1,
      cancelled: 1,
    }));

    const state = container.querySelector('.batch-state');
    expect(state?.textContent).toContain('tasks.batchRateLimitedCount:1');
    expect(state?.textContent).toContain('tasks.batchRetryWaitingCount:1');
    expect(state?.textContent).toContain('tasks.batchPendingCount:2');
    expect(state?.textContent).toContain('tasks.batchActiveCount:3');
    expect(state?.textContent).toContain('tasks.batchPausedCount:2');
    expect(state?.textContent).toContain('tasks.batchFailedCount:1');
    expect(state?.textContent).toContain('tasks.batchCancelledCount:1');
    expect(state?.hasAttribute('title')).toBe(false);
  });
});

describe('DownloadTaskGroupHeader actions', () => {
  it('places the matching count beside the name when the batch is filtered', () => {
    renderHeader(group({ tasks: [task()], total: 2 }));
    expect(screen.getByText('tasks.batchMatching:1,2').closest('.group-identity')).not.toBeNull();
  });

  it('keeps pause compact and places cancellation in the menu while collapsed', async () => {
    const onPause = vi.fn(noop);
    const onCancel = vi.fn(noop);
    renderHeader(group({
      tasks: [task()],
      running: 1,
    }), { onPause, onCancel });

    const pause = screen.getByRole('button', { name: 'tasks.actionOnBatch:tasks.pause,Evidence bundle,1' });
    expect(pause.textContent).not.toContain('tasks.pause');
    expect(screen.queryByRole('menuitem')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'tasks.moreBatchActions:Evidence bundle' }));
    const cancel = screen.getByRole('menuitem', { name: 'tasks.cancelTransfer (1)' });
    expect((pause as HTMLButtonElement).disabled).toBe(false);
    expect((cancel as HTMLButtonElement).disabled).toBe(false);

    await fireEvent.click(pause);
    await fireEvent.click(cancel);
    expect(onPause).toHaveBeenCalledWith('batch-1');
    expect(onCancel).toHaveBeenCalledWith('batch-1');
  });

  it('disables every action and disclosure while an action is pending', () => {
    renderHeader(group({
      tasks: [task()],
      running: 1,
    }), { pendingAction: 'pause' });

    expect((screen.getByRole('button', { name: 'tasks.actionOnBatch:tasks.pause,Evidence bundle,1' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'tasks.moreBatchActions:Evidence bundle' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'tasks.expandBatchNamed:Evidence bundle' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps disclosure semantics and toggles only the child task list', async () => {
    const onToggle = vi.fn();
    renderHeader(group(), { expanded: true, onToggle });

    const disclosure = screen.getByRole('button', { name: 'tasks.collapseBatchNamed:Evidence bundle' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(disclosure);
    expect(onToggle).toHaveBeenCalledWith('batch-1');
  });

  it('renders the batch name outside buttons and keeps action clicks independent of disclosure', async () => {
    const onToggle = vi.fn();
    const onPause = vi.fn(noop);
    renderHeader(group({ name: ':P', tasks: [task()] }), { onToggle, onPause });
    const name = screen.getByText(':P');
    expect(name.closest('button, fluent-button')).toBeNull();
    await fireEvent.click(name);
    await fireEvent.click(screen.getByRole('button', { name: 'tasks.actionOnBatch:tasks.pause,:P,1' }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(onPause).toHaveBeenCalledOnce();
  });

  it('supports pausing and resuming mixed-state batches independently', () => {
    renderHeader(group({ tasks: [task(), task({ task_id: 'paused', status: 'paused' })], paused: 1 }));
    expect(screen.getByRole('button', { name: 'tasks.actionOnBatch:tasks.pause,Evidence bundle,1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'tasks.actionOnBatch:tasks.resume,Evidence bundle,1' })).toBeTruthy();
  });
});
