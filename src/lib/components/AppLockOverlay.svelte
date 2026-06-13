<script lang="ts">
  import { fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { appLockStore } from '$lib/app-lock.svelte';
  import { clearAuthSession, disconnect } from '$lib/api';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';
  import AppPinPad from '$lib/components/AppPinPad.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  let pin = $state('');
  let busy = $state(false);
  let status = $state<string | null>(null);
  let failedAttempts = $state(0);
  let lockoutUntil = $state(0);
  let now = $state(Date.now());
  let shake = $state(false);
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);
  let contentWidth = $state(520);
  let contentHeight = $state(780);
  let countdownTimer: number | null = null;

  const maxAttempts = 5;
  const temporaryLockoutAttempts = 3;
  const lockoutMs = 30_000;
  const lockedOutMs = $derived(Math.max(0, lockoutUntil - now));
  const canUsePin = $derived(appLockStore.hasPin && lockedOutMs <= 0 && !busy);
  const canUsePlatform = $derived(appLockStore.hasPlatformCredential && !busy && lockedOutMs <= 0);
  const contentScale = $derived.by(() => {
    if (viewportWidth <= 0 || viewportHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) return 1;
    const inlineScale = (viewportWidth - 40) / contentWidth;
    const blockScale = (viewportHeight - 64) / contentHeight;
    return Math.min(1, Math.max(0.1, Math.min(inlineScale, blockScale)));
  });
  const scaledFrameStyle = $derived(
    `width: ${Math.ceil(contentWidth * contentScale)}px; height: ${Math.ceil(contentHeight * contentScale)}px;`,
  );
  const scaledSurfaceStyle = $derived(`transform: scale(${contentScale});`);

  $effect(() => {
    if (!appLockStore.locked) {
      resetEntry();
      return;
    }

    countdownTimer = window.setInterval(() => {
      now = Date.now();
    }, 250);

    return () => {
      if (countdownTimer !== null) {
        window.clearInterval(countdownTimer);
        countdownTimer = null;
      }
    };
  });

  $effect(() => {
    if (pin.length === appLockStore.pinLength && appLockStore.hasPin && canUsePin) {
      void verifyPin();
    }
  });

  function resetEntry() {
    pin = '';
    busy = false;
    status = null;
    failedAttempts = 0;
    lockoutUntil = 0;
    shake = false;
  }

  function appendDigit(digit: string) {
    if (!canUsePin || pin.length >= appLockStore.pinLength) return;
    pin += digit;
  }

  function deleteDigit() {
    if (busy || pin.length === 0) return;
    pin = pin.slice(0, -1);
  }

  function triggerShake() {
    shake = false;
    requestAnimationFrame(() => {
      shake = true;
      window.setTimeout(() => {
        shake = false;
      }, 360);
    });
  }

  async function verifyPin() {
    if (busy) return;
    busy = true;
    try {
      if (await appLockStore.verifyPin(pin)) {
        appLockStore.unlock();
        resetEntry();
        return;
      }

      await handleFailedAttempt();
    } catch (err) {
      notificationStore.error(err instanceof Error ? err.message : String(err));
      pin = '';
    } finally {
      busy = false;
    }
  }

  async function verifyPlatform() {
    if (!canUsePlatform) return;
    busy = true;
    status = $t('appLock.unlock.platformPrompt');
    try {
      if (await appLockStore.verifyPlatformCredential()) {
        appLockStore.unlock();
        resetEntry();
        return;
      }
      await handleFailedAttempt();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      status = message || $t('appLock.unlock.platformCancelled');
    } finally {
      busy = false;
    }
  }

  async function handleFailedAttempt() {
    failedAttempts += 1;
    pin = '';
    triggerShake();

    if (failedAttempts >= maxAttempts) {
      await forceDisconnect();
      return;
    }

    if (failedAttempts >= temporaryLockoutAttempts) {
      lockoutUntil = Date.now() + lockoutMs;
    }
    status = $t('appLock.unlock.invalidPin');
  }

  async function forceDisconnect() {
    status = $t('appLock.unlock.tooManyAttempts');
    try {
      await disconnect();
    } catch {
      /* best effort */
    }
    try {
      await clearAuthSession();
    } catch {
      /* best effort */
    }
    authStore.clear();
    serverStateStore.clear();
    appLockStore.unlock();
    notificationStore.error($t('appLock.unlock.disconnected'), 7000);
    await goto('/connect', { replaceState: true });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!appLockStore.locked) return;
    if (/^\d$/u.test(event.key)) {
      event.preventDefault();
      appendDigit(event.key);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      deleteDigit();
    } else if (event.key === 'Enter' && appLockStore.hasPlatformCredential) {
      event.preventDefault();
      void verifyPlatform();
    }
  }

  function formatLockout(ms: number) {
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    return $t('appLock.unlock.tryAgain', { values: { seconds } });
  }
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} onkeydown={handleKeydown} />

