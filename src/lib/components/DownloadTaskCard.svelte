<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type { DownloadTaskDto, DownloadTaskStatus } from '$lib/api';
  import {
    downloadCapabilities, downloadPhaseMessageKey, downloadStatusMessageKey,
  } from '$lib/transfer-task-view';
  import { formatPathFilename } from '$lib/path-format';
  import { shortIdentifier } from '$lib/identifiers';
  import { formatLocalDateTimeWithUtcOffset } from '$lib/date-time';
  import { flyScale } from '$lib/motion/transitions';
  import type { IconName } from '$lib/icons';
  import DownloadProgress from './DownloadProgress.svelte';
  import Icon from './Icon.svelte';
  import TaskActionButton from './TaskActionButton.svelte';

  type PendingAction = 'pause' | 'resume' | 'retry' | 'cancel' | 'open' | 'remove' | 'delete' | null;
  interface Props {
    task: DownloadTaskDto;
    onPause: (id: string) => Promise<void>;
    onResume: (id: string) => Promise<void>;
    onRetry: (id: string) => Promise<void>;
    onCancel: (id: string) => Promise<void>;
    onOpen: (id: string) => Promise<void>;
    onRemove: (id: string) => Promise<void>;
    onDeleteFile: (id: string) => Promise<void>;
    pendingAction?: PendingAction;
    bytesPerSecond?: number;
  }

  let { task, onPause, onResume, onRetry, onCancel, onOpen, onRemove, onDeleteFile, pendingAction = null, bytesPerSecond = 0 }: Props = $props();
  let expanded = $state(false);
  const capabilities = $derived(downloadCapabilities(task));
  const displayName = $derived(formatPathFilename(task.filename));
  const phaseMessageKey = $derived(downloadPhaseMessageKey(task));

  function statusIcon(status: DownloadTaskStatus): IconName {
    return ({ pending: 'schedule', downloading: 'download', paused: 'pauseCircle', decrypting: 'lockOpen',
      verifying: 'verified', completed: 'checkCircle', deleted: 'delete', failed: 'errorFilled',
      cancelled: 'cancel', scheduled: 'accessTime' } satisfies Record<DownloadTaskStatus, IconName>)[status];
  }

  function statusColor(status: DownloadTaskStatus) {
    if (status === 'failed') return 'text-md3-error';
    if (status === 'completed') return 'text-md3-success';
    if (status === 'paused' || status === 'scheduled') return 'text-md3-warning';
    if (['downloading', 'decrypting', 'verifying'].includes(status)) return 'text-md3-primary-emphasis';
    return 'text-md3-on-surface-variant';
  }

  async function run(action: PendingAction, handler: (id: string) => Promise<void>) {
    if (pendingAction) return;
    await handler(task.task_id);
  }
</script>

