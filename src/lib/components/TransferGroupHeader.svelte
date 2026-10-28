<script lang="ts">
  import type { Snippet } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import FluentButton from './FluentButton.svelte';
  import Icon from './Icon.svelte';
  import ProgressRing from './ProgressRing.svelte';

  let { name, count, expanded, disabled = false, deleting = false, progress,
    onToggle, actions, status, metadata }: {
    name: string; count: string; expanded: boolean; disabled?: boolean; deleting?: boolean;
    progress: number | null; onToggle: () => void;
    actions: Snippet; status: Snippet; metadata?: Snippet;
  } = $props();
  const disclosureLabel = $derived($t(expanded ? 'tasks.collapseBatchNamed' : 'tasks.expandBatchNamed', { values: { name } }));
  const percent = $derived(progress === null ? null : Math.round(progress * 100));
</script>

<div class="transfer-group" class:deleting aria-busy={disabled}>
  <div class="group-heading">
    <FluentButton appearance="subtle" iconOnly class="group-disclosure" {disabled}
      onclick={onToggle} aria-expanded={expanded} aria-label={disclosureLabel} title={disclosureLabel}>
      <span class="group-chevron" class:expanded><Icon name="expandMore" size="18px" /></span>
    </FluentButton>
    <span class="group-folder" aria-hidden="true">
      {#if deleting}<ProgressRing size={20} strokeWidth={2.6} label={$t('tasks.batchDeleting')} />
      {:else}<Icon name="folder" size="20px" />{/if}
    </span>
    <div class="group-identity"><strong class="group-name">{name}</strong><span class="group-count">{count}</span></div>
    <div class="group-actions">{@render actions()}</div>
  </div>
  <div class="group-details">
    <div class="group-status" aria-live="polite">{@render status()}</div>
    <div class="group-progress-meta">
      {#if metadata}<span class="group-metadata">{@render metadata()}</span>{/if}
      <span class="group-percent">{percent === null ? $t('tasks.batchProgressPending') : `${percent}%`}</span>
    </div>
    <div class="group-track" class:indeterminate={percent === null} role="progressbar"
      aria-label={$t('tasks.progressFor', { values: { name } })} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent ?? undefined}>
      <span style:width={`${percent ?? 0}%`}></span>
    </div>
  </div>
</div>

<style>
  .transfer-group { min-width: 0; padding: 10px 8px; border-bottom: 1px solid var(--colorNeutralStroke2); }
  .transfer-group.deleting { background: color-mix(in srgb, var(--explorer-danger) 12%, transparent); }
  .group-heading { display: flex; min-width: 0; align-items: flex-start; gap: 8px; }
  :global(.group-disclosure[icon-only]) { display: inline-flex; inline-size: 36px; block-size: 36px; flex: none; align-items: center; justify-content: center; }
  .group-actions :global(.cfms-button[icon-only]) { inline-size: 36px; block-size: 36px; }
  .group-chevron { display: inline-flex; transform: rotate(-90deg); transition: transform 180ms var(--motion-easing-standard); }
  .group-chevron.expanded { transform: none; }
  .group-folder { display: inline-flex; flex: none; align-items: center; margin-block-start: 8px; color: var(--explorer-folder); }
  .group-identity { display: flex; flex: 1; min-width: 0; padding-block-start: 8px; align-items: baseline; gap: 4px 12px; flex-wrap: wrap; }
  .group-name { min-width: 0; overflow-wrap: anywhere; color: var(--colorNeutralForeground1); font: 600 14px/20px var(--fontFamilyBase); text-align: start; }
  .group-count { color: var(--colorNeutralForeground2); font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; }
  .group-actions { display: flex; flex: none; align-items: center; gap: 4px; }
  .group-details { display: grid; min-width: 0; margin-inline-start: 44px; margin-top: 4px; gap: 8px; }
  .group-status { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--colorNeutralForeground2); font-size: 12px; line-height: 16px; overflow-wrap: anywhere; }
  .group-progress-meta { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; color: var(--colorNeutralForeground2); }
  .group-metadata { min-width: 0; overflow-wrap: anywhere; }
  .group-percent { margin-inline-start: auto; flex: none; }
  .group-track { height: 3px; overflow: hidden; border-radius: var(--borderRadiusSmall); background: var(--colorNeutralStroke2); }
  .group-track > span { display: block; height: 100%; background: var(--colorCompoundBrandForeground1); transition: width 180ms var(--motion-easing-standard); }
  .group-track.indeterminate > span { width: 42% !important; animation: progress-sweep 1.3s var(--motion-easing-standard) infinite; }
  @keyframes progress-sweep { from { transform: translateX(-110%); } to { transform: translateX(250%); } }
  @media (max-width: 520px) {
    .group-heading { display: grid; grid-template-columns: 36px 20px minmax(0, 1fr); }
    .group-identity { grid-column: 3; }
    .group-actions { grid-column: 3; justify-self: end; }
    .group-details { margin-inline-start: 0; margin-top: 8px; }
  }
  @media (pointer: coarse) {
    :global(.group-disclosure[icon-only]), .group-actions :global(.cfms-button[icon-only]) { inline-size: 44px; block-size: 44px; }
    .group-folder { margin-block-start: 12px; }
    .group-identity { padding-block-start: 12px; }
    .group-details { margin-inline-start: 52px; }
  }
  @media (pointer: coarse) and (max-width: 520px) {
    .group-heading { grid-template-columns: 44px 20px minmax(0, 1fr); }
    .group-details { margin-inline-start: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .group-chevron, .group-track > span { transition: none; }
    .group-track.indeterminate > span { animation: none; }
  }
</style>
