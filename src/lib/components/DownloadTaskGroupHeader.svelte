<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { canDeleteDownloadTaskGroupFiles, type DownloadTaskGroup } from '$lib/download-task-groups';
  import { flyScale } from '$lib/motion/transitions';
  import { formatByteRate } from '$lib/transfer-speed';
  import Icon from './Icon.svelte';
  import ProgressRing from './ProgressRing.svelte';

  type BatchDeleteProgress = { current: number; total: number };
  type PendingAction = 'pause' | 'resume' | 'retry' | 'cancel' | 'delete' | null;

  interface Props {
    group: DownloadTaskGroup;
    expanded: boolean;
    onToggle: (groupId: string) => void;
    onPause: (groupId: string) => Promise<void>;
    onResume: (groupId: string) => Promise<void>;
    onRetry: (groupId: string) => Promise<void>;
    onCancel: (groupId: string) => Promise<void>;
    onDeleteFiles: (groupId: string) => Promise<void>;
    deleting?: BatchDeleteProgress | null;
    pendingAction?: PendingAction;
    bytesPerSecond?: number;
    onContextMenu?: (event: MouseEvent | KeyboardEvent, group: DownloadTaskGroup) => void;
  }

  let {
    group,
    expanded,
    onToggle,
    onPause,
    onResume,
    onRetry,
    onCancel,
    onDeleteFiles,
    deleting = null,
    pendingAction = null,
    bytesPerSecond = 0,
    onContextMenu,
  }: Props = $props();

  const isDeleting = $derived(Boolean(deleting) || pendingAction === 'delete');
  const percent = $derived(group.progressKnown ? Math.round(group.progress * 100) : null);
  const deletePercent = $derived(
    deleting && deleting.total > 0
      ? Math.round(Math.min(1, deleting.current / deleting.total) * 100)
      : null,
  );
  const progressWidth = $derived(`${percent ?? 0}%`);
  const canPause = $derived(
    (group.preparing && !group.batchPaused) || group.tasks.some((task) =>
      task.status === 'pending'
        || task.status === 'scheduled'
        || (task.status === 'downloading' && task.supports_resume),
    ),
  );
  const canResume = $derived(group.batchPaused || group.paused > 0);
  const canRetry = $derived(group.failed > 0);
  const canCancel = $derived(
    group.preparing || group.tasks.some((task) =>
      ['pending', 'scheduled', 'downloading', 'decrypting', 'verifying', 'paused'].includes(task.status),
    ),
  );
  const canDeleteFiles = $derived(canDeleteDownloadTaskGroupFiles(group));
  const primaryAction = $derived(
    canRetry ? 'retry' : canResume ? 'resume' : canPause ? 'pause' : null,
  );
  const hasSecondaryActions = $derived(
    canCancel
    || canDeleteFiles
    || (canPause && primaryAction !== 'pause')
    || (canResume && primaryAction !== 'resume')
    || (canRetry && primaryAction !== 'retry'),
  );
  const isCancelled = $derived(
    !group.preparing
    && group.cancelled > 0
    && group.pending === 0
    && group.running === 0
    && group.paused === 0,
  );
  const statusText = $derived(
    deleting
      ? $t('tasks.batchDeletingProgress', {
        values: {
          current: deleting.current,
          total: deleting.total,
          percent: deletePercent ?? 0,
        },
      })
      : group.preparing
      ? [
        group.batchPaused
          ? $t('tasks.paused')
          : group.phase === 'queueing' ? $t('tasks.batchQueueing') : $t('tasks.batchPreparing'),
        group.queued > 0 ? $t('tasks.batchQueuedCount', { values: { count: group.queued } }) : null,
        group.failed > 0 ? $t('tasks.batchFailedCount', { values: { count: group.failed } }) : null,
        group.cancelled > 0 ? $t('tasks.batchCancelledCount', { values: { count: group.cancelled } }) : null,
      ].filter(Boolean).join(' · ')
      : [
        group.running > 0 ? $t('tasks.batchActiveCount', { values: { count: group.running } }) : null,
        group.paused > 0 ? $t('tasks.batchPausedCount', { values: { count: group.paused } }) : null,
        group.failed > 0 ? $t('tasks.batchFailedCount', { values: { count: group.failed } }) : null,
        group.cancelled > 0 ? $t('tasks.batchCancelledCount', { values: { count: group.cancelled } }) : null,
        group.deleted > 0 ? $t('tasks.batchDeletedCount', { values: { count: group.deleted } }) : null,
      ].filter(Boolean).join(' · '),
  );

  async function runAction(action: (groupId: string) => Promise<void>) {
    if (pendingAction) return;
    await action(group.id);
  }

  function handleContextMenu(event: MouseEvent | KeyboardEvent) {
    if (isDeleting) {
      event.preventDefault();
      return;
    }
    onContextMenu?.(event, group);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="batch-card"
  class:batch-card-deleting={isDeleting}
  role="group"
  aria-label={group.name}
  aria-busy={isDeleting}
  oncontextmenu={handleContextMenu}
  onkeydown={(event) => {
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      handleContextMenu(event);
    }
  }}
