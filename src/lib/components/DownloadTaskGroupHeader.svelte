<script lang="ts">
  import FluentButton from '$lib/components/FluentButton.svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    canDeleteDownloadTaskGroupFiles, canRemoveDownloadTaskGroupRecords,
    type DownloadTaskGroup,
  } from '$lib/download-task-groups';
  import { formatByteRate } from '$lib/transfer-speed';
  import Icon from './Icon.svelte';
  import TaskActionButton from './TaskActionButton.svelte';
  import TransferGroupHeader from './TransferGroupHeader.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import type { ContextMenuItem } from './context-menu';
  import { canControlTransfer } from '$lib/transfer-batches';
  import { TRANSFER_ACTIONS, transferControlMenu } from '$lib/transfer-actions';
  import type { TransferControlAction } from '$lib/api';

  type PendingAction = 'pause' | 'resume' | 'retry' | 'cancel' | 'delete' | 'remove' | null;

  interface Props {
    group: DownloadTaskGroup;
    expanded: boolean;
    onToggle: (groupId: string) => void;
    onPause: (groupId: string) => Promise<void>;
    onResume: (groupId: string) => Promise<void>;
    onRetry: (groupId: string) => Promise<void>;
    onCancel: (groupId: string) => Promise<void>;
    onDeleteFiles: (groupId: string) => Promise<void>;
    onRemoveRecords: (groupId: string) => Promise<void>;
    onStopAndClear: (groupId: string) => Promise<void>;
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
    onRemoveRecords,
    onStopAndClear,
    pendingAction = null,
    bytesPerSecond = 0,
    onContextMenu,
  }: Props = $props();

  const isDeleting = $derived(pendingAction === 'delete');
  const isRemoving = $derived(pendingAction === 'remove');
  const isBusy = $derived(Boolean(pendingAction));
  const controlCount = (action: TransferControlAction) => group.tasks.filter(task => canControlTransfer(task, action)).length
    + (group.preparing && (action === 'pause' ? !group.batchPaused : action === 'resume' ? group.batchPaused : action === 'cancel' || action === 'cancel_and_remove') ? 1 : 0);
  const canDeleteFiles = $derived(canDeleteDownloadTaskGroupFiles(group));
  const canRemoveRecords = $derived(canRemoveDownloadTaskGroupRecords(group));
  let menu = $state({ open: false, x: 0, y: 0, source: null as HTMLElement | null });
  const moreLabel = $derived($t('tasks.moreBatchActions', { values: { name: group.name } }));
  const menuItems = $derived<ContextMenuItem[]>([
    ...transferControlMenu({ count: controlCount, run: action => runAction(action === 'retry' ? onRetry : onCancel), translate: $t, busy: isBusy }),
    { type: 'divider' },
    { id: 'remove', label: $t('tasks.removeBatchRecords') + ' (' + group.tasks.length + ')', icon: 'clearTransferRecords',
      hidden: !canRemoveRecords, disabled: isBusy, onSelect: () => runAction(onRemoveRecords) },
    { type: 'divider' },
    { id: 'delete', label: $t('tasks.deleteBatchFiles') + ' (' + group.tasks.filter(task => task.status === 'completed').length + ')', icon: 'delete',
      hidden: !canDeleteFiles, disabled: isBusy, danger: true, onSelect: () => runAction(onDeleteFiles) },
    { id: 'stop', label: $t('tasks.cleanup.active') + ' (' + controlCount('cancel_and_remove') + ')', icon: 'stopAndClearTransfers',
      hidden: !controlCount('cancel_and_remove'), disabled: isBusy, danger: true, onSelect: () => runAction(onStopAndClear) },
  ]);

  function openMenu(event: MouseEvent) {
    const source = event.currentTarget as HTMLElement;
    const rect = source.getBoundingClientRect();
    menu = { open: true, source, x: rect.left, y: rect.bottom };
  }
  const isRateLimited = $derived(
    group.rateLimitWaiting || group.queueRateLimited > 0 || group.rateLimited > 0,
  );
  const unclassifiedQueueFailures = $derived(Math.max(0, group.failed - group.queueRateLimited));
  const otherScheduled = $derived(Math.max(0, group.scheduled - group.rateLimited));
  const waitingToStart = $derived(Math.max(0, group.pending - group.scheduled));
  const statusText = $derived(
    isDeleting
      ? $t('tasks.batchDeleting')
      : isRemoving
      ? $t('tasks.batchRemoving')
      : group.preparing
      ? [
        group.rateLimitWaiting
          ? $t('tasks.batchRateLimitWaiting')
          : group.queueRateLimited > 0
          ? $t('tasks.batchQueueRateLimitedCount', { values: { count: group.queueRateLimited } })
          : group.batchPaused
          ? $t('tasks.paused')
          : group.phase === 'queueing' ? $t('tasks.batchQueueing') : $t('tasks.batchPreparing'),
        group.queued > 0 ? $t('tasks.batchQueuedCount', { values: { count: group.queued } }) : null,
        unclassifiedQueueFailures > 0 ? $t('tasks.batchFailedCount', { values: { count: unclassifiedQueueFailures } }) : null,
        group.cancelled > 0 ? $t('tasks.batchCancelledCount', { values: { count: group.cancelled } }) : null,
      ].filter(Boolean).join(' · ')
      : [
        group.rateLimited > 0 ? $t('tasks.batchRateLimitedCount', { values: { count: group.rateLimited } }) : null,
        otherScheduled > 0 ? $t('tasks.batchRetryWaitingCount', { values: { count: otherScheduled } }) : null,
        waitingToStart > 0 ? $t('tasks.batchPendingCount', { values: { count: waitingToStart } }) : null,
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
    if (isBusy) {
      event.preventDefault();
      return;
    }
    onContextMenu?.(event, group);
  }

</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="batch-card" role="group" aria-label={group.name} aria-busy={isBusy}
  oncontextmenu={handleContextMenu}
  onkeydown={(event) => {
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      handleContextMenu(event);
    }
  }}>
  <TransferGroupHeader name={group.name}
    count={group.tasks.length > 0 && group.tasks.length !== group.total
      ? $t('tasks.batchMatching', { values: { count: group.tasks.length, total: group.total } })
      : $t('tasks.batchProgress', { values: { completed: group.completed, total: group.total } })}
    {expanded} disabled={isBusy} deleting={isDeleting} progress={group.progressKnown ? group.progress : null} onToggle={() => onToggle(group.id)}>
    {#snippet actions()}
      {#each (['pause', 'resume'] as const) as action}
        {@const count = controlCount(action)}
        {#if count}
          <TaskActionButton icon={TRANSFER_ACTIONS[action].icon} disabled={isBusy}
            label={$t('tasks.actionOnBatch', { values: { action: $t(TRANSFER_ACTIONS[action].label), name: group.name, count } })}
            onclick={() => runAction(action === 'pause' ? onPause : onResume)} />
        {/if}
      {/each}
      <FluentButton appearance="subtle" iconOnly title={moreLabel} aria-label={moreLabel} onclick={openMenu}
        disabled={isBusy || !menuItems.some(item => !('type' in item) && !item.hidden)} aria-haspopup="menu" aria-expanded={menu.open}>
        <Icon name="more" size="20px" />
      </FluentButton>
    {/snippet}
    {#snippet status()}
      <span class="batch-state" class:batch-state-warning={isRateLimited}>
        {#if isRateLimited}<span class="cfms-icon-text__icon" aria-hidden="true"><Icon name="warningAmber" size="15px" /></span>{/if}
        <span>{statusText || (group.total > 0 && group.completed === group.total ? $t('tasks.completed') : $t('tasks.batchProgressPending'))}</span>
      </span>
    {/snippet}
    {#snippet metadata()}{bytesPerSecond > 0 ? formatByteRate(bytesPerSecond) : ''}{/snippet}
  </TransferGroupHeader>
</div>
<ContextMenu open={menu.open} x={menu.x} y={menu.y} sourceElement={menu.source} items={menuItems} onClose={() => (menu.open = false)} />

<style>
  .batch-card { min-width: 0; }
  .batch-state { display: flex; align-items: flex-start; gap: 4px; min-width: 0; }
  .batch-state-warning { color: var(--explorer-warning); }
</style>
