<!--
  THESIS: Time anchors lockdown; the screen refuses the generic centered alert card.
  OWN-WORLD: Carbon fields, one rose security signal, exact rules, and compact controls.
  STORY: See the suspended state, read its reason, then wait or leave safely.
  FIRST VIEWPORT: A monumental clock and slim status line float above one lower operations shelf.
  FORM: Time Horizon, grounded structure 3, approved lower-shelf staging; seed 7ec1ca98.
-->
<script lang="ts">
  // Lockdown screen
  //
  // Full-screen overlay shown when the server is in emergency lockdown mode.
  // Suspends file interaction while keeping session-exit and app-lock actions available.
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

  <section class="lockdown-stage">
    <div class="lockdown-hero">
      <time
        class="lockdown-clock"
        datetime={currentTime || undefined}
      >
        {currentTime || '--:--:--'}
      </time>

      <header class="lockdown-status-line">
        <span class="lockdown-symbol" aria-hidden="true">
          <Icon name="emergencyHome" size="24px" />
        </span>
        <div class="lockdown-status-copy">
          <h1 id="lockdown-title">{$t('lockdown.title')}</h1>
          <p id="lockdown-description" class="lockdown-description">
            {$t('lockdown.body')}
          </p>
        </div>
      </header>
    </div>

    <footer
      class="lockdown-shelf"
      class:lockdown-shelf--single={authStore.isLoggedIn && !lockdownReason}
    >
      {#if !authStore.isLoggedIn || lockdownReason}
        <div class="lockdown-context">
          {#if lockdownReason}
            <aside class="lockdown-reason" role="note" aria-labelledby="lockdown-reason-label">
              <p id="lockdown-reason-label" class="lockdown-context-label">
                {$t('lockdown.reasonLabel')}
              </p>
              <p class="lockdown-context-copy">
                {lockdownReason}
              </p>
            </aside>
          {/if}

          {#if !authStore.isLoggedIn}
            <div class="lockdown-session-note" role="status">
              <span class="lockdown-detail-icon" aria-hidden="true">
                <Icon name="warningAmber" size="20px" />
              </span>
              <p class="lockdown-context-copy">{$t('lockdown.signInIncomplete')}</p>
            </div>
          {/if}
        </div>
      {/if}

      <div class="lockdown-operations">
        <div class="lockdown-action-copy">
          <p class="lockdown-wait-copy">{$t('lockdown.wait')}</p>
          <p class="lockdown-quit-hint">{$t('lockdown.quitHint')}</p>
        </div>

        <div
          class="lockdown-actions"
          class:lockdown-actions--signed-out={!authStore.isLoggedIn}
        >
          <DialogActionButton
            class="lockdown-action-button lockdown-action-button--primary"
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
            class="lockdown-action-button lockdown-action-button--quit"
            variant="secondary"
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
      </div>
    </footer>
  </section>
</main>

<style>
  .lockdown-shell {
    position: fixed;
    z-index: 50;
    inset: 0;
    box-sizing: border-box;
    display: flex;
    min-block-size: 100dvh;
    flex-direction: column;
    overflow: auto;
    padding-block-start: calc(var(--safe-area-top, 0px) + 4.25rem);
    padding-block-end: max(1.25rem, var(--safe-area-bottom, 0px));
    padding-inline-start: max(1.5rem, var(--safe-area-left, 0px));
    padding-inline-end: max(1.5rem, var(--safe-area-right, 0px));
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

  .lockdown-stage {
    box-sizing: border-box;
    display: grid;
    grid-template-rows: minmax(18rem, 1fr) auto;
    inline-size: min(100%, 1180px);
    min-block-size: calc(100dvh - 6.75rem);
    flex: none;
    margin: auto;
    color: var(--explorer-text);
    animation: lockdown-enter var(--motion-duration-medium2)
      var(--motion-easing-emphasized-decelerate) both;
  }

  .lockdown-hero {
    display: grid;
    min-inline-size: 0;
    place-content: center;
    padding: clamp(2.25rem, 7vh, 5rem) clamp(0rem, 2vw, 1.5rem)
      clamp(2.25rem, 5vh, 3.75rem);
    text-align: center;
  }

  .lockdown-clock {
    color: var(--explorer-text);
    font: 600 clamp(4rem, 11vw, 6rem)/1 var(--font-md3-mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    text-wrap: nowrap;
  }

  .lockdown-status-line {
    display: flex;
    max-inline-size: 850px;
    align-items: center;
    justify-content: center;
    gap: 0.85rem;
    margin: clamp(1.75rem, 4vh, 2.75rem) auto 0;
  }

  .lockdown-symbol {
    display: inline-flex;
    inline-size: 32px;
    block-size: 32px;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--explorer-danger) 46%, transparent);
    border-radius: var(--explorer-radius-small);
    color: var(--explorer-danger);
    background: color-mix(in srgb, var(--explorer-danger) 9%, transparent);
  }

  .lockdown-status-copy {
    display: flex;
    min-inline-size: 0;
    align-items: center;
    text-align: start;
  }

  .lockdown-status-copy h1 {
    flex: none;
    margin: 0;
    border-inline-end: 1px solid var(--explorer-border-strong);
    padding-inline-end: 1rem;
    color: var(--explorer-danger);
    font: 700 1.0625rem/1.3 var(--font-md3-sans);
    letter-spacing: -0.015em;
  }

  .lockdown-description {
    max-inline-size: 68ch;
    margin: 0;
    padding-inline-start: 1rem;
    color: var(--explorer-text-muted);
    font: 400 0.8125rem/1.55 var(--font-md3-sans);
  }

  .lockdown-shelf {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(30rem, 0.95fr);
    border-block-start: 1px solid var(--explorer-border-strong);
    border-radius: var(--explorer-radius-large) var(--explorer-radius-large) 0 0;
    background: var(--explorer-surface);
  }

  .lockdown-shelf--single {
    grid-template-columns: 1fr;
  }

  .lockdown-context {
    display: grid;
    min-inline-size: 0;
    align-content: center;
    padding: clamp(1.25rem, 2.5vw, 1.75rem);
  }

  .lockdown-context > :global(* + *) {
    margin-block-start: 1rem;
    border-block-start: 1px solid var(--explorer-border);
    padding-block-start: 1rem;
  }

  .lockdown-reason {
    min-inline-size: 0;
  }

  .lockdown-context-label {
    margin: 0 0 0.55rem;
    color: var(--explorer-text-muted);
    font: 600 0.75rem/1.3 var(--font-md3-sans);
  }

  .lockdown-context-copy {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    color: var(--explorer-text);
    font: 400 0.875rem/1.6 var(--font-md3-sans);
  }

  .lockdown-session-note {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    align-items: start;
    gap: 0.75rem;
  }

  .lockdown-detail-icon {
    display: inline-flex;
    color: var(--explorer-warning);
  }

  .lockdown-operations {
    display: grid;
    min-inline-size: 0;
    align-content: center;
    gap: 1.1rem;
    border-inline-start: 1px solid var(--explorer-border);
    padding: clamp(1.25rem, 2.5vw, 1.75rem);
  }

  .lockdown-shelf--single .lockdown-operations {
    inline-size: min(100%, 48rem);
    justify-self: end;
    border-inline-start: 0;
  }

  .lockdown-action-copy {
    min-inline-size: 0;
  }

  .lockdown-wait-copy {
    margin: 0;
    color: var(--explorer-text);
    font: 600 0.8125rem/1.45 var(--font-md3-sans);
  }

  .lockdown-quit-hint {
    max-inline-size: 66ch;
    margin: 0.4rem 0 0;
    color: var(--explorer-text-muted);
    font: 400 0.75rem/1.5 var(--font-md3-sans);
  }

  .lockdown-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.625rem;
  }

  .lockdown-actions--signed-out {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .lockdown-actions :global(.lockdown-action-button) {
    min-block-size: 40px;
    inline-size: 100%;
  }

  .lockdown-actions :global(.lockdown-action-button--quit) {
    border-color: color-mix(in srgb, var(--explorer-danger) 32%, var(--explorer-border));
    color: var(--explorer-danger);
  }

  .lockdown-actions :global(.lockdown-action-button--quit:hover:not(:disabled)) {
    border-color: color-mix(in srgb, var(--explorer-danger) 54%, var(--explorer-border));
    color: var(--explorer-danger);
    background: color-mix(in srgb, var(--explorer-danger) 8%, transparent);
  }

  @keyframes lockdown-enter {
    from {
      opacity: 0.82;
      transform: translateY(8px);
      clip-path: inset(0 0 4% 0 round var(--explorer-radius-large));
    }

    to {
      opacity: 1;
      transform: translateY(0);
      clip-path: inset(0 0 0 0 round var(--explorer-radius-large));
    }
  }

  @media (pointer: coarse) {
    .lockdown-toolbar :global(.md-icon-button) {
      inline-size: 44px;
      block-size: 44px;
    }

    .lockdown-actions :global(.lockdown-action-button) {
      min-block-size: 44px;
    }
  }

  @media (max-width: 820px) {
    .lockdown-stage {
      grid-template-rows: auto auto;
    }

    .lockdown-shelf {
      grid-template-columns: 1fr;
    }

    .lockdown-operations {
      border-block-start: 1px solid var(--explorer-border);
      border-inline-start: 0;
    }

    .lockdown-shelf--single .lockdown-operations {
      inline-size: 100%;
    }
  }

  @media (max-width: 620px) {
    .lockdown-shell {
      padding-block-start: calc(var(--safe-area-top, 0px) + 4.25rem);
      padding-block-end: max(0.875rem, var(--safe-area-bottom, 0px));
      padding-inline-start: max(0.875rem, var(--safe-area-left, 0px));
      padding-inline-end: max(0.875rem, var(--safe-area-right, 0px));
    }

    .lockdown-stage {
      min-block-size: calc(100dvh - 5.125rem);
    }

    .lockdown-hero {
      padding-block-start: 2.25rem;
      padding-block-end: 2rem;
    }

    .lockdown-clock {
      font-size: clamp(3rem, 15vw, 4.5rem);
    }

    .lockdown-status-line {
      max-inline-size: 31rem;
      align-items: start;
      margin-block-start: 1.75rem;
    }

    .lockdown-status-copy {
      display: grid;
      gap: 0.4rem;
    }

    .lockdown-status-copy h1 {
      border-inline-end: 0;
      padding-inline-end: 0;
    }

    .lockdown-description {
      padding-inline-start: 0;
    }

    .lockdown-context,
    .lockdown-operations {
      padding: 1.25rem;
    }
  }

  @media (max-width: 480px) {
    .lockdown-actions {
      grid-template-columns: 1fr;
    }

    .lockdown-actions--signed-out {
      grid-template-columns: 1fr;
    }
  }

  @media (max-height: 640px) and (min-width: 821px) {
    .lockdown-stage {
      grid-template-rows: minmax(14rem, 1fr) auto;
    }

    .lockdown-hero {
      padding-block: 1.75rem;
    }

    .lockdown-clock {
      font-size: clamp(3.75rem, 10vw, 5rem);
    }

    .lockdown-status-line {
      margin-block-start: 1.5rem;
    }
  }
</style>
