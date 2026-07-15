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
  import { focusRovingItem } from '$lib/keyboard';

  interface Props {
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
    userPermissions?: readonly string[];
    sourceElement?: HTMLElement | null;
  }

  let { open, x, y, items, onClose, userPermissions = [], sourceElement = null }: Props = $props();

  let menuEl = $state<HTMLDivElement | null>(null);
  let menuX = $state(0);
  let menuY = $state(0);
  let originX = $state<'left' | 'right'>('left');
  let originY = $state<'top' | 'bottom'>('top');
  let focusReturnTarget: HTMLElement | null = null;

  const visibleItems = $derived(filterContextMenuItems(items, userPermissions));

  $effect(() => {
    if (!open) return;

    focusReturnTarget = sourceElement
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    const nextX = x;
    const nextY = y;
    visibleItems.length;
    menuX = nextX;
    menuY = nextY;

    void tick().then(() => {
      if (!menuEl || !open) return;

      const width = menuEl.offsetWidth;
      const height = menuEl.offsetHeight;
      const padding = 8;
      const adjustedX = Math.max(padding, Math.min(nextX, window.innerWidth - width - padding));
      const adjustedY = Math.max(padding, Math.min(nextY, window.innerHeight - height - padding));

      menuX = adjustedX;
      menuY = adjustedY;
      originX = nextX > adjustedX + width / 2 ? 'right' : 'left';
      originY = nextY > adjustedY + height / 2 ? 'bottom' : 'top';
      const firstItem = menuEl.querySelector<HTMLElement>('[data-menu-item]:not(:disabled)');
      if (firstItem) {
        firstItem.tabIndex = 0;
        firstItem.focus({ preventScroll: true });
      } else {
        menuEl.focus({ preventScroll: true });
      }
    });

    return () => {
      if (focusReturnTarget?.isConnected) focusReturnTarget.focus({ preventScroll: true });
      focusReturnTarget = null;
    };
  });

  async function handleItemSelect(item: ContextMenuActionItem) {
    if (item.disabled) return;
    onClose();
    await item.onSelect();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      onClose();
      return;
    }
    if (menuEl && focusRovingItem(event, menuEl, {
      selector: '[data-menu-item]',
      orientation: 'vertical',
    })) return;

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && menuEl) {
      const query = event.key.toLocaleLowerCase();
      const items = Array.from(menuEl.querySelectorAll<HTMLButtonElement>('[data-menu-item]:not(:disabled)'));
      const current = document.activeElement instanceof HTMLButtonElement ? items.indexOf(document.activeElement) : -1;
      const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
      const match = ordered.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(query));
      if (match) {
        event.preventDefault();
        for (const item of items) item.tabIndex = item === match ? 0 : -1;
        match.focus({ preventScroll: true });
      }
    }
  }
</script>

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
    onkeydown={handleKeydown}
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#each visibleItems as item, index (`${isContextMenuDivider(item) ? 'divider' : item.id}:${index}`)}
      {#if isContextMenuDivider(item)}
        <div class="my-1 border-t border-md3-outline/60" role="separator"></div>
      {:else}
        <button
          data-menu-item
          class="w-full text-left px-3 py-2 text-sm transition-colors
                 flex items-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed
                 {item.danger
                   ? 'text-md3-error hover:bg-md3-error-container/30'
                   : 'text-md3-on-surface hover:bg-md3-primary-container/30'}"
          style="font-family: var(--font-md3-sans);"
          role="menuitem"
          tabindex="-1"
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
    max-height: calc(100dvh - 16px);
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    will-change: opacity, transform, filter;
  }

</style>
