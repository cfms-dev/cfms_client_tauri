<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type { UploadTaskDto, UploadTaskStatus } from '$lib/api';
  import { uploadCapabilities, uploadStatusMessageKey } from '$lib/transfer-task-view';
  import { shortIdentifier } from '$lib/identifiers';
  import { formatLocalDateTimeWithUtcOffset } from '$lib/date-time';
  import { flyScale } from '$lib/motion/transitions';
  import type { IconName } from '$lib/icons';
  import DownloadProgress from './DownloadProgress.svelte';
  import Icon from './Icon.svelte';
  import TaskActionButton from './TaskActionButton.svelte';

  interface Props {
    task: UploadTaskDto;
    onPause: (id: string) => Promise<void>;
    onResume: (id: string) => Promise<void>;
    onRestart: (id: string) => Promise<void>;
    onReselect: (id: string) => Promise<void>;
    onCancel: (id: string) => Promise<void>;
    onRemove: (id: string) => Promise<void>;
    pending?: boolean;
  }
  let { task, onPause, onResume, onRestart, onReselect, onCancel, onRemove, pending = false }: Props = $props();
  let expanded = $state(false);
  const capabilities = $derived(uploadCapabilities(task));

  function icon(status: UploadTaskStatus): IconName {
    if (status === 'uploading') return 'upload';
    if (status === 'paused') return 'pauseCircle';
    if (status === 'interrupted') return 'restartAlt';
    if (status === 'completed') return 'checkCircle';
    if (status === 'failed') return 'errorFilled';
    if (status === 'cancelled' || status === 'skipped') return 'cancel';
    return 'schedule';
  }
  function color(status: UploadTaskStatus) {
    if (status === 'failed' || status === 'interrupted') return 'text-md3-error';
    if (status === 'completed') return 'text-md3-success';
    if (status === 'paused') return 'text-md3-warning';
    if (status === 'uploading') return 'text-md3-primary-emphasis';
    return 'text-md3-on-surface-variant';
  }
</script>

<article class="task-row" aria-label={task.file_name}>
  <div class="task-row-main">
    <span class="status-icon {color(task.status)}" aria-hidden="true"><Icon name={icon(task.status)} size="20px" /></span>
    <div class="task-identity">
      <span class="truncate text-sm font-semibold text-md3-on-surface" title={task.file_name}>{task.file_name}</span>
      <span class="truncate text-xs text-md3-on-surface-variant" title={task.source_path}>{task.source_path}</span>
    </div>
    <div class="task-state" aria-live="polite" aria-atomic="true">
      <span class="text-xs font-semibold {color(task.status)}">{$t(uploadStatusMessageKey(task.status))}</span>
    </div>
    <div class="task-progress">
      <DownloadProgress
        progress={task.progress} currentBytes={task.current_bytes} totalBytes={task.total_bytes}
        status={task.status === 'uploading' ? 'downloading' : task.status === 'interrupted' ? 'failed' : task.status === 'skipped' ? 'cancelled' : task.status}
        completedText={$t('tasks.uploadCompleted')} ariaLabel={$t('tasks.progressFor', { values: { name: task.file_name } })}
      />
    </div>
    <div class="task-actions">
      {#if capabilities.pause}<TaskActionButton icon="pause" label={$t('tasks.pause')} tone="warning" onclick={() => onPause(task.upload_id)} disabled={pending} />
      {:else if capabilities.resume}<TaskActionButton icon="resume" label={$t('tasks.resume')} tone="primary" onclick={() => onResume(task.upload_id)} disabled={pending} />
      {:else if capabilities.restart}<TaskActionButton icon="restartAlt" label={$t('tasks.restart')} tone="primary" onclick={() => onRestart(task.upload_id)} disabled={pending} />
      {:else if capabilities.reselect}<TaskActionButton icon="folderOpen" label={$t('tasks.reselectSource')} tone="primary" onclick={() => onReselect(task.upload_id)} disabled={pending} />
      {:else if capabilities.cancel}<TaskActionButton icon="cancel" label={$t('tasks.cancel')} tone="danger" onclick={() => onCancel(task.upload_id)} disabled={pending} />{/if}
      <button class="row-disclosure" onclick={() => (expanded = !expanded)} aria-expanded={expanded} title={expanded ? $t('common.showLess') : $t('common.showMore')} aria-label={expanded ? $t('common.showLess') : $t('common.showMore')}><span class:row-chevron-expanded={expanded} class="row-chevron"><Icon name="expandMore" size="18px" /></span></button>
    </div>
  </div>
  {#if expanded}
    <div class="task-details" transition:flyScale={{ y: -4, duration: 180 }}>
      <dl class="details-grid">
        <div><dt>{$t('tasks.taskId')}</dt><dd class="font-mono">{shortIdentifier(task.upload_id, 20)}</dd></div>
        <div><dt>{$t('tasks.createdAt')}</dt><dd>{formatLocalDateTimeWithUtcOffset(task.created_at * 1000)}</dd></div>
        <div><dt>{$t('tasks.retryCount')}</dt><dd>{task.retry_count} / {task.max_retries}</dd></div>
        <div><dt>{$t('tasks.sourceAvailable')}</dt><dd>{task.source_available ? $t('common.yes') : $t('common.no')}</dd></div>
      </dl>
      {#if task.error}<p class="detail-error"><Icon name="errorFilled" size="16px" /> {task.error}</p>{/if}
      <div class="detail-actions">
        {#if capabilities.cancel}<TaskActionButton presentation="labelled" icon="cancel" label={$t('tasks.cancel')} tone="danger" onclick={() => onCancel(task.upload_id)} disabled={pending} />{/if}
        {#if capabilities.removeRecord}<TaskActionButton presentation="labelled" icon="playlistRemove" label={$t('tasks.removeRecord')} onclick={() => onRemove(task.upload_id)} disabled={pending} />{/if}
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
  .task-details { border-top: 1px solid color-mix(in srgb, var(--explorer-border) 65%, transparent); padding: .7rem 1rem .9rem 2.9rem; background: transparent; }
  .details-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .65rem 1rem; }
  dt { font-size: .6875rem; color: var(--explorer-text-muted); } dd { margin-top: .15rem; overflow: hidden; text-overflow: ellipsis; font-size: .75rem; color: var(--explorer-text); }
  .detail-error { display: flex; gap: .35rem; margin-top: .65rem; font-size: .75rem; color: var(--explorer-danger); }
  .detail-actions { display: flex; justify-content: flex-end; gap: .4rem; margin-top: .7rem; }
  @media (max-width: 760px) { .task-row-main { grid-template-columns: 28px minmax(0, 1fr) auto; gap: .55rem; padding: .65rem; } .task-state { grid-column: 2; } .task-progress { grid-column: 2 / -1; } .task-actions { grid-column: 3; grid-row: 1 / span 2; } .details-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .task-details { padding-left: 2.75rem; } }
  @media (pointer: coarse) { .row-disclosure { width: 44px; height: 44px; } }
  @media (prefers-reduced-motion: reduce) { .task-row, .row-disclosure, .row-chevron { transition: none; } .row-disclosure:active { transform: none; } }
</style>