<article class="task-row" class:task-row-expanded={expanded} aria-label={displayName}>
  <div class="task-row-main">
    <span class="status-icon {statusColor(task.status)}" aria-hidden="true">
      <Icon name={statusIcon(task.status)} size="20px" />
    </span>

    <div class="task-identity">
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate text-sm font-semibold text-md3-on-surface" title={displayName}>{displayName}</span>
        {#if task.priority > 0}<span class="priority-tag">P{task.priority}</span>{/if}
      </div>
      <span class="truncate text-xs text-md3-on-surface-variant" title={task.file_path}>{task.file_path}</span>
    </div>

    <div class="task-state" aria-live="polite" aria-atomic="true">
      <span class="text-xs font-semibold {statusColor(task.status)}">{$t(downloadStatusMessageKey(task.status))}</span>
      {#if phaseMessageKey}<span class="truncate text-[11px] text-md3-on-surface-variant">{$t(phaseMessageKey)}</span>{/if}
    </div>

    <div class="task-progress">
      <DownloadProgress
        progress={task.progress} currentBytes={task.current_bytes} totalBytes={task.total_bytes}
        status={task.status} {bytesPerSecond} ariaLabel={$t('tasks.progressFor', { values: { name: displayName } })}
      />
    </div>

    <div class="task-actions">
      {#if capabilities.pause}
        <TaskActionButton icon="pause" label={$t('tasks.pause')} tone="warning" onclick={() => run('pause', onPause)} disabled={Boolean(pendingAction)} />
      {:else if capabilities.resume}
        <TaskActionButton icon="resume" label={$t('tasks.resume')} tone="primary" onclick={() => run('resume', onResume)} disabled={Boolean(pendingAction)} />
      {:else if capabilities.retry}
        <TaskActionButton icon="restartAlt" label={$t('tasks.retryAction')} tone="primary" onclick={() => run('retry', onRetry)} disabled={Boolean(pendingAction)} />
      {:else if capabilities.open}
        <TaskActionButton icon="openInNew" label={$t('common.open')} tone="primary" onclick={() => run('open', onOpen)} disabled={Boolean(pendingAction)} />
      {:else if capabilities.cancel}
        <TaskActionButton icon="cancel" label={$t('tasks.cancel')} tone="danger" onclick={() => run('cancel', onCancel)} disabled={Boolean(pendingAction)} />
      {/if}
      <button class="row-disclosure" onclick={() => (expanded = !expanded)} aria-expanded={expanded} title={expanded ? $t('common.showLess') : $t('common.showMore')} aria-label={expanded ? $t('common.showLess') : $t('common.showMore')}>
        <span class:row-chevron-expanded={expanded} class="row-chevron"><Icon name="expandMore" size="18px" /></span>
      </button>
    </div>
  </div>

  {#if expanded}
    <div class="task-details" transition:flyScale={{ y: -4, duration: 180 }}>
      <dl class="details-grid">
        <div><dt>{$t('tasks.taskId')}</dt><dd class="font-mono" title={task.task_id}>{shortIdentifier(task.task_id, 20)}</dd></div>
        <div><dt>{$t('tasks.createdAt')}</dt><dd>{formatLocalDateTimeWithUtcOffset(task.created_at * 1000)}</dd></div>
        <div><dt>{$t('tasks.retryCount')}</dt><dd>{task.retry_count} / {task.max_retries}</dd></div>
        <div><dt>{$t('tasks.resumeSupport')}</dt><dd>{task.supports_resume ? $t('common.yes') : $t('common.no')}</dd></div>
      </dl>
      {#if task.error}<p class="detail-error"><Icon name="errorFilled" size="16px" /> {task.error}</p>{/if}
      <div class="detail-actions">
        {#if capabilities.cancel}<TaskActionButton presentation="labelled" icon="cancel" label={$t('tasks.cancel')} tone="danger" onclick={() => run('cancel', onCancel)} disabled={Boolean(pendingAction)} />{/if}
        {#if capabilities.deleteFile}<TaskActionButton presentation="labelled" icon="deleteForever" label={$t('tasks.deleteLocalFile')} tone="danger" onclick={() => run('delete', onDeleteFile)} disabled={Boolean(pendingAction)} />{/if}
        {#if capabilities.removeRecord}<TaskActionButton presentation="labelled" icon="playlistRemove" label={$t('tasks.removeRecord')} onclick={() => run('remove', onRemove)} disabled={Boolean(pendingAction)} />{/if}
      </div>
    </div>
  {/if}
</article>

<style>
  .task-row { border-bottom: 1px solid var(--explorer-border); background: transparent; transition: background-color 120ms var(--motion-easing-standard); }
  .task-row:hover { background: var(--explorer-surface-hover); }
  .task-row-main { display: grid; grid-template-columns: 28px minmax(160px, 1.5fr) minmax(112px, .7fr) minmax(180px, 1.2fr) auto; align-items: center; gap: .75rem; min-height: 64px; padding: .55rem .7rem; }
  .status-icon { display: grid; place-items: center; }
  .task-identity,.task-state { display: flex; min-width: 0; flex-direction: column; gap: .15rem; }
  .task-actions { display: flex; align-items: center; gap: .2rem; }
  .row-disclosure { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 999px; color: var(--explorer-text-muted); transition: color 120ms var(--motion-easing-standard), background-color 120ms var(--motion-easing-standard), transform 120ms var(--motion-easing-standard); }
  .row-disclosure:hover { background: var(--explorer-surface-selected); color: var(--explorer-text); }
  .row-disclosure:focus-visible { outline: 2px solid var(--explorer-accent); outline-offset: -2px; }
  .row-disclosure:active { transform: scale(0.92); }
  .row-chevron { display: inline-flex; transition: transform 180ms var(--motion-easing-emphasized-decelerate); }
  .row-chevron-expanded { transform: rotate(180deg); }
  .priority-tag { border-radius: 999px; background: var(--explorer-surface-selected); padding: .08rem .35rem; font-size: .625rem; color: var(--explorer-text-muted); }
  .task-details { border-top: 1px solid color-mix(in srgb, var(--explorer-border) 65%, transparent); padding: .7rem 1rem .9rem 2.9rem; background: transparent; }
  .details-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .65rem 1rem; }
  dt { font-size: .6875rem; color: var(--explorer-text-muted); } dd { margin-top: .15rem; overflow: hidden; text-overflow: ellipsis; font-size: .75rem; color: var(--explorer-text); }
  .detail-error { display: flex; align-items: flex-start; gap: .35rem; margin-top: .65rem; font-size: .75rem; color: var(--explorer-danger); }
  .detail-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .4rem; margin-top: .7rem; }
  @media (max-width: 760px) { .task-row-main { grid-template-columns: 28px minmax(0, 1fr) auto; gap: .55rem; padding: .65rem; } .task-state { grid-column: 2; } .task-progress { grid-column: 2 / -1; } .task-actions { grid-column: 3; grid-row: 1 / span 2; } .details-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .task-details { padding-left: 2.75rem; } }
  @media (pointer: coarse) { .row-disclosure { width: 44px; height: 44px; } }
  @media (prefers-reduced-motion: reduce) { .task-row, .row-disclosure, .row-chevron { transition: none; } .row-disclosure:active { transform: none; } }
</style>
