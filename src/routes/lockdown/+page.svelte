<script lang="ts">
  // Lockdown screen
  //
  // Full-screen overlay shown when the server is in emergency lockdown mode.
  // Prevents all interaction except quitting the application.
  //
  // Reference: LockdownModel in reference/src/include/ui/models/misc/lockdown.py

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    clearAuthSession,
    disconnect,
    quitApplication,
  } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';

  let currentTime = $state('');
  let busyAction = $state<'quit' | 'disconnect' | 'logout' | null>(null);

  let timerInterval: ReturnType<typeof setInterval> | null = null;

  function updateClock() {
    const now = new Date();
    currentTime = now.toLocaleTimeString('en-US', { hour12: false });
  }

  onMount(() => {
    updateClock();
    timerInterval = setInterval(updateClock, 500);
    return () => {
      if (timerInterval) clearInterval(timerInterval);
    };
  });

  async function runLockdownAction(
    action: 'quit' | 'disconnect' | 'logout',
    handler: () => Promise<void>,
  ) {
    if (busyAction) return;
    busyAction = action;
    try {
      await handler();
    } catch (err) {
      notificationStore.error(formatError(err), 6000);
    } finally {
      busyAction = null;
    }
  }

  async function handleQuit() {
    await runLockdownAction('quit', async () => {
      await quitApplication();
      window.close();
    });
  }

  async function handleDisconnect() {
    await runLockdownAction('disconnect', async () => {
      await disconnect();
      await clearAuthSession();
      authStore.clear();
      serverStateStore.clear();
      await goto('/connect', { replaceState: true });
    });
  }

  async function handleLogout() {
    await runLockdownAction('logout', async () => {
      await clearAuthSession();
      authStore.clear();
      await goto('/login', { replaceState: true });
    });
  }

  function formatError(err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-md3-surface p-5">
  <div class="w-full max-w-[520px] space-y-6 py-8 text-center">
    <div class="flex justify-center">
      <span class="rounded-full bg-md3-error-container p-5 text-md3-on-error-container shadow-lg shadow-black/10">
        <Icon name="emergencyHome" size="56px" />
      </span>
    </div>

    <h1
      class="text-2xl font-bold text-md3-on-surface"
      style="font-family: var(--font-md3-sans);"
    >
      {$t('lockdown.title')}
    </h1>

    <p class="text-sm text-md3-on-surface-variant leading-relaxed">
      {$t('lockdown.body')}
    </p>

    <!-- Live clock -->
    <div
      class="text-3xl font-mono text-md3-on-surface"
      style="font-family: var(--font-md3-mono);"
    >
      {currentTime || '--:--:--'}
    </div>

    <div class="border-t border-md3-outline pt-5">
      <p class="text-xs text-md3-on-surface-variant mb-4">
        {$t('lockdown.wait')}
      </p>
      <div class="grid gap-2 sm:grid-cols-3">
        <button
          class="lockdown-action lockdown-action--danger"
          style="font-family: var(--font-md3-sans);"
          onclick={handleQuit}
          disabled={busyAction !== null}
        >
          {#if busyAction === 'quit'}
            <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {:else}
            <Icon name="close" size="18px" />
          {/if}
          {$t('lockdown.quit')}
        </button>
        <button
          class="lockdown-action"
          style="font-family: var(--font-md3-sans);"
          onclick={handleDisconnect}
          disabled={busyAction !== null}
        >
          {#if busyAction === 'disconnect'}
            <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {:else}
            <Icon name="connect" size="18px" />
          {/if}
          {$t('lockdown.disconnect')}
        </button>
        <button
          class="lockdown-action"
          style="font-family: var(--font-md3-sans);"
          onclick={handleLogout}
          disabled={busyAction !== null || !serverStateStore.connected}
        >
          {#if busyAction === 'logout'}
            <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {:else}
            <Icon name="logout" size="18px" />
          {/if}
          {$t('lockdown.logout')}
        </button>
      </div>
      <p class="mt-3 text-xs leading-relaxed text-md3-on-surface-variant">
        {$t('lockdown.quitHint')}
      </p>
    </div>
  </div>
</div>

<style>
  .lockdown-action {
    display: inline-flex;
    min-block-size: 44px;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: 9999px;
    padding: 0.625rem 0.875rem;
    color: var(--color-md3-on-surface);
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 72%, transparent);
    font-size: 0.8125rem;
    font-weight: 600;
    transition:
      background var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .lockdown-action:hover:not(:disabled) {
    background: var(--color-md3-surface-container-highest);
    transform: translateY(-1px);
  }

  .lockdown-action:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .lockdown-action--danger {
    border-color: var(--color-md3-error);
    color: var(--color-md3-error);
    background: color-mix(in srgb, var(--color-md3-error-container) 55%, transparent);
  }
</style>
