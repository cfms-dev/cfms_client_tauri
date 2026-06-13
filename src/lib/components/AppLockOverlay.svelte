<script lang="ts">
  import { fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { appLockStore } from '$lib/app-lock.svelte';
  import { clearAuthSession, disconnect } from '$lib/api';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  const keypad = [
    { digit: '1', letters: '' },
    { digit: '2', letters: 'ABC' },
    { digit: '3', letters: 'DEF' },
    { digit: '4', letters: 'GHI' },
    { digit: '5', letters: 'JKL' },
    { digit: '6', letters: 'MNO' },
    { digit: '7', letters: 'PQRS' },
    { digit: '8', letters: 'TUV' },
    { digit: '9', letters: 'WXYZ' },
    { digit: '0', letters: '' },
  ];

  let pin = $state('');
  let busy = $state(false);
  let status = $state<string | null>(null);
  let failedAttempts = $state(0);
  let lockoutUntil = $state(0);
  let now = $state(Date.now());
  let shake = $state(false);
  let countdownTimer: number | null = null;

  const maxAttempts = 5;
  const temporaryLockoutAttempts = 3;
  const lockoutMs = 30_000;
  const dots = $derived(Array.from({ length: appLockStore.pinLength }, (_, index) => index < pin.length));
  const lockedOutMs = $derived(Math.max(0, lockoutUntil - now));
  const canUsePin = $derived(appLockStore.hasPin && lockedOutMs <= 0 && !busy);
  const canUsePlatform = $derived(appLockStore.hasPlatformCredential && !busy && lockedOutMs <= 0);

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

<svelte:window onkeydown={handleKeydown} />

{#if appLockStore.locked}
  <div
    class="app-lock-overlay fixed inset-0 z-[90] flex min-h-full items-center justify-center overflow-auto px-5 py-8 text-white"
    role="dialog"
    aria-modal="true"
    aria-label={$t('appLock.unlock.title')}
    transition:fade|global={{ duration: 180 }}
  >
    <div class="app-lock-content mx-auto flex w-full max-w-[520px] flex-col items-center text-center">
      <div class="mb-8 rounded-[2rem] bg-white/12 p-5 shadow-2xl shadow-black/20">
        <Icon name="lock" size="64px" />
      </div>

      <h2 class="text-3xl font-light tracking-normal sm:text-4xl" style="font-family: var(--font-md3-sans);">
        {$t('appLock.unlock.title')}
      </h2>

      <div class="mt-8 flex h-7 items-center justify-center gap-7" class:app-lock-shake={shake}>
        {#each dots as filled}
          <span class="app-lock-dot" class:app-lock-dot--filled={filled}></span>
        {/each}
      </div>

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
        <div class="mt-8 grid w-full max-w-[420px] grid-cols-3 justify-items-center gap-x-8 gap-y-6">
          {#each keypad.slice(0, 9) as key}
            <button
              type="button"
              class="pin-key"
              onclick={() => appendDigit(key.digit)}
              disabled={!canUsePin}
              aria-label={key.digit}
            >
              <span class="pin-key__digit">{key.digit}</span>
              <span class="pin-key__letters">{key.letters}</span>
            </button>
          {/each}

          <span aria-hidden="true"></span>
          <button
            type="button"
            class="pin-key"
            onclick={() => appendDigit('0')}
            disabled={!canUsePin}
            aria-label="0"
          >
            <span class="pin-key__digit">0</span>
            <span class="pin-key__letters"></span>
          </button>
          <button
            type="button"
            class="pin-delete"
            onclick={deleteDigit}
            disabled={busy || pin.length === 0}
          >
            {$t('common.delete')}
          </button>
        </div>
      {/if}
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

  .app-lock-content {
    animation: app-lock-enter 360ms var(--motion-easing-emphasized-decelerate) both;
  }

  .app-lock-dot {
    inline-size: 20px;
    block-size: 20px;
    border: 2px solid rgba(255, 255, 255, 0.92);
    border-radius: 9999px;
    background: transparent;
    transition:
      background-color 120ms var(--motion-easing-standard),
      transform 160ms var(--motion-easing-emphasized-decelerate);
  }

  .app-lock-dot--filled {
    background: white;
    transform: scale(1.08);
  }

  .pin-key {
    display: inline-flex;
    inline-size: clamp(86px, 25vw, 118px);
    block-size: clamp(86px, 25vw, 118px);
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 9999px;
    color: white;
    background: rgba(255, 255, 255, 0.13);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.16);
    transition:
      transform 160ms var(--motion-easing-emphasized-decelerate),
      background-color 160ms var(--motion-easing-standard),
      opacity 160ms var(--motion-easing-standard);
  }

  .pin-key:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.2);
    transform: translateY(-2px);
  }

  .pin-key:active:not(:disabled) {
    transform: scale(0.95);
  }

  .pin-key:disabled,
  .pin-delete:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .pin-key__digit {
    font-size: clamp(3rem, 12vw, 4.4rem);
    font-weight: 300;
    line-height: 0.92;
  }

  .pin-key__letters {
    min-block-size: 1.1rem;
    font-size: 0.9rem;
    font-weight: 800;
    letter-spacing: 0.22em;
    opacity: 0.95;
  }

  .pin-delete {
    align-self: center;
    justify-self: stretch;
    min-block-size: 44px;
    border: 0;
    border-radius: 9999px;
    color: rgba(255, 255, 255, 0.94);
    background: transparent;
    font-size: 1.05rem;
    font-weight: 500;
    transition:
      background-color 160ms var(--motion-easing-standard),
      opacity 160ms var(--motion-easing-standard);
  }

  .pin-delete:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  .app-lock-shake {
    animation: app-lock-shake 340ms var(--motion-easing-standard);
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

  @keyframes app-lock-shake {
    0%,
    100% {
      transform: translateX(0);
    }

    20% {
      transform: translateX(-10px);
    }

    40% {
      transform: translateX(9px);
    }

    60% {
      transform: translateX(-6px);
    }

    80% {
      transform: translateX(4px);
    }
  }

  @media (max-width: 420px) {
    .app-lock-content {
      max-inline-size: 360px;
    }

    .app-lock-dot {
      inline-size: 17px;
      block-size: 17px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .app-lock-content,
    .app-lock-shake {
      animation: none !important;
    }

    .pin-key,
    .app-lock-dot {
      transition: none !important;
    }
  }
</style>
