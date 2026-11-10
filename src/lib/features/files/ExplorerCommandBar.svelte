<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import type { CommandAction } from '$lib/features/files/explorer-types';
  import { focusRovingItem } from '$lib/shared/ui/keyboard';

  let {
    actions,
    ariaLabel,
    class: className = '',
  }: {
    actions: CommandAction[];
    ariaLabel: string;
    class?: string;
  } = $props();

  const visibleActions = $derived(actions.filter((action) => action.visible !== false));
  const actionSignature = $derived(
    visibleActions.map((action) => `${action.id}:${action.label}:${action.compact ? 1 : 0}`).join('|'),
  );
  const firstEnabledActionIndex = $derived(visibleActions.findIndex((action) => !action.disabled));

  let commandBarElement = $state<HTMLDivElement | null>(null);
  let measurementElement = $state<HTMLDivElement | null>(null);
  let labelsCollapsed = $state(false);
  let scrollableOverflow = $state(false);
  let measurementRequest = 0;
  let scheduledFrame: number | null = null;

  $effect(() => {
    actionSignature;
    commandBarElement;
    measurementElement;
    scheduleMeasurement();
  });

  onMount(() => {
    scheduleMeasurement();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && commandBarElement && measurementElement) {
      observer = new ResizeObserver(scheduleMeasurement);
      observer.observe(commandBarElement);
      observer.observe(measurementElement);
    }
    document.fonts?.addEventListener('loadingdone', scheduleMeasurement);
    void document.fonts?.ready.then(scheduleMeasurement);
    return () => {
      document.fonts?.removeEventListener('loadingdone', scheduleMeasurement);
      observer?.disconnect();
      if (scheduledFrame !== null) window.cancelAnimationFrame(scheduledFrame);
    };
  });

  function scheduleMeasurement() {
    if (typeof window === 'undefined' || scheduledFrame !== null) return;
    scheduledFrame = window.requestAnimationFrame(() => {
      scheduledFrame = null;
      void measureLayout();
    });
  }

  async function measureLayout() {
    if (!commandBarElement || !measurementElement) return;
    const request = ++measurementRequest;
    labelsCollapsed = measurementElement.offsetWidth > commandBarElement.clientWidth + 1;
    await tick();
    if (request !== measurementRequest || !commandBarElement) return;
    scrollableOverflow = commandBarElement.scrollWidth > commandBarElement.clientWidth + 1;
    if (!scrollableOverflow) commandBarElement.scrollLeft = 0;
  }

  function handleWheel(event: WheelEvent) {
    if (!commandBarElement || commandBarElement.scrollWidth <= commandBarElement.clientWidth + 1) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    event.preventDefault();
    commandBarElement.scrollLeft += delta;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!commandBarElement) return;
    focusRovingItem(event, commandBarElement, {
      selector: '[data-command-item]',
      orientation: 'horizontal',
    });
  }
</script>

<div
  bind:this={commandBarElement}
  class={`explorer-command-bar ${className}`}
  class:explorer-command-bar--labels-collapsed={labelsCollapsed}
  class:explorer-command-bar--scrollable={scrollableOverflow}
  role="toolbar"
  tabindex="-1"
  aria-label={ariaLabel}
  data-keyboard-region="toolbar"
  onwheel={handleWheel}
  onkeydown={handleKeydown}
>
  {#each visibleActions as action, index (action.id)}
    {#if action.dividerBefore}
      <span class="explorer-command-divider" aria-hidden="true"></span>
    {/if}
    <FluentButton data-fluent-owner="lib-components-explorer-explorer-command-bar"
      appearance="subtle"
      iconOnly={Boolean(action.compact || labelsCollapsed)}
      data-command-item
      type="button"
      class="explorer-command-button {action.compact || labelsCollapsed ? 'explorer-command-button--compact' : ''}"
      data-active={action.active ? 'true' : undefined}
      data-tone={action.tone ?? 'default'}
      disabled={action.disabled}
      tabindex={index === firstEnabledActionIndex ? 0 : -1}
      title={action.label}
      aria-label={action.label}
      aria-pressed={action.active ? 'true' : undefined}
      onclick={() => action.run()}
    >
      <Icon name={action.icon} size="18px" />
      <span class:sr-only={action.compact || labelsCollapsed}>{action.label}</span>
    </FluentButton>
  {/each}
</div>

<div bind:this={measurementElement} class="explorer-command-measure" aria-hidden="true">
  {#each visibleActions as action (action.id)}
    {#if action.dividerBefore}
      <span class="explorer-command-divider" aria-hidden="true"></span>
    {/if}
    <span
      class="explorer-command-button explorer-command-measure-button"
      class:explorer-command-button--compact={action.compact}
    >
      <Icon name={action.icon} size="18px" />
      {#if !action.compact}<span>{action.label}</span>{/if}
    </span>
  {/each}
</div>

<style>
  .explorer-command-bar {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-inline: contain;
    scrollbar-width: none;
  }

  :global(.explorer-command-bar .explorer-command-button[data-fluent-owner="lib-components-explorer-explorer-command-bar"]) {
    flex: none;
    white-space: nowrap;
  }

  .explorer-command-bar::-webkit-scrollbar {
    display: none;
  }

  .explorer-command-bar--scrollable {
    scrollbar-color: color-mix(in srgb, var(--explorer-text-muted) 45%, transparent) transparent;
    scrollbar-width: thin;
  }

  .explorer-command-bar--scrollable::-webkit-scrollbar {
    display: block;
    height: 4px;
  }

  .explorer-command-bar--scrollable::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: color-mix(in srgb, var(--explorer-text-muted) 45%, transparent);
  }

  .explorer-command-divider {
    flex: none;
    align-self: stretch;
    width: 1px;
    min-height: 22px;
    margin: 0.3rem 0.35rem;
    background: var(--explorer-border);
  }

  :global(.explorer-command-button--compact[data-fluent-owner="lib-components-explorer-explorer-command-bar"]) {
    width: 32px;
    padding-inline: 0;
  }

  .explorer-command-measure {
    position: fixed;
    top: -10000px;
    left: -10000px;
    display: flex;
    width: max-content;
    align-items: center;
    gap: 4px;
    visibility: hidden;
    pointer-events: none;
  }

  .explorer-command-measure-button {
    flex: none;
    min-inline-size: 96px;
    white-space: nowrap;
    font-weight: 400;
  }
  :global(.explorer-command-button[data-fluent-owner="lib-components-explorer-explorer-command-bar"]) { font-weight: 400; }
  .explorer-command-measure-button.explorer-command-button--compact { min-inline-size: 32px; }

  @media (pointer: coarse) {
    :global(.explorer-command-button--compact[data-fluent-owner="lib-components-explorer-explorer-command-bar"]) { width: 44px; }
  }

</style>
