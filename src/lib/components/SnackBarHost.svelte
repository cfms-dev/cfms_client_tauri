<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import FluentButton from '$lib/components/FluentButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import { portal } from '$lib/actions/portal';
  import { snackbarMotion, snackbarReflow } from '$lib/motion/transitions';
  import {
    chromeStore, floatingProgressStore, notificationStore,
    type FloatingProgressEntry, type NotificationEntry,
  } from '$lib/stores.svelte';

  interface TimerState {
    entry: NotificationEntry;
    timer?: number;
    remaining: number;
    startedAt: number;
    hovered: boolean;
    focused: boolean;
  }
  type StackEntry =
    | { kind: 'progress'; key: string; createdAt: number; entry: FloatingProgressEntry }
    | { kind: 'notification'; key: string; createdAt: number; entry: NotificationEntry };

  const timers = new Map<number, TimerState>();
  let expandedIds = $state<Set<number>>(new Set());
  let hostEl = $state<HTMLDivElement | null>(null);
  let progressClock = $state(Date.now());
  let readyProgressIds = $state<Set<string>>(new Set());

  const stackEntries = $derived<StackEntry[]>([
    ...floatingProgressStore.entries.slice().reverse()
      .filter((entry) => readyProgressIds.has(entry.id))
      .map((entry) => ({ kind: 'progress' as const, key: `progress:${entry.id}`, createdAt: entry.createdAt, entry })),
    ...notificationStore.entries.slice().reverse()
      .map((entry) => ({ kind: 'notification' as const, key: `notification:${entry.id}`, createdAt: entry.createdAt, entry })),
  ].sort((a, b) => a.createdAt - b.createdAt));

  $effect(() => {
    const entries = floatingProgressStore.entries;
    progressClock;
    return untrack(() => {
      const now = Date.now();
      readyProgressIds = new Set(entries.filter((entry) => entry.createdAt + 1000 <= now).map((entry) => entry.id));
      const pending = entries.map((entry) => entry.createdAt + 1000 - now).filter((delay) => delay > 0);
      if (!pending.length) return;
      const timer = window.setTimeout(() => { progressClock = Date.now(); }, Math.min(...pending));
      return () => window.clearTimeout(timer);
    });
  });

  $effect(() => {
    const entries = notificationStore.entries;
    untrack(() => {
      const activeIds = new Set(entries.map((entry) => entry.id));
      for (const [id, state] of timers) {
        if (activeIds.has(id)) continue;
        window.clearTimeout(state.timer);
        timers.delete(id);
      }
      expandedIds = new Set([...expandedIds].filter((id) => activeIds.has(id)));
      for (const entry of entries) {
        const previous = timers.get(entry.id);
        // Identity also detects two group updates in the same millisecond.
        if (previous?.entry === entry) continue;
        window.clearTimeout(previous?.timer);
        const state: TimerState = {
          entry,
          remaining: entry.timeoutMs === null ? 0 : Math.max(0, entry.timeoutMs - (Date.now() - entry.createdAt)),
          startedAt: Date.now(),
          hovered: previous?.hovered ?? false,
          focused: previous?.focused ?? false,
        };
        timers.set(entry.id, state);
        resumeTimer(state);
      }
    });
  });

  $effect(() => {
    const count = stackEntries.length;
    const element = hostEl;
    if (!element) return;
    let previousHeight = element.clientHeight;
    let previousScrollHeight = element.scrollHeight;
    const updateHeight = () => {
      // Resizing a bottom-anchored stack should keep the newest toast visible,
      // while someone reading older messages retains their scroll position.
      if (previousScrollHeight - element.scrollTop - previousHeight <= 1) {
        element.scrollTop = element.scrollHeight;
      }
      previousHeight = element.clientHeight;
      previousScrollHeight = element.scrollHeight;
      const rect = element.getBoundingClientRect();
      chromeStore.setSnackbarStackHeight(count ? rect.height + window.innerHeight - rect.bottom : 0);
    };
    updateHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  });

  // Keep new messages reachable when a short window makes the stack scroll.
  const latestKey = $derived(stackEntries.at(-1)?.key);
  $effect(() => {
    const element = hostEl;
    if (latestKey && element) element.scrollTop = element.scrollHeight;
  });

  onDestroy(() => {
    for (const state of timers.values()) window.clearTimeout(state.timer);
    timers.clear();
    chromeStore.setSnackbarStackHeight(0);
  });

  function resumeTimer(state: TimerState) {
    if (state.entry.timeoutMs === null || state.hovered || state.focused) return;
    state.startedAt = Date.now();
    state.timer = window.setTimeout(() => remove(state.entry.id), state.remaining);
  }

  function setPaused(id: number, reason: 'hovered' | 'focused', value: boolean) {
    const state = timers.get(id);
    if (!state || state[reason] === value) return;
    const wasPaused = state.hovered || state.focused;
    state[reason] = value;
    const paused = state.hovered || state.focused;
    if (paused === wasPaused) return;
    if (paused) {
      window.clearTimeout(state.timer);
      state.timer = undefined;
      state.remaining = Math.max(0, state.remaining - (Date.now() - state.startedAt));
    } else resumeTimer(state);
  }

  function focusLeft(id: number, event: FocusEvent) {
    const target = event.relatedTarget;
    if (target instanceof Node && (event.currentTarget as HTMLElement).contains(target)) return;
    setPaused(id, 'focused', false);
  }

  function iconFor(type: NotificationEntry['type']) {
    if (type === 'success') return 'checkCircle';
    if (type === 'error') return 'errorFilled';
    if (type === 'warning') return 'warningAmber';
    return 'info';
  }

  function toggleExpanded(id: number) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }

  function remove(id: number) {
    window.clearTimeout(timers.get(id)?.timer);
    timers.delete(id);
    notificationStore.remove(id);
  }

  function hasTotal(entry: FloatingProgressEntry) {
    return Number.isFinite(entry.total) && entry.total > 0 && Number.isFinite(entry.current);
  }

  function percent(entry: FloatingProgressEntry) {
    return Math.round(Math.min(1, Math.max(0, entry.current / entry.total)) * 100);
  }
