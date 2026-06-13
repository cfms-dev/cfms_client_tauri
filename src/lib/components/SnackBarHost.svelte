<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import ProgressRing from "$lib/components/ProgressRing.svelte";
  import { snackbarMotion } from "$lib/motion/transitions";
  import {
    chromeStore,
    floatingProgressStore,
    notificationStore,
    type FloatingProgressEntry,
    type NotificationEntry,
  } from "$lib/stores.svelte";

  const SNACKBAR_BOTTOM_GAP = 20;

  let now = $state(Date.now());
  const timers = new Map<number, { timer: number; createdAt: number }>();
  let expandedIds = $state<Set<number>>(new Set());
  let hostEl = $state<HTMLDivElement | null>(null);
  type StackEntry =
    | { kind: "progress"; key: string; createdAt: number; entry: FloatingProgressEntry }
    | { kind: "notification"; key: string; createdAt: number; entry: NotificationEntry };

  const stackEntries = $derived<StackEntry[]>(
    [
      ...floatingProgressStore.entries.map((entry) => ({
        kind: "progress" as const,
        key: `progress:${entry.id}`,
        createdAt: entry.createdAt,
        entry,
      })),
      ...notificationStore.entries.map((entry) => ({
        kind: "notification" as const,
        key: `notification:${entry.id}`,
        createdAt: entry.createdAt,
        entry,
      })),
    ].sort((a, b) => b.createdAt - a.createdAt),
  );

  $effect(() => {
    const interval = window.setInterval(() => {
      now = Date.now();
    }, 100);

    return () => {
      window.clearInterval(interval);
    };
  });

  $effect(() => {
    const updateHeight = () => {
      if (stackEntries.length === 0) {
        chromeStore.setSnackbarStackHeight(0);
        return;
      }

      const rect = hostEl?.getBoundingClientRect();
      const height = (rect?.height ?? 0) + SNACKBAR_BOTTOM_GAP;

      chromeStore.setSnackbarStackHeight(height);
    };

    if (!hostEl || typeof ResizeObserver === "undefined") {
      chromeStore.setSnackbarStackHeight(
        stackEntries.length > 0 ? 96 : 0,
      );
      return;
    }

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(hostEl);

    return () => {
      observer.disconnect();
    };
  });

  $effect(() => {
    const activeIds = new Set(
      notificationStore.entries.map((entry) => entry.id),
    );

    for (const [id, timerState] of timers) {
      if (!activeIds.has(id)) {
        window.clearTimeout(timerState.timer);
        timers.delete(id);
      }
    }

    for (const entry of notificationStore.entries) {
      if (entry.timeoutMs === null) continue;

      const existing = timers.get(entry.id);

      if (existing && existing.createdAt === entry.createdAt) continue;

      if (existing) {
        window.clearTimeout(existing.timer);
      }

      const remaining = Math.max(
        0,
        entry.timeoutMs - (Date.now() - entry.createdAt),
      );

      const timer = window.setTimeout(() => {
        notificationStore.remove(entry.id);
        timers.delete(entry.id);
      }, remaining);

      timers.set(entry.id, {
        timer,
        createdAt: entry.createdAt,
      });
    }

    return () => {
      for (const timerState of timers.values()) {
        window.clearTimeout(timerState.timer);
      }

      timers.clear();
    };
  });

  $effect(() => {
    return () => {
      chromeStore.setSnackbarStackHeight(0);
    };
  });

  function progress(entry: NotificationEntry) {
    if (entry.timeoutMs === null) return 1;

    const elapsed = Math.max(0, now - entry.createdAt);

    return Math.max(0, 1 - elapsed / entry.timeoutMs);
  }

  function iconFor(type: NotificationEntry["type"]) {
    if (type === "success") return "checkCircle";
    if (type === "error") return "errorFilled";
    if (type === "warning") return "warningAmber";

    return "info";
  }

  function toneClass(type: NotificationEntry["type"]) {
    if (type === "success") return "snackbar-success";
    if (type === "error") return "snackbar-error";
    if (type === "warning") return "snackbar-warning";

    return "snackbar-info";
  }

  function toggleExpanded(id: number) {
    const next = new Set(expandedIds);

    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    expandedIds = next;
  }

  function remove(id: number) {
    const next = new Set(expandedIds);
    next.delete(id);
    expandedIds = next;

    notificationStore.remove(id);
  }
