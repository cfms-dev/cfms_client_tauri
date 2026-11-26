<script lang="ts">
  import { onDestroy } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { ParentDirectoryResolution } from '$lib/features/files/search-parent-directory-resolver.svelte.ts';
  import { isReducedMotionEnabled } from '$lib/shared/appearance';
  import Icon from '$lib/shared/ui/Icon.svelte';

  interface Props {
    parentId: string;
    firstGroup: boolean;
    resolution?: ParentDirectoryResolution;
    registerVisibility?: (node: HTMLElement, parentId: string) => (() => void) | void;
    onSelect: (parentId: string, resolvedName?: string) => void;
    onRevealComplete?: (parentId: string) => void;
  }

  let {
    parentId,
    firstGroup,
    resolution,
    registerVisibility,
    onSelect,
    onRevealComplete,
  }: Props = $props();

  const REVEAL_FALLBACK_TIMEOUT_MS = 420;

  let revealing = $state(false);
  let revealedLocally = false;
  let revealTimer: ReturnType<typeof setTimeout> | null = null;

  const isResolved = $derived(resolution?.status === 'resolved');
  const isInaccessible = $derived(resolution?.status === 'inaccessible');
  const resolvedName = $derived(
    resolution?.status === 'resolved' ? resolution.name : null,
  );
  const stateAttr = $derived(
    isResolved ? 'resolved' : isInaccessible ? 'inaccessible' : 'pending',
  );
  const tooltipText = $derived.by(() => {
    if (resolvedName) return `${resolvedName} (${parentId})`;
    if (isInaccessible) {
      return $t('files.searchInaccessibleParentDirectory', {
        values: { id: parentId },
      });
    }
    return parentId;
  });
  const ariaLabel = $derived.by(() => {
    if (isInaccessible) {
      return $t('files.searchInaccessibleParentDirectory', {
        values: { id: parentId },
      });
    }
    return $t('files.searchOpenParentDirectory', {
      values: { id: resolvedName ?? parentId },
    });
  });

  function clearRevealTimer() {
    if (revealTimer !== null) {
      clearTimeout(revealTimer);
      revealTimer = null;
    }
  }

  function finishReveal() {
    clearRevealTimer();
    revealing = false;
    revealedLocally = true;
    onRevealComplete?.(parentId);
  }

  $effect(() => {
    const current = resolution;
    const id = parentId;

    if (current?.status !== 'resolved') {
      clearRevealTimer();
      revealing = false;
      revealedLocally = false;
      return;
    }

    if (current.revealed || revealedLocally) {
      return;
    }

    if (isReducedMotionEnabled()) {
      revealedLocally = true;
      onRevealComplete?.(id);
      return;
    }

    if (!revealing) {
      revealing = true;
      clearRevealTimer();
      revealTimer = setTimeout(() => {
        revealTimer = null;
        if (revealing) {
          finishReveal();
        }
      }, REVEAL_FALLBACK_TIMEOUT_MS);
    }
  });

  onDestroy(clearRevealTimer);

  function trackVisibility(node: HTMLElement, observedId: string) {
    let cleanup = registerVisibility?.(node, observedId);
    return {
      update(nextId: string) {
        cleanup?.();
        cleanup = registerVisibility?.(node, nextId);
      },
      destroy() {
        cleanup?.();
      },
    };
  }

  function handleClick() {
    if (isInaccessible) return;
    if (resolvedName) {
      onSelect(parentId, resolvedName);
    } else {
      onSelect(parentId);
    }
  }
</script>

<div
  class="search-group-header-wrap"
  class:search-group-header-wrap--spaced={!firstGroup}
  use:trackVisibility={parentId}
