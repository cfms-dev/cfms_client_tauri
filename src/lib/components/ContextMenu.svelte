<script lang="ts">
  import { tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import Icon from '$lib/components/Icon.svelte';
  import { menuScale } from '$lib/motion/transitions';
  import type {
    ContextMenuActionItem,
    ContextMenuItem,
  } from '$lib/components/context-menu';
  import {
    filterContextMenuItems,
    isContextMenuDivider,
  } from '$lib/components/context-menu';

  interface Props {
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
    userPermissions?: readonly string[];
  }

  let { open, x, y, items, onClose, userPermissions = [] }: Props = $props();

  let menuEl = $state<HTMLDivElement | null>(null);
  let menuX = $state(0);
  let menuY = $state(0);
  let originX = $state<'left' | 'right'>('left');
  let originY = $state<'top' | 'bottom'>('top');

  const visibleItems = $derived(filterContextMenuItems(items, userPermissions));

  $effect(() => {
    if (!open) return;

    const nextX = x;
    const nextY = y;
    visibleItems.length;
    menuX = nextX;
    menuY = nextY;

    void tick().then(() => {
      if (!menuEl || !open) return;

      const rect = menuEl.getBoundingClientRect();
      const padding = 8;
      const adjustedX = Math.max(padding, Math.min(nextX, window.innerWidth - rect.width - padding));
      const adjustedY = Math.max(padding, Math.min(nextY, window.innerHeight - rect.height - padding));

      menuX = adjustedX;
      menuY = adjustedY;
      originX = nextX > adjustedX + rect.width / 2 ? 'right' : 'left';
      originY = nextY > adjustedY + rect.height / 2 ? 'bottom' : 'top';
      menuEl.focus();
    });
  });

  async function handleItemSelect(item: ContextMenuActionItem) {
    if (item.disabled) return;
    onClose();
    await item.onSelect();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && visibleItems.length > 0}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="fixed inset-0 z-40"
    role="presentation"
    transition:fade={{ duration: 90 }}
    onclick={onClose}
    oncontextmenu={(event) => {
      event.preventDefault();
      onClose();
    }}
  ></div>
  <div
    bind:this={menuEl}
    class="context-menu-surface fixed z-50 bg-md3-surface-container/95 backdrop-blur-sm
           rounded-xl border border-md3-outline shadow-lg
           py-1 min-w-[190px] max-w-[min(260px,calc(100vw-16px))]"
    style="left: {menuX}px; top: {menuY}px; transform-origin: {originX} {originY};"
    transition:menuScale={{ duration: 140 }}
    role="menu"
    tabindex="-1"
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#each visibleItems as item, index (`${isContextMenuDivider(item) ? 'divider' : item.id}:${index}`)}
      {#if isContextMenuDivider(item)}
        <div class="my-1 border-t border-md3-outline/60" role="separator"></div>
      {:else}
        <button
          class="w-full text-left px-3 py-2 text-sm transition-colors
                 flex items-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed
                 {item.danger
                   ? 'text-md3-error hover:bg-md3-error-container/30'
                   : 'text-md3-on-surface hover:bg-md3-primary-container/30'}"
          style="font-family: var(--font-md3-sans);"
          role="menuitem"
          onclick={() => handleItemSelect(item)}
          disabled={item.disabled}
        >
          <Icon name={item.icon} size="16px" />
          <span class="truncate">{item.label}</span>
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .context-menu-surface {
    will-change: opacity, transform, filter;
  }

  @media (prefers-reduced-motion: reduce) {
    .context-menu-surface {
      will-change: auto;
    }
  }
</style>
