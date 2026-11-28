<!--
  THESIS: Time anchors lockdown; the screen refuses the generic centered alert card.
  OWN-WORLD: Fluent 2 neutral canvas (Mica-ready), one rose security signal, exact rules, and structured controls.
  STORY: See the suspended state and live link status, understand session posture and reason, then wait or leave safely.
  FIRST VIEWPORT: Live connection strip, monumental 24-hour clock, and slim rose register above one lower operations shelf.
  FORM: Time Horizon, grounded structure 3, refined lower-shelf staging; seed 7ec1ca98.
-->
<script lang="ts">
  // Lockdown screen
  //
  // Full-screen overlay shown when the server is in emergency lockdown mode.
  // Suspends file interaction while surfacing accurate session posture,
  // live connection status, and safe exit or account-switching paths.
  //
  // Reference: LockdownModel in reference/src/include/ui/models/misc/lockdown.py

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    clearAuthSession,
    disconnect,
    quitApplication,
  } from '#lib/api.ts';
  import { authStore } from '#lib/features/authentication/auth-state.svelte.ts';
  import { serverStateStore } from '#lib/features/connection/connection-state.svelte.ts';
  import { appLockStore } from '#lib/features/settings/app-lock.svelte.ts';
  import { formatUserFacingError } from '#lib/shared/errors/user-facing-errors.ts';
  import { notificationStore } from '#lib/shared/notifications/notifications.svelte.ts';
  import { isMobilePlatform } from '#lib/shared/platform/platform.ts';
  import FluentButton from '#lib/shared/ui/FluentButton.svelte';
  import Icon from '#lib/shared/ui/Icon.svelte';
  import ProgressRing from '#lib/shared/ui/ProgressRing.svelte';

  type LockdownAction = 'quit' | 'disconnect' | 'logout' | 'backToSignIn';

  let currentTime = $state('');
  let busyAction = $state<LockdownAction | null>(null);

  const showMobileQuitHint = isMobilePlatform();
  const lockdownReason = $derived(serverStateStore.lockdownReason?.trim() ?? '');
  const sessionStatusTitle = $derived(
    authStore.isLoggedIn
      ? $t('lockdown.sessionSuspendedTitle')
      : $t('lockdown.sessionNotKeptTitle'),
  );
  const sessionStatusBody = $derived(
    authStore.isLoggedIn
      ? appLockStore.canLock
        ? $t('lockdown.sessionSuspendedBodyWithAppLock')
        : $t('lockdown.sessionSuspendedBody')
      : $t('lockdown.sessionNotKeptBody'),
  );
  const waitGuidance = $derived(
    serverStateStore.connected
      ? $t('lockdown.wait')
      : $t('lockdown.connectionLostWait'),
  );
  const mobileQuitHint = $derived(
    authStore.isLoggedIn
      ? $t('lockdown.quitHint')
      : $t('lockdown.quitHintSignedOut'),
  );

  const clockFormatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let clockTimer: ReturnType<typeof setTimeout> | null = null;

  function updateClock() {
    currentTime = clockFormatter.format(new Date());
  }

  function scheduleClockUpdate() {
    updateClock();
    const millisecondsUntilNextSecond = 1000 - (Date.now() % 1000);
    clockTimer = setTimeout(scheduleClockUpdate, millisecondsUntilNextSecond + 16);
  }

  function resyncClock() {
    if (clockTimer !== null) clearTimeout(clockTimer);
    scheduleClockUpdate();
  }

  onMount(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') resyncClock();
    };

    resyncClock();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', resyncClock);

    return () => {
      if (clockTimer !== null) clearTimeout(clockTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', resyncClock);
    };
  });

  async function runLockdownAction(
    action: LockdownAction,
    handler: () => Promise<void>,
  ) {
    if (busyAction) return;
    busyAction = action;
    try {
      await handler();
    } catch (err) {
      notificationStore.error(formatUserFacingError(err), 6000);
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
    if (!serverStateStore.connected) return;
    await runLockdownAction('logout', async () => {
      await clearAuthSession();
      authStore.clear();
      await goto('/login', { replaceState: true });
    });
  }

  async function handleReturnToLogin() {
    if (!serverStateStore.connected) return;
    await runLockdownAction('backToSignIn', async () => {
      await clearAuthSession();
      authStore.clear();
      await goto('/login', { replaceState: true });
    });
  }

  function handleAppLock() {
    appLockStore.lock();
  }
</script>

<main
  class="lockdown-shell workspace-palette"
  aria-labelledby="lockdown-title"
  aria-describedby="lockdown-description"
>
  <section class="lockdown-stage">
    <div class="lockdown-topbar">
      <div
        class="lockdown-connection-status"
        class:lockdown-connection-status--lost={!serverStateStore.connected}
      >
        <span class="cfms-icon-text__icon lockdown-connection-icon" aria-hidden="true">
          <Icon
            name={serverStateStore.connected ? 'cellularData1' : 'cellularOff'}
            size="16px"
          />
        </span>
        <span>
          {serverStateStore.connected
            ? $t('lockdown.connectionConnected')
            : $t('lockdown.connectionLost')}
        </span>
      </div>

      {#if authStore.isLoggedIn && appLockStore.canLock}
        <FluentButton
          data-fluent-owner="app-authentication-lockdown-page"
          class="lockdown-applock-button"
          appearance="subtle"
          onclick={handleAppLock}
        >
          <Icon name="lock" size="16px" />
          {$t('appLock.lockNow')}
        </FluentButton>
      {/if}
    </div>

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

    <footer class="lockdown-shelf">
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

        <div
          class="lockdown-session-note"
          class:lockdown-session-note--warning={!authStore.isLoggedIn}
          role="status"
        >
          <span class="cfms-icon-text__icon lockdown-detail-icon" aria-hidden="true">
            {#if authStore.isLoggedIn}
              <Icon name="pauseCircle" size="20px" />
            {:else}
              <Icon name="warningAmber" size="20px" tone="warning" />
            {/if}
          </span>
          <div class="lockdown-session-copy">
            <p class="lockdown-session-title">{sessionStatusTitle}</p>
            <p class="lockdown-context-copy lockdown-session-body">{sessionStatusBody}</p>
          </div>
        </div>
      </div>

      <div class="lockdown-operations">
        <div class="lockdown-action-copy">
          <p
            class="lockdown-wait-copy"
            class:lockdown-wait-copy--lost={!serverStateStore.connected}
          >
            {waitGuidance}
          </p>
          {#if showMobileQuitHint}
            <p class="lockdown-quit-hint">{mobileQuitHint}</p>
          {/if}
        </div>

        <div class="lockdown-actions">
          <FluentButton
            data-fluent-owner="app-authentication-lockdown-page"
            class="lockdown-action-button"
            appearance="primary"
            onclick={handleDisconnect}
            disabled={busyAction !== null}
          >
            {#if busyAction === 'disconnect'}
              <ProgressRing size={16} strokeWidth={2.25} label={$t('common.loadingEllipsis')} />
            {:else}
              <Icon name="linkOff" size="16px" />
            {/if}
            {$t('lockdown.disconnect')}
          </FluentButton>

          {#if authStore.isLoggedIn}
            <FluentButton
              data-fluent-owner="app-authentication-lockdown-page"
              class="lockdown-action-button"
              appearance="outline"
              onclick={handleLogout}
              disabled={busyAction !== null || !serverStateStore.connected}
            >
              {#if busyAction === 'logout'}
                <ProgressRing size={16} strokeWidth={2.25} label={$t('common.loadingEllipsis')} />
              {:else}
                <Icon name="logout" size="16px" />
              {/if}
              {$t('lockdown.logout')}
            </FluentButton>
          {:else}
            <FluentButton
              data-fluent-owner="app-authentication-lockdown-page"
              class="lockdown-action-button"
              appearance="outline"
              onclick={handleReturnToLogin}
              disabled={busyAction !== null || !serverStateStore.connected}
            >
              {#if busyAction === 'backToSignIn'}
                <ProgressRing size={16} strokeWidth={2.25} label={$t('common.loadingEllipsis')} />
              {:else}
                <Icon name="arrowBack" size="16px" />
              {/if}
              {$t('lockdown.backToSignIn')}
            </FluentButton>
          {/if}

          <FluentButton
            data-fluent-owner="app-authentication-lockdown-page"
            class="lockdown-action-button"
            appearance="subtle"
            tone="danger"
            onclick={handleQuit}
            disabled={busyAction !== null}
          >
            {#if busyAction === 'quit'}
              <ProgressRing size={16} strokeWidth={2.25} label={$t('common.loadingEllipsis')} />
            {:else}
              <Icon name="close" size="16px" />
            {/if}
            {$t('lockdown.quit')}
          </FluentButton>
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
    padding-block-start: max(1.25rem, var(--safe-area-top, 0px));
    padding-block-end: max(1.5rem, var(--safe-area-bottom, 0px));
    padding-inline-start: max(1.5rem, var(--safe-area-left, 0px));
    padding-inline-end: max(1.5rem, var(--safe-area-right, 0px));
  }

  .lockdown-stage {
    box-sizing: border-box;
    display: grid;
    grid-template-rows: auto minmax(15rem, 1fr) auto;
    inline-size: min(100%, 1180px);
    min-block-size: 100%;
    flex: 1 0 auto;
    margin-inline: auto;
    color: var(--colorNeutralForeground1);
    animation: lockdown-enter var(--motion-duration-medium2)
      var(--motion-easing-emphasized-decelerate) both;
  }

  .lockdown-topbar {
    display: flex;
    min-block-size: 2.25rem;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .lockdown-connection-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--colorNeutralForeground3);
    font: 600 12px/16px var(--fontFamilyBase);
  }

  .lockdown-connection-icon {
    --cfms-icon-line-height: 16px;
    color: var(--colorStatusSuccessForeground1);
  }

  .lockdown-connection-status--lost,
  .lockdown-connection-status--lost .lockdown-connection-icon {
    color: var(--colorStatusDangerForeground1);
  }

  :global(.lockdown-applock-button[data-fluent-owner="app-authentication-lockdown-page"]) {
    min-block-size: var(--cfms-control-height-medium);
    white-space: nowrap;
  }

  .lockdown-hero {
    display: grid;
    min-inline-size: 0;
    place-content: center;
    padding: clamp(2rem, 6vh, 4.5rem) clamp(0rem, 2vw, 1.5rem)
      clamp(2rem, 5vh, 3.5rem);
    text-align: center;
  }

  .lockdown-clock {
    color: var(--colorNeutralForeground1);
    font: 600 clamp(3.75rem, 10.5vw, 5.75rem)/1 var(--fontFamilyMonospace);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    text-wrap: nowrap;
  }

  .lockdown-status-line {
    display: flex;
    max-inline-size: 860px;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin: clamp(1.75rem, 4vh, 2.5rem) auto 0;
  }

  .lockdown-symbol {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    color: var(--colorStatusDangerForeground1);
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
    border-inline-end: 1px solid var(--colorNeutralStroke1);
    padding-inline-end: 1rem;
    color: var(--colorStatusDangerForeground1);
    font: 700 28px/36px var(--fontFamilyBase);
    letter-spacing: -0.015em;
  }

  .lockdown-description {
    max-inline-size: 66ch;
    margin: 0;
    padding-inline-start: 1rem;
    color: var(--colorNeutralForeground2);
    font: 400 14px/20px var(--fontFamilyBase);
  }

  .lockdown-shelf {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(24rem, 0.85fr);
    border-block-start: 1px solid var(--colorNeutralStroke1);
    background: transparent;
  }

  .lockdown-context {
    display: grid;
    min-inline-size: 0;
    align-content: center;
    padding: clamp(1.25rem, 2.25vw, 1.75rem);
    padding-inline-start: 0;
  }

  .lockdown-context > :global(* + *) {
    margin-block-start: 1rem;
    border-block-start: 1px solid var(--colorNeutralStroke2);
    padding-block-start: 1rem;
  }

  .lockdown-reason {
    min-inline-size: 0;
  }

  .lockdown-context-label {
    margin: 0 0 0.375rem;
    color: var(--colorNeutralForeground3);
    font: 600 12px/16px var(--fontFamilyBase);
  }

  .lockdown-context-copy {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    color: var(--colorNeutralForeground1);
    font: 400 14px/20px var(--fontFamilyBase);
  }

  .lockdown-session-note {
    display: flex;
    min-inline-size: 0;
    align-items: flex-start;
    gap: 12px;
  }

  .lockdown-detail-icon {
    --cfms-icon-line-height: 20px;
    color: var(--colorCompoundBrandForeground1);
  }

  .lockdown-session-copy {
    display: grid;
    min-inline-size: 0;
    gap: 4px;
  }

  .lockdown-session-title {
    margin: 0;
    color: var(--colorNeutralForeground1);
    font: 600 14px/20px var(--fontFamilyBase);
  }

  .lockdown-session-note--warning .lockdown-session-title {
    color: var(--colorStatusWarningForeground2);
  }

  .lockdown-session-body {
    max-inline-size: 66ch;
    color: var(--colorNeutralForeground2);
  }

  .lockdown-operations {
    display: grid;
    min-inline-size: 0;
    align-content: center;
    gap: 16px;
    border-inline-start: 1px solid var(--colorNeutralStroke2);
    padding: clamp(1.25rem, 2.25vw, 1.75rem);
    padding-inline-end: 0;
  }

  .lockdown-action-copy {
    min-inline-size: 0;
  }

  .lockdown-wait-copy {
    margin: 0;
    color: var(--colorNeutralForeground2);
    font: 600 14px/20px var(--fontFamilyBase);
  }

  .lockdown-wait-copy--lost {
    color: var(--colorStatusDangerForeground1);
  }

  .lockdown-quit-hint {
    max-inline-size: 66ch;
    margin: 0.375rem 0 0;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .lockdown-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  :global(.lockdown-action-button[data-fluent-owner="app-authentication-lockdown-page"]) {
    min-block-size: 36px;
    white-space: nowrap;
  }

  :global(.lockdown-action-button[data-fluent-owner="app-authentication-lockdown-page"] .md-progress-ring) {
    color: inherit;
  }

  @keyframes lockdown-enter {
    from {
      opacity: 0.85;
      transform: translateY(8px);
    }

    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .lockdown-stage {
      animation: none;
    }
  }

  @media (pointer: coarse) {
    :global(.lockdown-applock-button[data-fluent-owner="app-authentication-lockdown-page"]),
    :global(.lockdown-action-button[data-fluent-owner="app-authentication-lockdown-page"]) {
      min-block-size: 44px;
    }
  }

  @media (max-width: 820px) {
    .lockdown-stage {
      grid-template-rows: auto auto auto;
    }

    .lockdown-shelf {
      grid-template-columns: 1fr;
    }

    .lockdown-context {
      padding-inline: 0;
    }

    .lockdown-operations {
      border-block-start: 1px solid var(--colorNeutralStroke2);
      border-inline-start: 0;
      padding-inline: 0;
    }

    .lockdown-actions {
      justify-content: flex-start;
    }
  }

  @media (max-width: 620px) {
    .lockdown-shell {
      padding-block-start: max(1rem, var(--safe-area-top, 0px));
      padding-block-end: max(1rem, var(--safe-area-bottom, 0px));
      padding-inline-start: max(1rem, var(--safe-area-left, 0px));
      padding-inline-end: max(1rem, var(--safe-area-right, 0px));
    }

    .lockdown-hero {
      padding-block-start: 1.75rem;
      padding-block-end: 1.75rem;
    }

    .lockdown-clock {
      font-size: clamp(3rem, 15vw, 4.5rem);
    }

    .lockdown-status-line {
      max-inline-size: 31rem;
      align-items: start;
      margin-block-start: 1.5rem;
    }

    .lockdown-status-copy {
      display: grid;
      gap: 6px;
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
      padding-block: 1.25rem;
    }
  }

  @media (max-width: 480px) {
    .lockdown-actions {
      display: grid;
      grid-template-columns: 1fr;
    }

    :global(.lockdown-action-button[data-fluent-owner="app-authentication-lockdown-page"]) {
      inline-size: 100%;
    }
  }

  @media (max-height: 640px) and (min-width: 821px) {
    .lockdown-stage {
      grid-template-rows: auto minmax(12rem, 1fr) auto;
    }

    .lockdown-hero {
      padding-block: 1.5rem;
    }

    .lockdown-clock {
      font-size: clamp(3.5rem, 9.5vw, 4.75rem);
    }

    .lockdown-status-line {
      margin-block-start: 1.25rem;
    }
  }

  @media (forced-colors: active) {
    .lockdown-connection-status,
    .lockdown-connection-icon,
    .lockdown-symbol,
    .lockdown-status-copy h1,
    .lockdown-detail-icon,
    .lockdown-session-note--warning .lockdown-session-title,
    .lockdown-wait-copy--lost {
      color: CanvasText;
    }
  }
</style>