{#if appLockStore.locked}
  <div
    class="app-lock-overlay fixed inset-0 z-[90] flex min-h-full items-center justify-center overflow-auto px-5 py-8 text-white"
    role="dialog"
    aria-modal="true"
    aria-label={$t('appLock.unlock.title')}
    transition:fade|global={{ duration: 180 }}
  >
    <div class="app-lock-frame" style={scaledFrameStyle}>
      <div class="app-lock-scale-surface" style={scaledSurfaceStyle}>
        <div
          class="app-lock-content flex flex-col items-center text-center"
          bind:clientWidth={contentWidth}
          bind:clientHeight={contentHeight}
        >
          <div class="mb-8 rounded-[2rem] bg-white/12 p-5 shadow-2xl shadow-black/20">
            <Icon name="lock" size="64px" />
          </div>

          <h2 class="text-3xl font-light tracking-normal sm:text-4xl" style="font-family: var(--font-md3-sans);">
            {$t('appLock.unlock.title')}
          </h2>

          <div class="mt-7 min-h-7 text-lg text-white/88">
            {#if lockedOutMs > 0}
              {formatLockout(lockedOutMs)}
            {:else if status}
              {status}
            {:else if appLockStore.hasPin}
              {$t('appLock.unlock.enterPin')}
            {:else}
              {$t('appLock.unlock.usePlatform')}
            {/if}
          </div>

          {#if appLockStore.hasPlatformCredential}
            <button
              type="button"
              class="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/18 bg-white/12 px-5 text-sm font-semibold text-white shadow-lg shadow-black/10 transition-all hover:bg-white/18 disabled:opacity-45"
              style="font-family: var(--font-md3-sans);"
              onclick={verifyPlatform}
              disabled={!canUsePlatform}
            >
              {#if busy && status === $t('appLock.unlock.platformPrompt')}
                <ProgressRing size={18} strokeWidth={2.5} label={$t('common.verifying')} />
              {:else}
                <Icon name="fingerprint" size="20px" />
              {/if}
              {$t('appLock.unlock.platformButton')}
            </button>
          {/if}

          {#if appLockStore.hasPin}
            <AppPinPad
              class="mt-8"
              bind:value={pin}
              length={appLockStore.pinLength}
              disabled={!canUsePin}
              {shake}
              deleteLabel={$t('common.delete')}
            />
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .app-lock-overlay {
    background:
      linear-gradient(145deg, rgba(14, 19, 50, 0.98), rgba(43, 16, 55, 0.98) 58%, rgba(30, 20, 39, 0.98)),
      radial-gradient(circle at 18% 14%, rgba(103, 80, 164, 0.28), transparent 34%);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
  }

  .app-lock-frame {
    position: relative;
    flex: 0 0 auto;
  }

  .app-lock-scale-surface {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    transform-origin: 0 0;
  }

  .app-lock-content {
    inline-size: 520px;
    animation: app-lock-enter 360ms var(--motion-easing-emphasized-decelerate) both;
  }

  @keyframes app-lock-enter {
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.98);
      filter: blur(8px);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .app-lock-content {
      animation: none !important;
    }
  }
</style>
