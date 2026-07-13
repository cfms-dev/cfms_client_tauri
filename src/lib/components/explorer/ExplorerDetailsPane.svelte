<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import type { FileDetailModel } from '$lib/explorer/types';
  import type { TransitionConfig } from 'svelte/transition';

  let {
    open,
    model = null,
    emptyTitle,
    emptyLabel,
    closeLabel,
    onClose,
  }: {
    open: boolean;
    model?: FileDetailModel | null;
    emptyTitle: string;
    emptyLabel: string;
    closeLabel: string;
    onClose: () => void;
  } = $props();

  function detailsPaneTransition(node: HTMLElement): TransitionConfig {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return { duration: 0 };
    }

    const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches;
    const width = node.getBoundingClientRect().width;
    return {
      duration: 180,
      easing: (value) => 1 - Math.pow(1 - value, 3),
      css: (progress, inverse) => mobile
        ? `opacity: ${progress}; transform: translate3d(0, ${inverse * 18}px, 0);`
        : `opacity: ${progress}; width: ${progress * width}px; min-width: ${progress * Math.min(width, 240)}px; transform: translate3d(${inverse * 12}px, 0, 0); overflow: hidden;`,
    };
  }
</script>

{#if open}
  <aside
    class="explorer-details-pane"
    aria-label={model?.title ?? emptyTitle}
    transition:detailsPaneTransition
  >
    <header class="explorer-details-header">
      <div class="explorer-details-heading">
        <span class="explorer-details-icon"><Icon name={model?.icon ?? 'info'} size="22px" /></span>
        <div class="min-w-0">
          <h2>{model?.title ?? emptyTitle}</h2>
          {#if model?.subtitle}<p>{model.subtitle}</p>{/if}
        </div>
      </div>
      <button class="explorer-command-button explorer-details-close" aria-label={closeLabel} title={closeLabel} onclick={onClose}>
        <Icon name="close" size="17px" />
      </button>
    </header>

    <div class="explorer-details-body">
      {#if model?.loading}
        <div class="explorer-details-empty"><ProgressRing size={20} strokeWidth={2.5} label={emptyLabel} /></div>
      {:else if model?.error}
        <p class="explorer-details-error">{model.error}</p>
      {:else if model}
        <dl>
          {#each model.rows as row}
            <div class="explorer-detail-row">
              <dt>{row.label}</dt>
              <dd title={row.value}>{row.value}</dd>
            </div>
          {/each}
        </dl>
      {:else}
        <p class="explorer-details-empty">{emptyLabel}</p>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .explorer-details-pane {
    width: clamp(240px, 24vw, 340px);
    min-width: 240px;
    border-left: 1px solid var(--explorer-border);
    background: var(--explorer-surface-raised);
  }

  .explorer-details-header {
    display: flex;
    min-height: 54px;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border-bottom: 1px solid var(--explorer-border);
    padding: 0.55rem 0.65rem 0.55rem 0.8rem;
  }

  .explorer-details-heading {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.65rem;
  }

  .explorer-details-icon {
    display: inline-flex;
    width: 22px;
    height: 22px;
    flex: none;
    align-items: center;
    justify-content: center;
    color: var(--explorer-accent);
    line-height: 1;
  }
  .explorer-details-heading h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem; font-weight: 600; line-height: 22px; }
  .explorer-details-heading p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--explorer-text-muted); font-size: 0.72rem; }
  .explorer-details-close { width: 30px; min-height: 30px; padding: 0; }
  .explorer-details-body { overflow: auto; padding: 0.7rem 0.8rem; }
  .explorer-detail-row { display: grid; grid-template-columns: minmax(76px, 0.42fr) minmax(0, 1fr); gap: 0.65rem; border-bottom: 1px solid var(--explorer-border); padding: 0.55rem 0; font-size: 0.76rem; }
  .explorer-detail-row dt { color: var(--explorer-text-muted); }
  .explorer-detail-row dd { overflow-wrap: anywhere; color: var(--explorer-text); }
  .explorer-details-empty { padding: 2rem 0.5rem; text-align: center; color: var(--explorer-text-muted); font-size: 0.78rem; }
  .explorer-details-error { color: var(--explorer-danger); font-size: 0.78rem; }

  @media (max-width: 720px) {
    .explorer-details-pane {
      position: fixed;
      right: max(0px, var(--safe-area-right));
      bottom: max(0px, var(--safe-area-bottom));
      left: max(0px, var(--safe-area-left));
      z-index: 70;
      width: auto;
      min-width: 0;
      max-height: 58vh;
      overflow: auto;
      border: 1px solid var(--explorer-border-strong);
      border-radius: var(--explorer-radius-large) var(--explorer-radius-large) 0 0;
      box-shadow: var(--explorer-shadow);
    }
  }
</style>