>
  <div class="batch-summary">
    <span class="batch-folder" class:batch-folder-cancelled={isCancelled}>
      {#if isDeleting}
        <ProgressRing class="batch-delete-ring" size={20} strokeWidth={2.6} label={$t('tasks.batchDeleting')} />
      {:else}
        <Icon name="folder" size="22px" />
      {/if}
    </span>
    <span class="batch-copy">
      <span class="batch-title" title={group.name}>{group.name}</span>
      <span class="batch-meta">
        {#if group.total > 0}
          {$t('tasks.batchProgress', { values: { completed: group.completed, total: group.total } })}
        {:else}
          {$t('tasks.batchTaskCount', { values: { count: group.total } })}
        {/if}
      </span>
    </span>
    <span class="batch-state" title={statusText}>
      {statusText || (group.total > 0 && group.completed === group.total
        ? $t('tasks.completed')
        : $t('tasks.batchProgressPending'))}
    </span>
    <span class="batch-progress-cell">
      <span class="batch-progress-meta">
        <span class="batch-speed">{bytesPerSecond > 0 ? formatByteRate(bytesPerSecond) : ''}</span>
        <span class="batch-percent">
          {percent === null ? $t('tasks.batchProgressPending') : `${percent}%`}
        </span>
      </span>
      <span
        class="batch-progress"
        class:batch-progress-indeterminate={!group.progressKnown}
        role="progressbar"
        aria-label={$t('tasks.progressFor', { values: { name: group.name } })}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={percent ?? undefined}
      ><span style={`width: ${progressWidth}`}></span></span>
    </span>
    <span class="batch-row-actions">
      {#if primaryAction === 'retry'}
        <button class="batch-primary-action batch-action-primary" type="button" disabled={Boolean(pendingAction) || isDeleting} title={$t('tasks.retryAction')} onclick={() => runAction(onRetry)}><Icon name="restartAlt" size="16px" /><span>{$t('tasks.retryAction')}</span></button>
      {:else if primaryAction === 'resume'}
        <button class="batch-primary-action batch-action-primary" type="button" disabled={Boolean(pendingAction) || isDeleting} title={$t('tasks.resume')} onclick={() => runAction(onResume)}><Icon name="resume" size="16px" /><span>{$t('tasks.resume')}</span></button>
      {:else if primaryAction === 'pause'}
        <button class="batch-primary-action batch-action-warning" type="button" disabled={Boolean(pendingAction) || isDeleting} title={$t('tasks.pause')} onclick={() => runAction(onPause)}><Icon name="pause" size="16px" /><span>{$t('tasks.pause')}</span></button>
      {/if}
      <button
        type="button"
        class="batch-expand"
        aria-expanded={expanded}
        aria-label={expanded ? $t('tasks.collapseBatch') : $t('tasks.expandBatch')}
        title={expanded ? $t('tasks.collapseBatch') : $t('tasks.expandBatch')}
        disabled={isDeleting}
        onclick={() => onToggle(group.id)}
      >
        <span class:batch-chevron-expanded={expanded} class="batch-chevron"><Icon name="expandMore" size="18px" /></span>
      </button>
    </span>
  </div>

  {#if expanded && hasSecondaryActions}
    <div class="batch-secondary-actions" transition:flyScale={{ y: -4, duration: 160 }}>
      {#if canPause && primaryAction !== 'pause'}
        <button type="button" class="batch-action batch-action-warning" disabled={Boolean(pendingAction) || isDeleting} onclick={() => runAction(onPause)}><Icon name="pause" size="14px" />{$t('tasks.pause')}</button>
      {/if}
      {#if canResume && primaryAction !== 'resume'}
        <button type="button" class="batch-action batch-action-primary" disabled={Boolean(pendingAction) || isDeleting} onclick={() => runAction(onResume)}><Icon name="resume" size="14px" />{$t('tasks.resume')}</button>
      {/if}
      {#if canRetry && primaryAction !== 'retry'}
        <button type="button" class="batch-action batch-action-primary" disabled={Boolean(pendingAction) || isDeleting} onclick={() => runAction(onRetry)}><Icon name="restartAlt" size="14px" />{$t('tasks.retryAction')}</button>
      {/if}
      {#if canCancel}
        <button type="button" class="batch-action batch-action-danger" disabled={Boolean(pendingAction) || isDeleting} onclick={() => runAction(onCancel)}><Icon name="cancel" size="14px" />{$t('tasks.cancel')}</button>
      {/if}
      {#if canDeleteFiles}
        <button type="button" class="batch-action batch-action-danger" disabled={Boolean(pendingAction) || isDeleting} onclick={() => runAction(onDeleteFiles)}>
          {#if isDeleting}<ProgressRing class="batch-delete-ring" size={14} strokeWidth={2.4} label={$t('tasks.batchDeleting')} />{:else}<Icon name="delete" size="14px" />{/if}
          {isDeleting ? $t('tasks.batchDeleting') : $t('tasks.deleteBatchFiles')}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .batch-card {
    min-width: 0;
    overflow: hidden;
    border-bottom: 1px solid var(--explorer-border);
    background: var(--explorer-surface);
    transition: background-color 180ms var(--motion-easing-standard);
  }

  .batch-card:hover {
    background: var(--explorer-surface-hover);
  }

  .batch-card-deleting {
    background: color-mix(in srgb, var(--explorer-danger) 12%, var(--explorer-surface));
  }

  .batch-summary {
    display: grid;
    width: 100%;
    min-width: 0;
    min-height: 64px;
    grid-template-columns: 28px minmax(160px, 1.5fr) minmax(112px, 0.7fr) minmax(180px, 1.2fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0.7rem;
    font-family: var(--font-md3-sans);
  }

  .batch-folder {
    display: grid;
    align-items: center;
    justify-content: center;
    color: var(--explorer-folder);
  }

  .batch-folder {
    height: 28px;
    width: 28px;
    color: var(--explorer-folder);
    transition:
      background-color 180ms var(--motion-easing-standard),
      color 180ms var(--motion-easing-standard);
  }

  .batch-folder-cancelled {
    color: var(--explorer-text-muted);
  }

  .batch-copy {
    display: grid;
    min-width: 0;
    gap: 0.2rem;
  }

  .batch-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--explorer-text);
    font-size: 0.875rem;
    font-weight: 650;
  }

  .batch-meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--explorer-text-muted);
    font-size: 0.75rem;
  }

  .batch-state {
    min-width: 0;
    overflow: hidden;
    color: var(--explorer-text-muted);
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .batch-progress-cell {
    display: grid;
    min-width: 0;
    gap: 0.35rem;
  }

  .batch-percent {
    color: var(--explorer-accent);
    font-size: 0.8rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .batch-progress {
    display: block;
    height: 0.25rem;
    overflow: hidden;
    border-radius: 9999px;
    background: var(--explorer-surface-raised);
  }

  .batch-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--explorer-accent);
    transition: width 260ms var(--motion-easing-emphasized-decelerate);
  }

  .batch-progress-indeterminate span {
    width: 42% !important;
    animation: batch-progress-sweep 1.3s var(--motion-easing-emphasized-decelerate) infinite;
  }

  .batch-row-actions,
  .batch-secondary-actions {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.3rem;
  }

  .batch-progress-meta {
    display: flex;
    min-width: 0;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .batch-speed {
    overflow: hidden;
    color: var(--explorer-text-muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .batch-secondary-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
    border-top: 1px solid color-mix(in srgb, var(--explorer-border) 65%, transparent);
    padding: 0.4rem 0.7rem 0.45rem 3rem;
  }

  .batch-primary-action,
  .batch-action {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 30px;
    border-radius: 5px;
    padding: 0.25rem 0.55rem;
    font-size: 0.75rem;
    font-weight: 600;
    transition:
      filter 160ms var(--motion-easing-standard),
      opacity 160ms var(--motion-easing-standard),
      transform 120ms var(--motion-easing-standard);
  }

  .batch-primary-action {
    min-height: 34px;
  }

  .batch-expand {
    display: grid;
    width: 36px;
    height: 36px;
    place-items: center;
    border-radius: 999px;
    color: var(--explorer-text-muted);
    transition: color 120ms var(--motion-easing-standard), background-color 120ms var(--motion-easing-standard), transform 120ms var(--motion-easing-standard);
  }

  .batch-chevron { display: inline-flex; transition: transform 180ms var(--motion-easing-emphasized-decelerate); }
  .batch-chevron-expanded { transform: rotate(180deg); }

  .batch-expand:hover:not(:disabled) {
    background: var(--explorer-surface-selected);
    color: var(--explorer-text);
  }

  .batch-primary-action:hover:not(:disabled),
  .batch-action:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .batch-primary-action:active:not(:disabled),
  .batch-action:active:not(:disabled),
  .batch-expand:active:not(:disabled) { transform: scale(0.94); }

  .batch-primary-action:disabled,
  .batch-action:disabled,
  .batch-expand:disabled {
    opacity: 0.5;
  }

  :global(.batch-delete-ring) {
    color: currentColor;
  }

  .batch-action-warning {
    color: var(--explorer-warning);
  }

  .batch-action-primary {
    color: var(--explorer-accent);
  }

  .batch-action-danger {
    color: var(--explorer-danger);
  }

  @keyframes batch-progress-sweep {
    from {
      transform: translateX(-110%);
    }
    to {
      transform: translateX(250%);
    }
  }

  @media (max-width: 760px) {
    .batch-summary {
      grid-template-columns: 28px minmax(0, 1fr) auto;
      gap: 0.55rem;
      padding: 0.65rem;
    }

    .batch-state { grid-column: 2; }
    .batch-progress-cell { grid-column: 2 / -1; }
    .batch-row-actions { grid-column: 3; grid-row: 1 / span 2; }
    .batch-primary-action span { display: none; }
  }

  @media (pointer: coarse) {
    .batch-primary-action, .batch-action { min-height: 44px; }
    .batch-expand { width: 44px; height: 44px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .batch-progress-indeterminate span { animation: none; }
    .batch-card,
    .batch-folder,
    .batch-progress span,
    .batch-primary-action,
    .batch-action,
    .batch-expand,
    .batch-chevron { transition: none; }
    .batch-primary-action:active:not(:disabled),
    .batch-action:active:not(:disabled),
    .batch-expand:active:not(:disabled) { transform: none; }
  }

</style>