</script>

<div
  bind:this={hostEl}
  class="pointer-events-none fixed inset-x-0 bottom-5 z-[80] flex flex-col items-center gap-2 px-4"
>
  {#each stackEntries as item (item.key)}
    {#if item.kind === "progress"}
      <div
        class="snackbar snackbar-progress pointer-events-auto relative flex w-full max-w-md items-center gap-4 overflow-hidden rounded-lg px-5 py-4 shadow-2xl"
        role="status"
        transition:snackbarMotion={{ y: 22, duration: 220 }}
      >
        <ProgressRing
          size={34}
          strokeWidth={5}
          class="snackbar-progress-ring"
          label={item.entry.title}
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-base font-bold leading-6">
            {item.entry.title}
          </p>
          <p class="truncate text-sm leading-5 opacity-90">
            {item.entry.text}
          </p>
        </div>
      </div>
    {:else}
      {@const entry = item.entry}
      <div
        class="snackbar pointer-events-auto relative flex w-full max-w-md items-start gap-3 overflow-hidden rounded-lg px-4 py-3 shadow-2xl {toneClass(
          entry.type,
        )}"
        role="status"
        transition:snackbarMotion={{ y: 22, duration: 220 }}
      >
        <span class="mt-0.5 shrink-0">
          <Icon name={iconFor(entry.type)} size="20px" />
        </span>

        <div class="min-w-0 flex-1">
          {#if entry.groupTitle}
            <p class="truncate text-sm font-semibold leading-5">
              {entry.groupTitle}
            </p>
            <p class="text-sm leading-5 opacity-90">{entry.text}</p>
          {:else}
            <p class="text-sm leading-5">{entry.text}</p>
          {/if}

          {#if expandedIds.has(entry.id) && entry.items.length > 1}
            <div
              class="mt-2 max-h-32 space-y-1 overflow-auto rounded-md bg-black/10 p-2"
            >
              {#each entry.items.slice().reverse() as item}
                <p class="truncate text-xs leading-4 opacity-90">{item.text}</p>
              {/each}
            </div>
          {/if}
        </div>

        {#if entry.items.length > 1}
          <button
            class="flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold opacity-85 transition hover:bg-white/10 hover:opacity-100"
            aria-label={expandedIds.has(entry.id)
              ? "Collapse notifications"
              : "Expand notifications"}
            onclick={() => toggleExpanded(entry.id)}
          >
            {entry.items.length}
            <Icon
              name={expandedIds.has(entry.id) ? "expandLess" : "expandMore"}
              size="16px"
            />
          </button>
        {/if}

        <button
          class="shrink-0 rounded-full p-0.5 opacity-75 transition hover:bg-white/10 hover:opacity-100"
          aria-label="Close"
          onclick={() => remove(entry.id)}
        >
          <Icon name="close" size="18px" />
        </button>

        {#if entry.timeoutMs !== null}
          <span class="absolute inset-x-0 bottom-0 h-1 bg-white/12">
            <span
              class="block h-full bg-current opacity-80 transition-[width] duration-100 ease-linear"
              style={`width: ${progress(entry) * 100}%`}
            ></span>
          </span>
        {/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  .snackbar {
    color: white;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    backdrop-filter: blur(18px);
    box-shadow:
      0 18px 56px rgba(0, 0, 0, 0.28),
      0 1px 10px rgba(255, 255, 255, 0.1) inset;
    transform-origin: 50% 100%;
  }

  .snackbar::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(
      120deg,
      rgba(255, 255, 255, 0.22),
      transparent 34%
    );
    opacity: 0.75;
  }

  .snackbar-info {
    background: color-mix(
      in srgb,
      var(--md3-inverse-surface, #313033) 92%,
      transparent
    );
  }

  .snackbar-progress {
    background: color-mix(in srgb, var(--md3-inverse-surface, #313033) 94%, transparent);
  }

  :global(.snackbar-progress-ring) {
    color: #22d3ee;
  }

  .snackbar-success {
    background: color-mix(in srgb, #166534 88%, transparent);
  }

  .snackbar-warning {
    background: color-mix(in srgb, #8a4b0f 90%, transparent);
  }

  .snackbar-error {
    background: color-mix(in srgb, var(--md3-error, #ba1a1a) 90%, #1b1b1f);
  }
</style>