>
  <button
    type="button"
    class="search-group-header"
    class:search-group-header--inaccessible={isInaccessible}
    data-search-group-header={parentId}
    data-search-group-state={stateAttr}
    aria-disabled={isInaccessible ? 'true' : undefined}
    title={tooltipText}
    aria-label={ariaLabel}
    onclick={handleClick}
  >
    <span class="search-group-chevron" aria-hidden="true">
      <Icon name="navigateNext" size="14px" />
    </span>

    {#if revealing && resolvedName}
      <span class="search-group-label-track" data-search-group-revealing="true">
        <span class="search-group-layer search-group-layer--exiting" aria-hidden="true">
          {parentId}
        </span>
        <span
          class="search-group-layer search-group-layer--entering search-group-text--resolved"
          data-search-group-label
          onanimationend={finishReveal}
        >
          {resolvedName}
        </span>
      </span>
    {:else if resolvedName}
      <span class="search-group-text search-group-text--resolved" data-search-group-label>
        {resolvedName}
      </span>
    {:else}
      <span
        class="search-group-text"
        class:search-group-text--inaccessible={isInaccessible}
        data-search-group-label
      >
        {parentId}
      </span>
    {/if}
  </button>
</div>

<style>
  .search-group-header-wrap {
    display: flex;
    align-items: center;
    padding-top: 2px;
    padding-bottom: 4px;
  }

  .search-group-header-wrap--spaced {
    padding-top: 16px;
  }

  .search-group-header {
    display: inline-flex;
    max-width: 100%;
    min-height: 28px;
    align-items: center;
    gap: 6px;
    border: 0;
    border-radius: var(--borderRadiusSmall);
    padding: 4px 2px;
    color: var(--colorNeutralForeground2);
    background: transparent;
    text-align: left;
    font: 400 12px/16px var(--fontFamilyBase);
    cursor: pointer;
    transition: color var(--durationFaster) var(--curveEasyEase);
  }

  .search-group-header:hover:not(.search-group-header--inaccessible) {
    color: var(--colorBrandForegroundLinkHover);
    background: transparent;
  }

  .search-group-header:active:not(.search-group-header--inaccessible) {
    color: var(--colorBrandForegroundLinkPressed);
    background: transparent;
  }

  .search-group-header--inaccessible {
    color: var(--colorNeutralForegroundDisabled);
    cursor: default;
  }

  .search-group-chevron {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    color: var(--colorNeutralForeground3);
    transition:
      transform 140ms var(--curveEasyEase),
      color var(--durationFaster) var(--curveEasyEase);
  }

  .search-group-header:hover:not(.search-group-header--inaccessible) .search-group-chevron {
    color: var(--colorBrandForegroundLinkHover);
    transform: translate3d(2px, 0, 0);
  }

  .search-group-header:active:not(.search-group-header--inaccessible) .search-group-chevron {
    color: var(--colorBrandForegroundLinkPressed);
  }

  .search-group-header--inaccessible .search-group-chevron {
    color: var(--colorNeutralForegroundDisabled);
  }

  .search-group-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search-group-text--resolved {
    font-weight: 500;
  }

  .search-group-text--inaccessible {
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }

  .search-group-label-track {
    display: inline-grid;
    min-width: 0;
    max-width: 100%;
    align-items: center;
  }

  .search-group-layer {
    grid-area: 1 / 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search-group-layer--exiting {
    pointer-events: none;
    animation: search-group-id-wipe-out 300ms var(--curveDecelerateMid) forwards;
  }

  .search-group-layer--entering {
    justify-self: start;
    width: fit-content;
    max-width: 100%;
    animation: search-group-name-slide-in 340ms var(--motion-easing-emphasized-decelerate) both;
  }

  @keyframes search-group-id-wipe-out {
    from {
      opacity: 1;
      clip-path: inset(0 0 0 0);
      transform: translate3d(0, 0, 0);
    }
    to {
      opacity: 0;
      clip-path: inset(0 0 0 100%);
      transform: translate3d(6px, 0, 0);
    }
  }

  @keyframes search-group-name-slide-in {
    from {
      opacity: 0;
      clip-path: inset(0 100% 0 0);
      transform: translate3d(-10px, 0, 0);
    }
    to {
      opacity: 1;
      clip-path: inset(0 0 0 0);
      transform: translate3d(0, 0, 0);
    }
  }

  @media (pointer: coarse) {
    .search-group-header {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .search-group-chevron {
      transition: none;
    }
    .search-group-layer--exiting,
    .search-group-layer--entering {
      animation: none;
    }
  }

  :global(html[data-reduce-motion='true']) .search-group-chevron {
    transition: none;
  }

  :global(html[data-reduce-motion='true']) .search-group-layer--exiting,
  :global(html[data-reduce-motion='true']) .search-group-layer--entering {
    animation: none;
  }

  @media (forced-colors: active) {
    .search-group-header:hover:not(.search-group-header--inaccessible),
    .search-group-header:hover:not(.search-group-header--inaccessible) .search-group-chevron {
      color: LinkText;
    }
    .search-group-header--inaccessible,
    .search-group-header--inaccessible .search-group-chevron {
      color: GrayText;
    }
  }
</style>
