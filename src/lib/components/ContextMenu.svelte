<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type {
    ContextMenuActionItem,
    ContextMenuDividerItem,
    ContextMenuItem,
  } from '$lib/components/context-menu';

  interface Props {
    open: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
  }

  let { open, x, y, items, onClose }: Props = $props();

  let menuEl = $state<HTMLDivElement | null>(null);
  let menuX = $state(0);
  let menuY = $state(0);

  const visibleItems = $derived.by(() => {
    const filtered: ContextMenuItem[] = [];

    for (const item of items) {
      if (item.hidden) continue;

      if (isDivider(item)) {
        if (filtered.length > 0 && !isDivider(filtered[filtered.length - 1])) {
          filtered.push(item);
        }
        continue;
      }

      filtered.push(item);
    }

    if (filtered.length > 0 && isDivider(filtered[filtered.length - 1])) {
      filtered.pop();
    }

    return filtered;
  });

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
      menuX = Math.max(padding, Math.min(nextX, window.innerWidth - rect.width - padding));
      menuY = Math.max(padding, Math.min(nextY, window.innerHeight - rect.height - padding));
      menuEl.focus();
    });
  });

  function isDivider(item: ContextMenuItem): item is ContextMenuDividerItem {
    return 'type' in item && item.type === 'divider';
  }

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
    onclick={onClose}
    oncontextmenu={(event) => {
      event.preventDefault();
      onClose();
    }}
  ></div>
  <div
    bind:this={menuEl}
    class="fixed z-50 bg-md3-surface-container/95 backdrop-blur-sm
           rounded-xl border border-md3-outline shadow-lg
           py-1 min-w-[190px] max-w-[min(260px,calc(100vw-16px))]"
    style="left: {menuX}px; top: {menuY}px;"
    role="menu"
    tabindex="-1"
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#each visibleItems as item, index (`${isDivider(item) ? 'divider' : item.id}:${index}`)}
      {#if isDivider(item)}
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
