<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type { UploadTaskGroup, CleanupKind } from '$lib/transfer-batches';
  import { canControlTransfer, matchesCleanup } from '$lib/transfer-batches';
  import { TRANSFER_ACTIONS, transferControlMenu, transferCleanupMenu } from '$lib/transfer-actions';
  import type { TransferControlAction } from '$lib/api';
  import { formatBytes } from '$lib/files/formatting';
  import FluentButton from './FluentButton.svelte';
  import TaskActionButton from './TaskActionButton.svelte';
  import TransferGroupHeader from './TransferGroupHeader.svelte';
  import Icon from './Icon.svelte';
  import ContextMenu from './ContextMenu.svelte';

  let { group, expanded, pending = false, onToggle, onControl, onRemove }: {
    group: UploadTaskGroup; expanded: boolean; pending?: boolean;
    onToggle: () => void; onControl: (action: TransferControlAction) => void;
    onRemove: (kind: CleanupKind) => void;
  } = $props();
  const summary = $derived(group.summary);
  const name = $derived(group.name || $t('tasks.uploads'));
  let menu = $state({ open: false, x: 0, y: 0, source: null as HTMLElement | null });
  const controlCount = (action: TransferControlAction) => group.matching.filter(task => canControlTransfer(task, action)).length;
  const cleanupCount = (kind: CleanupKind) => group.matching.filter(task => matchesCleanup(task, kind)).length;
  const menuItems = $derived([
    ...transferControlMenu({ count: controlCount, run: onControl, translate: $t, busy: pending }),
    ...transferCleanupMenu({ count: cleanupCount, run: kind => kind === 'active' ? onControl('cancel_and_remove') : onRemove(kind), translate: $t, busy: pending }),
  ]);
  const moreLabel = $derived($t('tasks.moreBatchActions', { values: { name } }));
  function openMenu(event: MouseEvent) {
    const source = event.currentTarget as HTMLElement;
    const rect = source.getBoundingClientRect();
    menu = { open: true, source, x: rect.left, y: rect.bottom };
  }
</script>

<TransferGroupHeader {name} {expanded} disabled={pending} onToggle={onToggle} progress={summary.progress}
  count={$t('tasks.batchMatching', { values: { count: group.matching.length, total: group.tasks.length } })}>
  {#snippet actions()}
    {#each (['pause', 'resume'] as const) as action}
      {@const count = controlCount(action)}
      {#if count}
        <TaskActionButton icon={TRANSFER_ACTIONS[action].icon}
          label={$t('tasks.actionOnBatch', { values: { action: $t(TRANSFER_ACTIONS[action].label), name, count } })}
          disabled={pending} onclick={() => onControl(action)} />
      {/if}
    {/each}
    <FluentButton appearance="subtle" iconOnly title={moreLabel} aria-label={moreLabel} onclick={openMenu}
      disabled={pending || !menuItems.some(item => !('type' in item) && !item.hidden)} aria-haspopup="menu" aria-expanded={menu.open}>
      <Icon name="more" size="20px" />
    </FluentButton>
  {/snippet}
  {#snippet status()}
    <span>{$t('tasks.batchCompletedCount', { values: { count: summary.completed } })}</span>
    {#if summary.running}<span>{$t('tasks.batchActiveCount', { values: { count: summary.running } })}</span>{/if}
    {#if summary.waiting}<span>{$t('tasks.batchPendingCount', { values: { count: summary.waiting } })}</span>{/if}
    {#if summary.paused}<span>{$t('tasks.batchPausedCount', { values: { count: summary.paused } })}</span>{/if}
    {#if summary.failed}<span class="batch-errors">{$t('tasks.batchFailedCount', { values: { count: summary.failed } })}</span>{/if}
  {/snippet}
  {#snippet metadata()}
    {#if summary.bytesKnown}{formatBytes(summary.currentBytes)} / {formatBytes(summary.totalBytes)}{/if}
  {/snippet}
</TransferGroupHeader>
<ContextMenu open={menu.open} x={menu.x} y={menu.y} sourceElement={menu.source} items={menuItems} onClose={() => (menu.open = false)} />

<style>
  .batch-errors { color: var(--colorStatusDangerForeground1); }
</style>
