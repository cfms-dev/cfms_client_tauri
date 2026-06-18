<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type { DownloadTaskGroup } from '$lib/download-task-groups';
  import Icon from './Icon.svelte';

  interface Props {
    group: DownloadTaskGroup;
    expanded: boolean;
    onToggle: (groupId: string) => void;
    onPause: (groupId: string) => Promise<void>;
    onResume: (groupId: string) => Promise<void>;
    onCancel: (groupId: string) => Promise<void>;
  }

  let { group, expanded, onToggle, onPause, onResume, onCancel }: Props = $props();
  let actionPending = $state(false);

  const percent = $derived(group.progressKnown ? Math.round(group.progress * 100) : null);
  const progressWidth = $derived(`${percent ?? 0}%`);
  const canPause = $derived(
    group.tasks.some((task) =>
      ['pending', 'scheduled', 'downloading', 'decrypting', 'verifying'].includes(task.status),
    ),
  );
  const canResume = $derived(group.paused > 0);
  const canCancel = $derived(
    group.preparing || group.tasks.some((task) =>
      ['pending', 'scheduled', 'downloading', 'decrypting', 'verifying', 'paused'].includes(task.status),
    ),
  );
  const statusText = $derived(
    group.preparing
      ? [
        group.phase === 'queueing' ? $t('tasks.batchQueueing') : $t('tasks.batchPreparing'),
        group.queued > 0 ? $t('tasks.batchQueuedCount', { values: { count: group.queued } }) : null,
        group.failed > 0 ? $t('tasks.batchFailedCount', { values: { count: group.failed } }) : null,
      ].filter(Boolean).join(' · ')
      : [
        group.running > 0 ? $t('tasks.batchActiveCount', { values: { count: group.running } }) : null,
        group.paused > 0 ? $t('tasks.batchPausedCount', { values: { count: group.paused } }) : null,
        group.failed > 0 ? $t('tasks.batchFailedCount', { values: { count: group.failed } }) : null,
      ].filter(Boolean).join(' · '),
  );

  async function runAction(action: (groupId: string) => Promise<void>) {
    actionPending = true;
    try {
      await action(group.id);
    } finally {
      actionPending = false;
    }
  }
</script>

<div class="batch-card">
  <button
    type="button"
    class="batch-main"
    aria-expanded={expanded}
    title={expanded ? $t('tasks.collapseBatch') : $t('tasks.expandBatch')}
    onclick={() => onToggle(group.id)}
  >
    <span class="batch-icon">
      <Icon name={expanded ? 'expandLess' : 'expandMore'} size="22px" />
    </span>
    <span class="batch-folder">
      <Icon name="folder" size="24px" />
    </span>
    <span class="batch-copy">
      <span class="batch-title" title={group.name}>{group.name}</span>
      <span class="batch-meta">
        {#if group.total > 0}
          {$t('tasks.batchProgress', { values: { completed: group.completed, total: group.total } })}
        {:else}
          {$t('tasks.batchTaskCount', { values: { count: group.total } })}
        {/if}
        {#if statusText}
          · {statusText}
        {/if}
      </span>
    </span>
    <span class="batch-percent">{percent === null ? $t('tasks.batchProgressPending') : `${percent}%`}</span>
  </button>

  <div class="batch-progress" class:batch-progress-indeterminate={!group.progressKnown} aria-hidden="true">
    <span style={`width: ${progressWidth}`}></span>
  </div>

  <div class="batch-actions">
    {#if canPause}
      <button
        type="button"
        class="batch-action batch-action-warning"
        disabled={actionPending}
        onclick={() => runAction(onPause)}
      >
        <Icon name="pause" size="14px" />
        {$t('tasks.pause')}
      </button>
    {/if}
    {#if canResume}
      <button
        type="button"
        class="batch-action batch-action-primary"
        disabled={actionPending}
        onclick={() => runAction(onResume)}
      >
        <Icon name="resume" size="14px" />
        {$t('tasks.resume')}
      </button>
    {/if}
    {#if canCancel}
      <button
        type="button"
        class="batch-action batch-action-danger"
        disabled={actionPending}
        onclick={() => runAction(onCancel)}
      >
        <Icon name="cancel" size="14px" />
        {$t('tasks.cancel')}
      </button>
    {/if}
  </div>
</div>

<style>
  .batch-card {
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--color-md3-outline);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-md3-surface-container) 82%, transparent);
    box-shadow: 0 12px 28px color-mix(in srgb, var(--color-md3-primary) 6%, transparent);
    backdrop-filter: blur(10px);
    transition:
      border-color 180ms var(--motion-easing-standard),
      box-shadow 220ms var(--motion-easing-standard),
      transform 180ms var(--motion-easing-standard);
  }

  .batch-card:hover {
    border-color: color-mix(in srgb, var(--color-md3-primary) 38%, var(--color-md3-outline));
    box-shadow: 0 16px 34px color-mix(in srgb, var(--color-md3-primary) 10%, transparent);
  }

  .batch-main {
    display: grid;
    width: 100%;
    min-width: 0;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.9rem 1rem 0.65rem;
    text-align: left;
    font-family: var(--font-md3-sans);
  }

  .batch-icon,
  .batch-folder {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-md3-primary-emphasis);
  }

  .batch-folder {
    height: 2.25rem;
    width: 2.25rem;
    border-radius: 9999px;
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
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
    color: var(--color-md3-on-surface);
    font-size: 0.95rem;
    font-weight: 700;
  }

  .batch-meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
  }

  .batch-percent {
    color: var(--color-md3-primary-emphasis);
    font-size: 0.8rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .batch-progress {
    height: 0.25rem;
    margin: 0 1rem;
    overflow: hidden;
    border-radius: 9999px;
    background: var(--color-md3-surface-container-high);
  }

  .batch-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--color-md3-primary);
    transition: width 260ms var(--motion-easing-emphasized-decelerate);
  }

  .batch-progress-indeterminate span {
    width: 42% !important;
    animation: batch-progress-sweep 1.3s var(--motion-easing-emphasized-decelerate) infinite;
  }

  .batch-actions {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.75rem 1rem 0.9rem;
  }

  .batch-action {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border-radius: 9999px;
    padding: 0.35rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    transition:
      filter 160ms var(--motion-easing-standard),
      opacity 160ms var(--motion-easing-standard);
  }

  .batch-action:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .batch-action:disabled {
    opacity: 0.5;
  }

  .batch-action-warning {
    background: var(--color-md3-warning-container);
    color: var(--color-md3-on-warning-container);
  }

  .batch-action-primary {
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
  }

  .batch-action-danger {
    background: var(--color-md3-error-container);
    color: var(--color-md3-on-error-container);
  }

  @keyframes batch-progress-sweep {
    from {
      transform: translateX(-110%);
    }
    to {
      transform: translateX(250%);
    }
  }

  @media (max-width: 520px) {
    .batch-main {
      grid-template-columns: auto auto minmax(0, 1fr);
      gap: 0.55rem;
    }

    .batch-percent {
      grid-column: 3;
      justify-self: start;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .batch-card,
    .batch-progress span,
    .batch-action {
      transition: none;
      animation: none;
    }
  }
</style>
