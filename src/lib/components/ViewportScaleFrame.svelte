<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    children,
    class: className = '',
    inlinePadding = 40,
    blockPadding = 112,
    minScale = 0.1,
  }: {
    children: Snippet;
    class?: string;
    inlinePadding?: number;
    blockPadding?: number;
    minScale?: number;
  } = $props();

  let viewportWidth = $state(0);
  let viewportHeight = $state(0);
  let contentWidth = $state(1);
  let contentHeight = $state(1);

  const scale = $derived.by(() => {
    if (viewportWidth <= 0 || viewportHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
      return 1;
    }

    const inlineScale = Math.max(0, viewportWidth - inlinePadding) / contentWidth;
    const blockScale = Math.max(0, viewportHeight - blockPadding) / contentHeight;
    return Math.min(1, Math.max(minScale, Math.min(inlineScale, blockScale)));
  });

  const frameStyle = $derived(
    `width: ${Math.ceil(contentWidth * scale)}px; height: ${Math.ceil(contentHeight * scale)}px;`,
  );
  const surfaceStyle = $derived(`transform: scale(${scale});`);
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />

<div class={`viewport-scale-frame ${className}`} style={frameStyle}>
  <div class="viewport-scale-frame__surface" style={surfaceStyle}>
    <div
      class="viewport-scale-frame__content"
      bind:clientWidth={contentWidth}
      bind:clientHeight={contentHeight}
    >
      {@render children()}
    </div>
  </div>
</div>

<style>
  .viewport-scale-frame {
    position: relative;
    flex: 0 0 auto;
  }

  .viewport-scale-frame__surface {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    transform-origin: 0 0;
  }

  .viewport-scale-frame__content {
    display: inline-block;
  }
</style>
