<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { fade } from 'svelte/transition';
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import ShortcutKeys from '$lib/components/ShortcutKeys.svelte';
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
  import { portal } from '$lib/actions/portal';

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
  const instanceId = $props.id();
  let reasonTarget = $state<{ itemId: string; tooltipId: string; anchor: HTMLElement; text: string } | null>(null);
  let reasonOpen = $state(false);
  let reasonPosition = $state({ left: 0, top: 0 });
  let reasonHovered = false;
  let reasonShowTimer: ReturnType<typeof setTimeout> | undefined;
  let reasonHideTimer: ReturnType<typeof setTimeout> | undefined;

  const visibleItems = $derived(filterContextMenuItems(items, userPermissions));
  const hasShortcuts = $derived(visibleItems.some((item) => !isContextMenuDivider(item) && !!item.shortcuts?.length));
  const menuOpen = $derived(open);

  $effect(() => {
    if (!menuOpen) return;

    focusReturnTarget = untrack(() => sourceElement)
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    menuX = untrack(() => x);
    menuY = untrack(() => y);

    void tick().then(() => {
      if (!menuEl || !open) return;
      const firstItem = menuEl.querySelector<HTMLElement>('[data-menu-item]:not(:disabled):not([aria-disabled="true"])')
        ?? menuEl.querySelector<HTMLElement>('[data-menu-item]:not(:disabled)');
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

  // Item state can change while the menu is open. Reposition without resetting focus.
  $effect(() => {
    if (!open) return;
    visibleItems;
    const nextX = x;
    const nextY = y;
    void tick().then(() => {
      if (!menuEl || !open) return;
      const { offsetWidth: width, offsetHeight: height } = menuEl;
      menuX = Math.max(8, Math.min(nextX, window.innerWidth - width - 8));
      menuY = Math.max(8, Math.min(nextY, window.innerHeight - height - 8));
      originX = nextX > menuX + width / 2 ? 'right' : 'left';
      originY = nextY > menuY + height / 2 ? 'bottom' : 'top';
    });
  });

  function cancelReasonTimers() {
    clearTimeout(reasonShowTimer);
    clearTimeout(reasonHideTimer);
    reasonShowTimer = reasonHideTimer = undefined;
  }

  function closeReason() {
    cancelReasonTimers();
    reasonOpen = false;
    reasonTarget = null;
    reasonHovered = false;
  }

  function itemReason(item: ContextMenuActionItem): string | undefined {
    if (item.disabled) return item.disabledReason;
    return item.requiresElevation ? $t('contextMenu.elevationRequired') : undefined;
  }

  function showReason(item: ContextMenuActionItem, index: number, anchor: HTMLElement, immediate = false) {
    const text = itemReason(item);
    if (!text) return;
    cancelReasonTimers();
    if (reasonTarget?.itemId !== item.id) {
      reasonOpen = false;
      reasonHovered = false;
    }
    reasonTarget = { itemId: item.id, tooltipId: `${instanceId}-reason-${index}`, anchor, text };
    if (immediate) reasonOpen = true;
    else {
      reasonHovered = true;
      if (!reasonOpen) reasonShowTimer = setTimeout(() => { reasonOpen = true; }, 500);
    }
  }

  function leaveReason() {
    clearTimeout(reasonShowTimer);
    clearTimeout(reasonHideTimer);
    reasonHideTimer = setTimeout(() => {
      if (!reasonHovered && document.activeElement !== reasonTarget?.anchor) closeReason();
    }, 120);
  }

  function positionReason() {
    if (!reasonOpen || !reasonTarget) return;
    const tooltip = document.getElementById(reasonTarget.tooltipId);
    if (!tooltip) return;
    const anchor = reasonTarget.anchor.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    const right = anchor.right + 8;
    const left = anchor.left - width - 8;
    const beside = right + width <= window.innerWidth - 8 || left >= 8;
    reasonPosition = {
      left: Math.max(8, Math.min(right + width <= window.innerWidth - 8 ? right : left >= 8 ? left : anchor.left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(beside ? anchor.top : anchor.bottom + 8, window.innerHeight - height - 8)),
    };
  }

  $effect(() => {
    if (!reasonTarget) return;
    const item = visibleItems.find((item) => !isContextMenuDivider(item) && item.id === reasonTarget?.itemId);
    if (!open || !item || isContextMenuDivider(item) || itemReason(item) !== reasonTarget.text
      || reasonTarget.tooltipId !== `${instanceId}-reason-${visibleItems.indexOf(item)}`) closeReason();
  });

  $effect(() => {
    if (!reasonOpen || !reasonTarget) return;
    void tick().then(positionReason);
    window.addEventListener('resize', positionReason);
    window.addEventListener('scroll', positionReason, true);
    return () => {
      window.removeEventListener('resize', positionReason);
      window.removeEventListener('scroll', positionReason, true);
    };
  });

  onDestroy(cancelReasonTimers);

  function closeMenu() {
    closeReason();
    onClose();
  }

  async function handleItemSelect(item: ContextMenuActionItem) {
    if (item.disabled) return;
    closeMenu();
    await item.onSelect();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === 'Tab') {
      closeMenu();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element
      && event.target.closest('[data-menu-item][aria-disabled="true"]')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (menuEl && focusRovingItem(event, menuEl, {
      selector: '[data-menu-item]',
      orientation: 'vertical',
      includeAriaDisabled: true,
    })) return;

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && menuEl) {
      const query = event.key.toLocaleLowerCase();
      const items = Array.from(menuEl.querySelectorAll<HTMLButtonElement>('[data-menu-item]:not(:disabled)'));
      const current = document.activeElement instanceof HTMLButtonElement ? items.indexOf(document.activeElement) : -1;
      const ordered = [...items.slice(current + 1), ...items.slice(0, current + 1)];
      const match = ordered.find((item) => item.querySelector('.context-menu-label')?.textContent?.trim().toLocaleLowerCase().startsWith(query));
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
    use:portal
    class="fixed inset-0 z-40"
    role="presentation"
    transition:fade={{ duration: 90 }}
    onclick={closeMenu}
    oncontextmenu={(event) => {
      event.preventDefault();
      closeMenu();
    }}
  ></div>
  <div
    bind:this={menuEl}
    use:portal
    class="context-menu-surface cfms-acrylic-surface cfms-menu-surface fixed z-50"
    style="left: {menuX}px; top: {menuY}px; transform-origin: {originX} {originY};"
    transition:menuScale={{ duration: 140 }}
    role="menu"
    tabindex="-1"
    onkeydown={handleKeydown}
    oncontextmenu={(event) => event.preventDefault()}
  >
    <div class="context-menu-scroll" class:has-shortcuts={hasShortcuts} role="presentation">
      {#each visibleItems as item, index (`${isContextMenuDivider(item) ? 'divider' : item.id}:${index}`)}
        {#if isContextMenuDivider(item)}
          <div class="context-menu-separator" role="separator"></div>
        {:else}
          <button
            data-menu-item
            class="context-menu-item"
            class:danger={item.danger}
            class:requires-elevation={item.requiresElevation && !item.disabled}
            role="menuitem"
            tabindex="-1"
            onclick={() => handleItemSelect(item)}
            disabled={item.disabled && !item.disabledReason}
            aria-disabled={item.disabled ? 'true' : undefined}
            aria-describedby={itemReason(item) ? `${instanceId}-reason-${index}` : undefined}
            onpointerenter={(event) => {
              if (event.pointerType !== 'touch') showReason(item, index, event.currentTarget);
            }}
            onpointerleave={(event) => {
              if (reasonTarget?.anchor !== event.currentTarget) return;
              reasonHovered = false;
              leaveReason();
            }}
            onfocus={(event) => showReason(item, index, event.currentTarget, true)}
            onblur={leaveReason}
            onpointerdown={(event) => {
              if (event.pointerType === 'touch') showReason(item, index, event.currentTarget, true);
            }}
          >
            <Icon class="context-menu-icon" name={item.icon} size="20px" filled={item.iconFilled} duotone={!item.iconFilled && !item.danger && !item.disabled} tone={item.requiresElevation && !item.disabled ? 'warning' : 'default'} />
            <span class="context-menu-label">{item.label}</span>
            {#if item.shortcuts?.length}
              <ShortcutKeys class="context-menu-shortcut" shortcuts={item.shortcuts} variant="menu" />
            {/if}
          </button>
          {#if itemReason(item)}
            <span
              use:portal
              id={`${instanceId}-reason-${index}`}
              class="context-menu-reason cfms-acrylic-surface"
              role="tooltip"
              hidden={!reasonOpen || reasonTarget?.itemId !== item.id}
              style:left="{reasonPosition.left}px"
              style:top="{reasonPosition.top}px"
              onpointerenter={() => { reasonHovered = true; clearTimeout(reasonHideTimer); }}
              onpointerleave={() => { reasonHovered = false; leaveReason(); }}
            >{itemReason(item)}</span>
          {/if}
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .context-menu-surface {
    display: flex;
    flex-direction: column;
    width: max-content;
    min-width: min(190px, calc(100vw - 16px));
    max-width: min(320px, calc(100vw - 16px));
    max-height: calc(100dvh - 16px);
    overflow: clip;
    font: 400 14px/20px var(--fontFamilyBase);
  }
  .context-menu-scroll {
    display: grid;
    /* Include row insets as tracks so full-width buttons share content columns. */
    grid-template-columns: 8px [icon] 20px 8px [label] minmax(0, 1fr) 8px;
    grid-auto-rows: max-content;
    align-content: start;
    min-width: 0;
    min-height: 0;
    padding: 4px;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .context-menu-scroll.has-shortcuts {
    grid-template-columns: 8px [icon] 20px 8px [label] minmax(0, 1fr) 16px [shortcut] max-content 8px;
  }
  .context-menu-item {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    width: 100%;
    min-block-size: 32px;
    padding: 6px 0;
    border-radius: var(--borderRadiusMedium);
    color: var(--colorNeutralForeground1);
    text-align: start;
    cursor: default;
    transition: background-color var(--durationFaster) var(--curveEasyEase);
  }
  .context-menu-item:hover:not(:disabled):not([aria-disabled='true']), .context-menu-item:focus-visible { background: var(--colorSubtleBackgroundHover); }
  .context-menu-item:active:not(:disabled):not([aria-disabled='true']) { background: var(--colorSubtleBackgroundPressed); }
  .context-menu-item.danger { color: var(--colorStatusDangerForeground1); }
  .context-menu-item.requires-elevation { color: var(--colorStatusWarningForeground2); }
  .context-menu-item:is(:disabled, [aria-disabled='true']) { color: var(--colorNeutralForegroundDisabled); cursor: not-allowed; }
  .context-menu-item :global(.context-menu-icon) { grid-column: icon; }
  .context-menu-label { grid-column: label; min-width: 0; overflow-wrap: anywhere; }
  .context-menu-item :global(.context-menu-shortcut) { grid-column: shortcut; }
  .context-menu-separator { grid-column: 1 / -1; margin-block: 4px; border-top: 1px solid var(--colorNeutralStroke2); }
  .context-menu-reason {
    position: fixed;
    z-index: 60;
    box-sizing: border-box;
    width: max-content;
    max-width: min(320px, calc(100vw - 16px));
    max-height: calc(100dvh - 16px);
    overflow: auto;
    padding: 8px 12px;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium);
    box-shadow: var(--shadow8);
    color: var(--colorNeutralForeground1);
    font: 400 12px/16px var(--fontFamilyBase);
    overflow-wrap: anywhere;
  }
  @media (pointer: coarse) { .context-menu-item { min-block-size: 44px; } }
  @media (forced-colors: active) {
    /* Rows use system colors explicitly; preserve them through inline labels,
     * shortcut text and SVGs without the browser's opaque text backplates. */
    .context-menu-item { forced-color-adjust: none; color: CanvasText; background: transparent; transition: none; }
    .context-menu-item.danger, .context-menu-item.requires-elevation { color: CanvasText; }
    .context-menu-item:is(:disabled, [aria-disabled='true']) { color: GrayText; background: transparent; }
    .context-menu-item:is(:hover, :focus-visible, :active):not(:disabled):not([aria-disabled='true']) { color: HighlightText; background: Highlight; }
    .context-menu-reason { color: CanvasText; background: Canvas; border-color: CanvasText; box-shadow: none; }
    .context-menu-separator { border-color: CanvasText; }
  }
</style>
