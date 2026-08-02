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
  import { appLockStore } from '$lib/app-lock.svelte';
  import DialogActionButton from '$lib/components/DialogActionButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';

  let currentTime = $state('');
  let busyAction = $state<'quit' | 'disconnect' | 'logout' | null>(null);
  const lockdownReason = $derived(serverStateStore.lockdownReason?.trim() ?? '');

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

  function handleAppLock() {
    appLockStore.lock();
  }

  function formatError(err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
</script>

<main
  class="lockdown-shell workspace-palette"
  aria-labelledby="lockdown-title"
  aria-describedby="lockdown-description"
>
  {#if authStore.isLoggedIn && appLockStore.canLock}
    <div class="lockdown-toolbar">
      <IconButton
        icon="lock"
        label={$t('appLock.lockNow')}
        onclick={handleAppLock}
      />
    </div>
  {/if}

  <section class="lockdown-panel">
    <header class="lockdown-header">
      <span class="lockdown-symbol" aria-hidden="true">
        <Icon name="emergencyHome" size="56px" />
      </span>

      <div class="lockdown-heading-copy">
        <div class="lockdown-title-row">
          <h1 id="lockdown-title">{$t('lockdown.title')}</h1>
          <time class="lockdown-clock">{currentTime || '--:--:--'}</time>
        </div>

        <p id="lockdown-description" class="lockdown-description">
          {$t('lockdown.body')}
        </p>
      </div>
    </header>

    {#if !authStore.isLoggedIn}
      <p
        class="lockdown-session-note"
        role="status"
      >
        {$t('lockdown.signInIncomplete')}
      </p>
    {/if}

    {#if lockdownReason}
      <aside class="lockdown-reason" role="note" aria-labelledby="lockdown-reason-label">
        <p id="lockdown-reason-label" class="lockdown-reason-label">
          {$t('lockdown.reasonLabel')}
        </p>
        <p class="lockdown-reason-copy">
          {lockdownReason}
        </p>
      </aside>
    {/if}

    <footer class="lockdown-footer">
      <p class="lockdown-wait-copy">
        {$t('lockdown.wait')}
      </p>
      <div
        class="lockdown-action-grid"
        class:lockdown-action-grid--signed-out={!authStore.isLoggedIn}
      >
        {#if authStore.isLoggedIn}
          <DialogActionButton
            class="lockdown-action-button"
            variant="secondary"
            onclick={handleLogout}
            disabled={busyAction !== null || !serverStateStore.connected}
          >
            {#if busyAction === 'logout'}
              <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
            {:else}
              <Icon name="logout" size="18px" />
            {/if}
            {$t('lockdown.logout')}
          </DialogActionButton>
        {/if}
        <DialogActionButton
          class="lockdown-action-button"
          variant="primary"
          onclick={handleDisconnect}
          disabled={busyAction !== null}
        >
          {#if busyAction === 'disconnect'}
            <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {:else}
            <Icon name="connect" size="18px" />
          {/if}
          {$t('lockdown.disconnect')}
        </DialogActionButton>
        <DialogActionButton
          class="lockdown-action-button"
          variant="danger"
          onclick={handleQuit}
          disabled={busyAction !== null}
        >
          {#if busyAction === 'quit'}
            <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {:else}
            <Icon name="close" size="18px" />
          {/if}
          {$t('lockdown.quit')}
        </DialogActionButton>
      </div>
      <p class="lockdown-quit-hint">
        {$t('lockdown.quitHint')}
      </p>
    </footer>
  </section>
</main>

<style>
  .lockdown-shell {
    position: fixed;
    z-index: 50;
    inset: 0;
    box-sizing: border-box;
    display: grid;
    min-block-size: 100dvh;
    place-items: center;
    overflow: auto;
    padding-block-start: calc(var(--safe-area-top, 0px) + 4.75rem);
    padding-block-end: calc(var(--safe-area-bottom, 0px) + 2rem);
    padding-inline-start: max(1.25rem, var(--safe-area-left, 0px));
    padding-inline-end: max(1.25rem, var(--safe-area-right, 0px));
    background: var(--explorer-background);
  }

  .lockdown-toolbar {
    position: fixed;
    z-index: 55;
    inset-block-start: calc(var(--safe-area-top, 0px) + 1rem);
    inset-inline-end: max(1rem, var(--safe-area-right, 0px));
    display: flex;
    min-block-size: 2.5rem;
    align-items: center;
  }

  .lockdown-toolbar :global(.md-icon-button) {
    inline-size: 40px;
    block-size: 40px;
  }

  .lockdown-panel {
    box-sizing: border-box;
    inline-size: min(100%, 580px);
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-large);
    padding: clamp(1.25rem, 3vw, 2rem);
    color: var(--explorer-text);
    background: var(--explorer-surface);
    animation: lockdown-enter var(--motion-duration-medium2)
      var(--motion-easing-emphasized-decelerate) both;
  }

  .lockdown-header {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: 1.25rem;
  }

  .lockdown-symbol {
    display: inline-flex;
    inline-size: 72px;
    block-size: 72px;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--explorer-danger) 32%, transparent);
    border-radius: var(--explorer-radius-large);
    color: var(--explorer-danger);
    background: color-mix(in srgb, var(--explorer-danger) 10%, transparent);
  }

  .lockdown-heading-copy {
    min-inline-size: 0;
  }

  .lockdown-title-row {
    display: flex;
    min-block-size: 2rem;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }

  .lockdown-title-row h1 {
    margin: 0;
    color: var(--explorer-text);
    font: 700 clamp(1.45rem, 4vw, 2rem)/1.15 var(--font-md3-sans);
    letter-spacing: -0.025em;
  }

  .lockdown-clock {
    flex: none;
    color: var(--explorer-text-muted);
    font: 500 0.8rem/1.5 var(--font-md3-mono);
    font-variant-numeric: tabular-nums;
  }

  .lockdown-description {
    max-inline-size: 68ch;
    margin: 0.6rem 0 0;
    color: var(--explorer-text-muted);
    font: 400 0.875rem/1.6 var(--font-md3-sans);
  }

  .lockdown-session-note {
    margin: 1.25rem 0 0;
    border: 1px solid color-mix(in srgb, var(--explorer-warning) 30%, transparent);
    border-radius: var(--explorer-radius-medium);
    padding: 0.75rem 0.875rem;
    color: var(--explorer-warning);
    background: color-mix(in srgb, var(--explorer-warning) 8%, transparent);
    font: 500 0.8125rem/1.55 var(--font-md3-sans);
  }

  .lockdown-reason {
    margin-block-start: 1.25rem;
    border: 1px solid color-mix(in srgb, var(--explorer-danger) 28%, var(--explorer-border));
    border-radius: var(--explorer-radius-medium);
    padding: 0.875rem 1rem;
    background: color-mix(in srgb, var(--explorer-danger) 7%, var(--explorer-surface-raised));
  }

  .lockdown-reason-label {
    margin: 0 0 0.35rem;
    color: var(--explorer-danger);
    font: 650 0.75rem/1.25 var(--font-md3-sans);
    letter-spacing: 0.025em;
  }

  .lockdown-reason-copy {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    color: var(--explorer-text);
    font: 400 0.875rem/1.6 var(--font-md3-sans);
  }

  .lockdown-footer {
    margin-block-start: 1.5rem;
    border-block-start: 1px solid var(--explorer-border);
    padding-block-start: 1.25rem;
  }

  .lockdown-wait-copy {
    margin: 0 0 0.75rem;
    color: var(--explorer-text-muted);
    font: 500 0.75rem/1.4 var(--font-md3-sans);
  }

  .lockdown-action-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.625rem;
  }

  .lockdown-action-grid--signed-out {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .lockdown-action-grid :global(.lockdown-action-button) {
    min-block-size: 40px;
    inline-size: 100%;
  }

  .lockdown-quit-hint {
    margin: 0.75rem 0 0;
    color: var(--explorer-text-muted);
    font: 400 0.75rem/1.5 var(--font-md3-sans);
  }

  @keyframes lockdown-enter {
    from {
      opacity: 0.82;
      transform: translateY(8px);
      filter: blur(3px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
      filter: blur(0);
    }
  }

  @media (pointer: coarse) {
    .lockdown-toolbar :global(.md-icon-button) {
      inline-size: 44px;
      block-size: 44px;
    }

    .lockdown-action-grid :global(.lockdown-action-button) {
      min-block-size: 44px;
    }
  }

  @media (max-width: 520px) {
    .lockdown-shell {
      padding-block-start: calc(var(--safe-area-top, 0px) + 4.25rem);
      padding-block-end: calc(var(--safe-area-bottom, 0px) + 1.25rem);
      padding-inline-start: max(0.875rem, var(--safe-area-left, 0px));
      padding-inline-end: max(0.875rem, var(--safe-area-right, 0px));
    }

    .lockdown-panel {
      padding: 1.25rem;
    }

    .lockdown-header {
      grid-template-columns: 1fr;
      justify-items: center;
      gap: 1rem;
      text-align: center;
    }

    .lockdown-symbol {
      inline-size: 64px;
      block-size: 64px;
    }

    .lockdown-title-row {
      flex-direction: column;
      align-items: center;
      gap: 0.35rem;
    }

    .lockdown-description {
      margin-block-start: 0.75rem;
    }

    .lockdown-action-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-height: 640px) and (min-width: 521px) {
    .lockdown-shell {
      place-items: start center;
      padding-block-start: calc(var(--safe-area-top, 0px) + 4.25rem);
      padding-block-end: calc(var(--safe-area-bottom, 0px) + 1.25rem);
    }

    .lockdown-panel {
      padding-block: 1.25rem;
    }
  }
</style>