</script>

<div bind:this={hostEl} use:portal class="snackbar-host">
  {#each stackEntries as item (item.key)}
    <div class="snackbar-slot" animate:snackbarReflow>
      {#if item.kind === 'progress'}
        {@const entry = item.entry}
        <div class="snackbar snackbar-progress" role="status" aria-atomic="true"
          in:snackbarMotion|global out:snackbarMotion|global>
          {#if !hasTotal(entry)}
            <span class="snackbar-icon" aria-hidden="true">
              <ProgressRing size={20} strokeWidth={2} label={entry.title} />
            </span>
          {/if}
          <div class="snackbar-copy">
            <p class="snackbar-title">{entry.title}</p>
            <p class="snackbar-description">{entry.text}</p>
            {#if hasTotal(entry)}
              <progress class="snackbar-meter" max="100" value={percent(entry)} aria-label={entry.title}></progress>
            {/if}
          </div>
        </div>
      {:else}
        {@const entry = item.entry}
        <div class="snackbar snackbar-{entry.type}" role={entry.type === 'error' ? 'alert' : 'status'} aria-atomic="true"
          onmouseenter={() => setPaused(entry.id, 'hovered', true)}
          onmouseleave={() => setPaused(entry.id, 'hovered', false)}
          onfocusin={() => setPaused(entry.id, 'focused', true)}
          onfocusout={(event) => focusLeft(entry.id, event)}
          in:snackbarMotion|global out:snackbarMotion|global>
          <span class="snackbar-icon"><Icon name={iconFor(entry.type)} size={20} /></span>
          <div class="snackbar-copy">
            {#if entry.groupTitle}
              <p class="snackbar-title">{entry.groupTitle}</p>
              <p class="snackbar-description">{entry.text}</p>
            {:else}
              <p>{entry.text}</p>
            {/if}
            {#if expandedIds.has(entry.id) && entry.items.length > 1}
              <div class="snackbar-details" id={`snackbar-details-${entry.id}`}>
                {#each entry.items.slice().reverse() as detail}
                  <p>{detail.text}</p>
                {/each}
              </div>
            {/if}
            {#if entry.action}
              <div class="snackbar-footer">
                <FluentButton data-fluent-owner="lib-components-snack-bar-host" appearance="subtle" tone="primary" class="snackbar-action"
                  onclick={() => { remove(entry.id); entry.action?.onClick(); }}>
                  {entry.action.label}
                </FluentButton>
              </div>
            {/if}
          </div>
          <div class="snackbar-actions">
            {#if entry.items.length > 1}
              <FluentButton data-fluent-owner="lib-components-snack-bar-host" appearance="subtle" class="snackbar-expand"
                aria-label={$t(expandedIds.has(entry.id) ? 'common.showLess' : 'common.showMore')}
                aria-expanded={expandedIds.has(entry.id)}
                aria-controls={expandedIds.has(entry.id) ? `snackbar-details-${entry.id}` : undefined}
                onclick={() => toggleExpanded(entry.id)}>
                {entry.items.length}
                <Icon name={expandedIds.has(entry.id) ? 'expandLess' : 'expandMore'} size={16} />
              </FluentButton>
            {/if}
            <FluentButton data-fluent-owner="lib-components-snack-bar-host" appearance="subtle" iconOnly
              aria-label={$t('common.close')} onclick={() => remove(entry.id)}>
              <Icon name="close" size={20} />
            </FluentButton>
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .snackbar-host {
    --snackbar-gap: 16px;
    position: fixed;
    z-index: 80;
    left: calc(var(--snackbar-gap) + var(--safe-area-left, 0px));
    right: calc(var(--snackbar-gap) + var(--safe-area-right, 0px));
    bottom: calc(var(--snackbar-gap) + var(--safe-area-bottom, 0px));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    max-height: calc(100dvh - 2 * var(--snackbar-gap) - var(--safe-area-top, 0px) - var(--safe-area-bottom, 0px));
    overflow-y: auto;
    overscroll-behavior: contain;
    pointer-events: none;
    /* Leave room for elevation and focus without widening the pointer surface. */
    padding: 8px;
    margin: -8px;
    scroll-padding-block: 8px;
  }
  .snackbar-slot { width: 100%; max-width: 384px; flex: none; pointer-events: auto; }
  .snackbar {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: 8px;
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1);
    box-shadow: var(--shadow16);
    font: 400 14px/20px var(--fontFamilyBase);
  }
  .snackbar p { margin: 0; overflow-wrap: anywhere; }
  .snackbar-copy { flex: 1; min-width: 0; }
  .snackbar-title { font-weight: 600; }
  .snackbar-description { color: var(--colorNeutralForeground2); }
  .snackbar-title + .snackbar-description { margin-top: 4px; }
  .snackbar-icon { display: flex; flex: none; color: var(--colorNeutralForeground2); }
  .snackbar-success .snackbar-icon { color: var(--colorStatusSuccessForeground1); }
  .snackbar-warning .snackbar-icon { color: var(--colorStatusWarningForeground1); }
  .snackbar-error .snackbar-icon { color: var(--colorStatusDangerForeground1); }
  .snackbar-actions { display: flex; flex: none; align-items: center; gap: 4px; margin: -6px -6px -6px 0; }
  .snackbar-footer { display: flex; flex-wrap: wrap; margin-top: 8px; }
  :global(.snackbar-action[data-fluent-owner="lib-components-snack-bar-host"]) { min-inline-size: 0; padding-inline: 8px; margin-inline-start: -8px; text-align: start; }
  :global(.snackbar-action[data-fluent-owner="lib-components-snack-bar-host"]::part(content)) { white-space: normal; overflow-wrap: anywhere; }
  :global(.snackbar-expand[data-fluent-owner="lib-components-snack-bar-host"]) { min-inline-size: 0; padding-inline: 8px; }
  .snackbar-details { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--colorNeutralStroke2); max-height: 128px; overflow: auto; font-size: 12px; line-height: 16px; }
  .snackbar-details p + p { margin-top: 4px; }
  .snackbar-meter { display: block; appearance: none; width: 100%; height: 4px; margin-top: 12px; border: 0; border-radius: 2px; overflow: hidden; background: var(--colorNeutralBackground6); color: var(--colorBrandBackground); }
  .snackbar-meter::-webkit-progress-bar { background: var(--colorNeutralBackground6); }
  .snackbar-meter::-webkit-progress-value { background: var(--colorBrandBackground); }
  .snackbar-meter::-moz-progress-bar { background: var(--colorBrandBackground); }
  @media (min-width: 640px) {
    .snackbar-host { --snackbar-gap: 24px; left: auto; width: min(384px, calc(100vw - 48px - var(--safe-area-left, 0px) - var(--safe-area-right, 0px))); box-sizing: content-box; }
  }
  @media (forced-colors: active) {
    .snackbar { background: Canvas; color: CanvasText; border-color: CanvasText; box-shadow: none; }
    .snackbar .snackbar-icon, .snackbar-description { color: CanvasText; }
    .snackbar-details { border-color: CanvasText; }
    .snackbar-meter { forced-color-adjust: none; color: Highlight; background: Canvas; border: 1px solid CanvasText; }
    .snackbar-meter::-webkit-progress-bar { background: Canvas; }
    .snackbar-meter::-webkit-progress-value { background: Highlight; }
    .snackbar-meter::-moz-progress-bar { background: Highlight; }
  }
</style>
