<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import FluentButton from './FluentButton.svelte';
  import Icon from './Icon.svelte';
  import { portal } from '$lib/shared/actions/portal';
  import { menuScale } from '$lib/shared/motion/transitions';
  import './multi-select-filter.css';

  interface Props {
    labels: { label: string; button: string; title: string; help: string };
    count: number;
    disabled?: boolean;
    onOpen: () => void;
    children: Snippet;
    footer: Snippet<[close: () => Promise<void>]>;
  }
  let { labels, count, disabled = false, onOpen, children, footer }: Props = $props();
  const instanceId = $props.id();
  let panelElement = $state<HTMLDivElement | null>(null);
  let rootElement = $state<HTMLDivElement | null>(null);
  let triggerElement = $state<HTMLButtonElement | null>(null);
  let open = $state(false);
  let panelPlacement = $state<'above' | 'below'>('below');
  let panelOffsetX = $state(0);
  let panelTop = $state(0);
  let panelWidth = $state(400);
  let panelMaxHeight = $state(544);
  const PANEL_GAP = 8;
  const VIEWPORT_PADDING = 16;
  const PANEL_MAX_WIDTH = 400;
  const PANEL_MAX_HEIGHT = 544;
  const PANEL_PREFERRED_MIN_HEIGHT = 360;

  $effect(() => {
    if (!open || typeof window === 'undefined') return;
    const reposition = () => positionPanel();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && (rootElement?.contains(event.target) || panelElement?.contains(event.target))) return;
      void closePanel();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', dismiss, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', dismiss, true);
    };
  });
  $effect(() => { if (disabled && open) void closePanel(false); });

  async function openPanel() {
    if (disabled) return;
    onOpen();
    positionPanel();
    open = true;
    await tick();
    positionPanel();
    panelElement?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }
  async function closePanel(returnFocus = true) {
    if (!open) return;
    open = false;
    if (!returnFocus) return;
    await tick();
    triggerElement?.focus({ preventScroll: true });
  }
  function handlePanelKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    void closePanel();
  }
  function positionPanel() {
    if (typeof window === 'undefined' || !triggerElement) return;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const triggerRect = triggerElement.getBoundingClientRect();
    const availableWidth = Math.max(0, viewportWidth - VIEWPORT_PADDING * 2);
    panelWidth = Math.min(PANEL_MAX_WIDTH, availableWidth);
    const naturalLeft = triggerRect.right - panelWidth;
    const clampedLeft = Math.max(
      VIEWPORT_PADDING,
      Math.min(naturalLeft, viewportWidth - panelWidth - VIEWPORT_PADDING),
    );
    panelOffsetX = clampedLeft;

    const spaceBelow = Math.max(
      0,
      viewportHeight - triggerRect.bottom - PANEL_GAP - VIEWPORT_PADDING,
    );
    const spaceAbove = Math.max(0, triggerRect.top - PANEL_GAP - VIEWPORT_PADDING);

    const openBelow = spaceBelow >= PANEL_PREFERRED_MIN_HEIGHT || spaceBelow >= spaceAbove;
    panelPlacement = openBelow ? 'below' : 'above';
    panelMaxHeight = Math.min(PANEL_MAX_HEIGHT, openBelow ? spaceBelow : spaceAbove);
    panelTop = openBelow ? triggerRect.bottom + PANEL_GAP : triggerRect.top - PANEL_GAP;
  }
</script>

<div class="multi-select-filter" bind:this={rootElement}>
  <button data-fluent-owner="shared-multi-select-filter" bind:this={triggerElement}
    type="button" class="filter-trigger" class:filter-trigger--active={count > 0}
    aria-label={labels.button} aria-haspopup="dialog" aria-expanded={open}
    aria-controls={`${instanceId}-panel`} {disabled} onclick={() => open ? closePanel() : openPanel()}>
    <Icon name="filterList" size="18px" /><span>{labels.label}</span>
    {#if count > 0}<span class="filter-count" aria-hidden="true">{count}</span>{/if}
  </button>
  {#if open}
    <div use:portal bind:this={panelElement} id={`${instanceId}-panel`}
      class="filter-panel cfms-acrylic-surface" class:filter-panel--above={panelPlacement === 'above'}
      role="dialog" aria-modal="false" aria-labelledby={`${instanceId}-title`} tabindex="-1"
      style={`left: ${panelOffsetX}px; top: ${panelTop}px; width: ${panelWidth}px; max-height: ${panelMaxHeight}px;`}
      transition:menuScale={{ duration: 150, y: -4 }} onkeydown={handlePanelKeydown}>
      <header class="filter-panel__header">
        <div><h3 id={`${instanceId}-title`}>{labels.title}</h3><p>{labels.help}</p></div>
        <FluentButton data-fluent-owner="shared-multi-select-filter" type="button"
          aria-label={$t('common.close')} onclick={() => closePanel()} appearance="subtle" class="filter-close" iconOnly>
          <Icon name="close" size="17px" />
        </FluentButton>
      </header>
      {@render children()}
      {@render footer(closePanel)}
    </div>
  {/if}
</div>
