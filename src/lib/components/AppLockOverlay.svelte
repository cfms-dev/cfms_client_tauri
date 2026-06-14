<script lang="ts">
  import { fade } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { appLockStore, isCredentialOperationCancelled } from '$lib/app-lock.svelte';
  import { disconnect, logout } from '$lib/api';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';
  import AppPinPad from '$lib/components/AppPinPad.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import ViewportScaleFrame from '$lib/components/ViewportScaleFrame.svelte';

  let pin = $state('');
  let busy = $state(false);
  let status = $state<string | null>(null);
  let verificationMethod = $state<'biometric' | 'platform' | null>(null);
  let failedAttempts = $state(0);
  let lockoutUntil = $state(0);
  let now = $state(Date.now());
  let shake = $state(false);
  let countdownTimer: number | null = null;

  const maxAttempts = 5;
  const temporaryLockoutAttempts = 3;
  const lockoutMs = 30_000;
  const lockedOutMs = $derived(Math.max(0, lockoutUntil - now));
  const canUsePin = $derived(appLockStore.hasPin && lockedOutMs <= 0 && !busy);
  const canUseBiometric = $derived(
    appLockStore.hasBiometric && appLockStore.biometricAvailable && !busy && lockedOutMs <= 0,
  );
  const canUsePlatform = $derived(appLockStore.hasPlatformCredential && !busy && lockedOutMs <= 0);
  const hasSecondaryUnlocks = $derived(appLockStore.hasBiometric || appLockStore.hasPlatformCredential);
  const compactSecondaryUnlocks = $derived(appLockStore.hasBiometric && appLockStore.hasPlatformCredential);
  const unlockTitle = $derived(
    appLockStore.hasPin && !hasSecondaryUnlocks
      ? $t('appLock.unlock.pinTitle')
      : $t('appLock.unlock.title'),
  );
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
    verificationMethod = null;
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

  async function verifyBiometric() {
    if (!canUseBiometric) return;
    busy = true;
    verificationMethod = 'biometric';
    status = $t('appLock.unlock.biometricPrompt');
    try {
      if (await appLockStore.verifyBiometric({
        reason: $t('appLock.unlock.biometricReason'),
        title: $t('appLock.unlock.biometricTitle'),
        subtitle: $t('appLock.unlock.biometricSubtitle'),
        cancelTitle: $t('common.cancel'),
        fallbackTitle: $t('appLock.unlock.biometricFallback'),
      })) {
        appLockStore.unlock();
        resetEntry();
        return;
      }
      await handleFailedAttempt();
    } catch (err) {
      if (isCredentialOperationCancelled(err)) {
        status = null;
      } else {
        const message = err instanceof Error ? err.message : String(err);
        status = message || $t('appLock.unlock.biometricCancelled');
      }
    } finally {
      busy = false;
      verificationMethod = null;
    }
  }

  async function verifyPlatform() {
    if (!canUsePlatform) return;
    busy = true;
    verificationMethod = 'platform';
    status = $t('appLock.unlock.platformPrompt');
    try {
      if (await appLockStore.verifyPlatformCredential()) {
        appLockStore.unlock();
        resetEntry();
        return;
      }
      await handleFailedAttempt();
    } catch (err) {
      if (isCredentialOperationCancelled(err)) {
        status = null;
      } else {
        const message = err instanceof Error ? err.message : String(err);
        status = message || $t('appLock.unlock.platformCancelled');
      }
    } finally {
      busy = false;
      verificationMethod = null;
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
    status = $t('appLock.unlock.invalidVerification');
  }

  async function forceDisconnect() {
    status = $t('appLock.unlock.tooManyAttempts');
    await logoutAndDisconnect($t('appLock.unlock.disconnected'), 'error');
  }

  async function logoutAndDisconnect(
    message = $t('appLock.unlock.logoutAndDisconnected'),
    tone: 'info' | 'error' = 'info',
  ) {
    if (busy && tone === 'info') return;
    busy = true;
    status = $t('appLock.unlock.signingOut');
    let errorMessage: string | null = null;

    try {
      await logout();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    try {
      await disconnect();
    } catch (err) {
      errorMessage ??= err instanceof Error ? err.message : String(err);
    }

    authStore.clear();
    serverStateStore.clear();
    appLockStore.unlock();

    if (errorMessage) {
      notificationStore.error(errorMessage);
    } else if (tone === 'error') {
      notificationStore.error(message, 7000);
    } else {
      notificationStore.info(message, 5000);
    }

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
    } else if (event.key === 'Enter' && hasSecondaryUnlocks) {
      event.preventDefault();
      if (canUseBiometric) {
        void verifyBiometric();
      } else {
        void verifyPlatform();
      }
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
    class="app-lock-overlay fixed inset-0 z-[90] flex min-h-full items-center justify-center overflow-auto px-5 py-10 text-white"
    role="dialog"
    aria-modal="true"
    aria-label={unlockTitle}
    transition:fade|global={{ duration: 180 }}
  >
    <ViewportScaleFrame inlinePadding={40} blockPadding={136} mobileBlockPadding={36}>
      <div class="app-lock-content flex flex-col items-center text-center">
        <div class="mb-8 rounded-[2rem] bg-white/12 p-5 shadow-2xl shadow-black/20">
          <Icon name="lock" size="64px" />
        </div>

        <h2 class="text-3xl font-light tracking-normal sm:text-4xl" style="font-family: var(--font-md3-sans);">
          {unlockTitle}
        </h2>

        <div class="mt-7 min-h-7 text-lg text-white/88">
          {#if lockedOutMs > 0}
            {formatLockout(lockedOutMs)}
          {:else if status}
            {status}
          {:else if appLockStore.hasPin}
            {$t('appLock.unlock.enterPin')}
          {:else}
            {$t('appLock.unlock.useConfiguredMethod')}
          {/if}
        </div>

        {#if hasSecondaryUnlocks}
          <div class:app-lock-auth-actions={true} class:app-lock-auth-actions--compact={compactSecondaryUnlocks}>
            {#if appLockStore.hasBiometric}
              <button
                type="button"
                class={compactSecondaryUnlocks ? 'app-lock-icon-button' : 'app-lock-auth-button'}
                style="font-family: var(--font-md3-sans);"
                aria-label={$t('appLock.unlock.biometricButton')}
                title={$t('appLock.unlock.biometricButton')}
                onclick={verifyBiometric}
                disabled={!canUseBiometric}
              >
                {#if verificationMethod === 'biometric'}
                  <ProgressRing size={18} strokeWidth={2.5} label={$t('common.verifying')} />
                {:else}
                  <Icon name="fingerprint" size={compactSecondaryUnlocks ? '22px' : '20px'} />
                {/if}
                {#if !compactSecondaryUnlocks}
                  <span>{$t('appLock.unlock.biometricButton')}</span>
                {/if}
              </button>
            {/if}

            {#if appLockStore.hasPlatformCredential}
              <button
                type="button"
                class={compactSecondaryUnlocks ? 'app-lock-icon-button' : 'app-lock-auth-button'}
                style="font-family: var(--font-md3-sans);"
                aria-label={$t('appLock.unlock.platformButton')}
                title={$t('appLock.unlock.platformButton')}
                onclick={verifyPlatform}
                disabled={!canUsePlatform}
              >
                {#if verificationMethod === 'platform'}
                  <ProgressRing size={18} strokeWidth={2.5} label={$t('common.verifying')} />
                {:else}
                  <Icon name="passkey" size={compactSecondaryUnlocks ? '22px' : '20px'} />
                {/if}
                {#if !compactSecondaryUnlocks}
                  <span>{$t('appLock.unlock.platformButton')}</span>
                {/if}
              </button>
            {/if}
          </div>
        {/if}

        {#if appLockStore.hasPin}
          <AppPinPad
            class="mt-8"
            bind:value={pin}
            length={appLockStore.pinLength}
            density="compact"
            disabled={!canUsePin}
            {shake}
            deleteLabel={$t('common.delete')}
          />
        {/if}

        <div class="app-lock-flat-actions mt-7">
          <button
            type="button"
            class="app-lock-flat-button"
            onclick={() => logoutAndDisconnect()}
            disabled={busy}
          >
            <Icon name="logout" size="20px" />
            {$t('appLock.unlock.logoutAndDisconnect')}
          </button>
        </div>
      </div>
    </ViewportScaleFrame>
  </div>
{/if}

<style>
  .app-lock-overlay {
    min-block-size: 100dvh;
    padding-block-start: calc(var(--safe-area-top, 0px) + 2rem);
    padding-block-end: calc(var(--safe-area-bottom, 0px) + 2rem);
    padding-inline-start: max(1.25rem, var(--safe-area-left, 0px));
    padding-inline-end: max(1.25rem, var(--safe-area-right, 0px));
    background:
      linear-gradient(145deg, rgba(14, 19, 50, 0.98), rgba(43, 16, 55, 0.98) 58%, rgba(30, 20, 39, 0.98)),
      radial-gradient(circle at 18% 14%, rgba(103, 80, 164, 0.28), transparent 34%);
    -webkit-backdrop-filter: blur(20px);
    backdrop-filter: blur(20px);
  }

  .app-lock-content {
    inline-size: 520px;
    animation: app-lock-enter 360ms var(--motion-easing-emphasized-decelerate) both;
  }

  .app-lock-auth-actions {
    display: flex;
    justify-content: center;
    gap: 0.7rem;
    margin-top: 1.25rem;
  }

  .app-lock-auth-button,
  .app-lock-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.12);
    color: white;
    box-shadow: 0 10px 22px rgba(0, 0, 0, 0.12);
    transition:
      background-color 160ms var(--motion-easing-standard),
      transform 160ms var(--motion-easing-emphasized-decelerate),
      opacity 160ms var(--motion-easing-standard);
  }

  .app-lock-auth-button {
    min-block-size: 44px;
    gap: 0.5rem;
    border-radius: 9999px;
    padding: 0.55rem 1.15rem;
    font-size: 0.875rem;
    font-weight: 650;
  }

  .app-lock-icon-button {
    inline-size: 48px;
    block-size: 48px;
    border-radius: 9999px;
    padding: 0;
  }

  .app-lock-auth-button:hover:not(:disabled),
  .app-lock-icon-button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.18);
    transform: translateY(-1px);
  }

  .app-lock-auth-button:disabled,
  .app-lock-icon-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
    transform: none;
  }

  .app-lock-flat-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.5rem;
  }

  .app-lock-flat-button {
    display: inline-flex;
    min-block-size: 44px;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 0;
    border-radius: 9999px;
    background: transparent;
    color: rgba(255, 255, 255, 0.88);
    padding: 0.55rem 1rem;
    font-size: 0.9375rem;
    font-weight: 650;
    transition:
      background-color 160ms var(--motion-easing-standard),
      color 160ms var(--motion-easing-standard),
      opacity 160ms var(--motion-easing-standard);
  }

  .app-lock-flat-button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .app-lock-flat-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
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
