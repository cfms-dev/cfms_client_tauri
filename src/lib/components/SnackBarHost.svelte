<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import { notificationStore, type NotificationEntry } from '$lib/stores.svelte';

  let now = $state(Date.now());
  const timers = new Map<number, number>();

  $effect(() => {
    const interval = window.setInterval(() => {
      now = Date.now();
    }, 100);
    return () => window.clearInterval(interval);
  });

  $effect(() => {
    const activeIds = new Set(notificationStore.entries.map((entry) => entry.id));
    for (const [id, timer] of timers) {
      if (!activeIds.has(id)) {
        window.clearTimeout(timer);
        timers.delete(id);
      }
    }

    for (const entry of notificationStore.entries) {
      if (entry.timeoutMs === null || timers.has(entry.id)) continue;
      const remaining = Math.max(0, entry.timeoutMs - (Date.now() - entry.createdAt));
      const timer = window.setTimeout(() => {
        notificationStore.remove(entry.id);
        timers.delete(entry.id);
      }, remaining);
      timers.set(entry.id, timer);
    }

    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  });

  function progress(entry: NotificationEntry) {
    if (entry.timeoutMs === null) return 1;
    const elapsed = Math.max(0, now - entry.createdAt);
    return Math.max(0, 1 - elapsed / entry.timeoutMs);
  }

  function iconFor(type: NotificationEntry['type']) {
    if (type === 'success') return 'checkCircle';
    if (type === 'error') return 'errorFilled';
    if (type === 'warning') return 'warningAmber';
    return 'info';
  }

  function toneClass(type: NotificationEntry['type']) {
    if (type === 'success') return 'snackbar-success';
    if (type === 'error') return 'snackbar-error';
    if (type === 'warning') return 'snackbar-warning';
    return 'snackbar-info';
  }
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-5 z-[80] flex flex-col items-center gap-2 px-4">
  {#each notificationStore.entries as entry (entry.id)}
    <div
      class="snackbar pointer-events-auto relative flex w-full max-w-md items-start gap-3 overflow-hidden rounded-lg px-4 py-3 shadow-2xl {toneClass(entry.type)}"
      role="status"
    >
      <span class="mt-0.5 shrink-0">
        <Icon name={iconFor(entry.type)} size="20px" />
      </span>
      <p class="min-w-0 flex-1 text-sm leading-5">{entry.text}</p>
      <button
        class="shrink-0 rounded-full p-0.5 opacity-75 transition hover:bg-white/10 hover:opacity-100"
        aria-label="Close"
        onclick={() => notificationStore.remove(entry.id)}
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
  {/each}
</div>

<style>
  .snackbar {
    color: white;
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    backdrop-filter: blur(18px);
  }

  .snackbar-info {
    background: color-mix(in srgb, var(--md3-inverse-surface, #313033) 92%, transparent);
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
