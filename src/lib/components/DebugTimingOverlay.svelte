<script lang="ts">
  import { onMount } from "svelte";
  import { debugTimingStore } from "$lib/debug-timing.svelte";

  const emptyText = "-";
  const requestText = $derived(formatMs(debugTimingStore.snapshot.requestMs));
  const uiText = $derived(formatMs(debugTimingStore.snapshot.uiMs));

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() !== "q") return;
      event.preventDefault();
      debugTimingStore.toggle();
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  });

  function formatMs(value: number | null) {
    return value === null ? emptyText : `${Math.round(value)}ms`;
  }
</script>

{#if debugTimingStore.visible}
  <div class="debug-timing-overlay" aria-hidden="true">
    请求到响应: {requestText}
    响应到UI: {uiText}
  </div>
{/if}

<style>
  .debug-timing-overlay {
    position: fixed;
    left: calc(env(safe-area-inset-left, 0px) + 8px);
    bottom: calc(env(safe-area-inset-bottom, 0px) + 8px);
    z-index: 2147483647;
    pointer-events: none;
    color: #ffffff;
    font-family: "CFMS Noto Serif SC Subset", "Noto Serif SC", "Source Han Serif SC", serif;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.45;
    white-space: pre-line;
  }
</style>
