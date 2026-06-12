<script lang="ts">
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { debugLatencyStore } from '$lib/debug-latency.svelte';
  import Icon from '$lib/components/Icon.svelte';

  const latest = $derived(debugLatencyStore.latest);
  const durationLabel = $derived(
    latest ? `${Math.round(latest.durationMs)} ms` : '-- ms',
  );

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'q') {
        event.preventDefault();
        debugLatencyStore.toggle();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

{#if debugLatencyStore.visible}
  <aside
    class="latency-overlay"
    aria-live="polite"
    transition:fly={{ x: -10, y: 8, duration: 220 }}
  >
    <div class="latency-overlay__header">
      <Icon name="accessTime" size="16px" />
      <span>请求耗时</span>
      <button type="button" aria-label="隐藏请求耗时" onclick={() => debugLatencyStore.setVisible(false)}>
        <Icon name="close" size="14px" />
      </button>
    </div>
    <div class="latency-overlay__body" transition:fade={{ duration: 120 }}>
      <strong class:latency-overlay__error={latest && !latest.ok}>{durationLabel}</strong>
      <span>{latest?.command ?? '等待请求'}</span>
    </div>
  </aside>
{/if}

<style>
  .latency-overlay {
    position: fixed;
    inset-inline-start: calc(var(--safe-area-left) + 0.75rem);
    inset-block-end: calc(var(--safe-area-bottom) + 0.75rem);
    z-index: 60;
    display: grid;
    min-inline-size: 180px;
    max-inline-size: min(320px, calc(100vw - 1.5rem));
    gap: 0.35rem;
    border: 1px solid color-mix(in srgb, var(--color-md3-outline) 76%, transparent);
    border-radius: 8px;
    background:
      linear-gradient(145deg, rgba(31, 41, 55, 0.94), rgba(15, 23, 42, 0.9));
    box-shadow:
      0 16px 42px rgba(0, 0, 0, 0.36),
      0 0 0 1px rgba(255, 255, 255, 0.04) inset;
    padding: 0.6rem 0.7rem;
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
    backdrop-filter: blur(18px);
  }

  .latency-overlay__header,
  .latency-overlay__body {
    display: flex;
    align-items: center;
    min-inline-size: 0;
  }

  .latency-overlay__header {
    gap: 0.35rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.72rem;
    font-weight: 650;
  }

  .latency-overlay__header button {
    margin-inline-start: auto;
    display: inline-grid;
    place-items: center;
    inline-size: 22px;
    block-size: 22px;
    border-radius: 9999px;
    color: var(--color-md3-on-surface-variant);
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .latency-overlay__header button:hover {
    background: color-mix(in srgb, var(--color-md3-on-surface) 10%, transparent);
    color: var(--color-md3-on-surface);
  }

  .latency-overlay__body {
    gap: 0.65rem;
  }

  .latency-overlay__body strong {
    color: var(--color-md3-primary-emphasis);
    font-size: 1.05rem;
    font-weight: 760;
    white-space: nowrap;
  }

  .latency-overlay__body span {
    min-inline-size: 0;
    overflow: hidden;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.76rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .latency-overlay__body .latency-overlay__error {
    color: var(--color-md3-error);
  }
</style>
