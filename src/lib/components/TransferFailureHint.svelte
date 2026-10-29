<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { portal } from '$lib/actions/portal';
  import FluentButton from './FluentButton.svelte';
  import Icon from './Icon.svelte';

  let { reason }: { reason: string } = $props();
  const tooltipId = $props.id();
  let open = $state(false);
  let anchor: HTMLElement | null = null;
  let tooltip = $state<HTMLDivElement | null>(null);
  let position = $state({ left: 0, top: 0 });
  let positioned = $state(false);
  let hovered = false;
  let pointerActivating = false;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
  }

  function close() {
    clearTimers();
    open = false;
    positioned = false;
  }

  function leave() {
    clearTimers();
    hideTimer = setTimeout(() => {
      if (!hovered && !anchor?.matches(':focus-within')) close();
    }, 120);
  }

  function positionTooltip() {
    if (!open || !anchor || !tooltip) return;
    const rect = anchor.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    const below = rect.bottom + 8;
    position = {
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(below + height <= window.innerHeight - 8 ? below : rect.top - height - 8, window.innerHeight - height - 8)),
    };
    positioned = true;
  }

  $effect(() => {
    if (!open) return;
    reason;
    void tick().then(positionTooltip);
    window.addEventListener('resize', positionTooltip);
    window.addEventListener('scroll', positionTooltip, true);
    return () => {
      window.removeEventListener('resize', positionTooltip);
      window.removeEventListener('scroll', positionTooltip, true);
    };
  });

  onDestroy(clearTimers);
</script>

<svelte:document
  onkeydown={(event) => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }}
  onpointerdown={(event) => {
    if (open && !event.composedPath().includes(anchor!) && !event.composedPath().includes(tooltip!)) close();
  }}
/>

<FluentButton
  data-fluent-owner="transfer-failure-hint"
  class="failure-hint"
  appearance="subtle"
  iconOnly
  aria-label={$t('tasks.showFailureDetails')}
  aria-describedby={open ? tooltipId : undefined}
  onpointerenter={(event) => {
    if (event.pointerType === 'touch') return;
    anchor = event.currentTarget;
    hovered = true;
    clearTimers();
    showTimer = setTimeout(() => { open = true; }, 500);
  }}
  onpointerleave={() => { hovered = false; leave(); }}
  onpointerdown={() => { pointerActivating = true; }}
  onfocusin={(event) => {
    anchor = event.currentTarget;
    if (!pointerActivating) { clearTimers(); open = true; }
  }}
  onfocusout={() => { pointerActivating = false; leave(); }}
  onclick={(event) => {
    anchor = event.currentTarget;
    pointerActivating = false;
    clearTimers();
    if (open) close();
    else open = true;
  }}
>
  <Icon name="info" size="16px" />
</FluentButton>

{#if open}
  <div
    use:portal
    bind:this={tooltip}
    id={tooltipId}
    role="tooltip"
    class="failure-tooltip cfms-acrylic-surface"
    style:left="{position.left}px"
    style:top="{position.top}px"
    style:visibility={positioned ? 'visible' : 'hidden'}
    onpointerenter={() => { hovered = true; clearTimers(); }}
    onpointerleave={() => { hovered = false; leave(); }}
  >{reason}</div>
{/if}

<style>
  :global(.failure-hint[data-fluent-owner="transfer-failure-hint"][icon-only]) {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    inline-size: 32px;
    block-size: 32px;
    min-block-size: 32px;
    color: var(--colorNeutralForeground2);
  }
  .failure-tooltip {
    position: fixed;
    z-index: 60;
    box-sizing: border-box;
    width: max-content;
    max-width: min(320px, calc(100vw - 16px));
    max-height: min(320px, calc(100dvh - 16px));
    overflow: auto;
    padding: 8px 12px;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium);
    box-shadow: var(--shadow8);
    color: var(--colorNeutralForeground1);
    font: 400 12px/16px var(--fontFamilyBase);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  @media (pointer: coarse) {
    :global(.failure-hint[data-fluent-owner="transfer-failure-hint"][icon-only]) { inline-size: 44px; block-size: 44px; min-block-size: 44px; }
  }
  @media (forced-colors: active) {
    .failure-tooltip { color: CanvasText; background: Canvas; border-color: CanvasText; box-shadow: none; }
  }
</style>
