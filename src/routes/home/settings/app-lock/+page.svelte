<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { _ as t } from 'svelte-i18n';
  import {
    appLockStore,
    getRequiredPinLength,
    isCredentialOperationCancelled,
  } from '$lib/app-lock.svelte';
  import { navigateUp } from '$lib/navigation';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';
  import AppPinPad from '$lib/components/AppPinPad.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';

  const pinLength = getRequiredPinLength();

  let busy = $state<'enable' | 'pin' | 'pin-remove' | 'platform' | 'platform-remove' | null>(null);
  let error = $state<string | null>(null);
  let pinSetupOpen = $state(false);
  let pinSetupStep = $state<'new' | 'confirm'>('new');
  let pinSetupEntry = $state('');
  let pendingPin = $state('');
  let pinSetupShake = $state(false);
  let pinSetupMessage = $state<string | null>(null);

  const methodCount = $derived((appLockStore.hasPin ? 1 : 0) + appLockStore.settings.platformCredentials.length);
  const canEnable = $derived(appLockStore.hasAnyMethod && !busy);
  const platformStatus = $derived(
    appLockStore.platformAvailable ? $t('appLock.settings.available') : $t('appLock.settings.unavailable'),
  );
  const pinSetupTitle = $derived(
    pinSetupStep === 'new' ? $t('appLock.settings.newPin') : $t('appLock.settings.confirmPin'),
  );
  const platformCredentialName = $derived(authStore.displayName ?? 'CFMS user');

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(async () => {
    if (authStore.isLoggedIn && authStore.username) {
      await appLockStore.init(`${serverStateStore.remoteAddress ?? 'local'}:${authStore.username}`);
    }
    await appLockStore.refreshPlatformAvailability();
  });

  $effect(() => {
    if (!pinSetupOpen || pinSetupEntry.length !== pinLength || busy !== null) return;
    void advancePinSetup();
  });

  async function setEnabled(enabled: boolean) {
    busy = 'enable';
    try {
      await appLockStore.setEnabled(enabled);
      notificationStore.success($t('appLock.settings.saved'));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  async function removePin() {
    busy = 'pin-remove';
    try {
      await appLockStore.removePin();
      notificationStore.success($t('appLock.settings.pinRemoved'));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  async function addPlatformCredential() {
    busy = 'platform';
    try {
      await appLockStore.registerPlatformCredential(platformCredentialName);
      notificationStore.success($t('appLock.settings.platformSaved'));
    } catch (err) {
      if (isCredentialOperationCancelled(err)) {
        notificationStore.info($t('appLock.settings.platformCancelled'));
      } else {
        error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      busy = null;
    }
  }

  async function removePlatformCredential(id: string) {
    busy = 'platform-remove';
    try {
      await appLockStore.removePlatformCredential(id);
      notificationStore.success($t('appLock.settings.platformRemoved'));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  function formatDate(value: number) {
    return new Date(value).toLocaleString();
  }

  function openPinSetup() {
    if (busy !== null) return;
    pinSetupOpen = true;
    pinSetupStep = 'new';
    pinSetupEntry = '';
    pendingPin = '';
    pinSetupMessage = null;
    pinSetupShake = false;
  }

  function closePinSetup(force = false) {
    if (busy === 'pin' && !force) return;
    pinSetupOpen = false;
    pinSetupEntry = '';
    pendingPin = '';
    pinSetupMessage = null;
    pinSetupShake = false;
  }

  async function advancePinSetup() {
    const entry = pinSetupEntry;
    if (pinSetupStep === 'new') {
      pendingPin = entry;
      pinSetupEntry = '';
      pinSetupStep = 'confirm';
      pinSetupMessage = null;
      return;
    }

    if (entry !== pendingPin) {
      pinSetupEntry = '';
      pendingPin = '';
      pinSetupStep = 'new';
      pinSetupMessage = $t('appLock.settings.pinMismatch');
      triggerPinSetupShake();
      return;
    }

      busy = 'pin';
    try {
      await appLockStore.setPin(entry);
      closePinSetup(true);
      notificationStore.success($t('appLock.settings.pinSaved'));
    } catch (err) {
      pinSetupEntry = '';
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  function triggerPinSetupShake() {
    pinSetupShake = false;
    requestAnimationFrame(() => {
      pinSetupShake = true;
      window.setTimeout(() => {
        pinSetupShake = false;
      }, 360);
    });
  }

  function handlePinSetupKeydown(event: KeyboardEvent) {
    if (!pinSetupOpen) return;
    if (/^\d$/u.test(event.key)) {
      event.preventDefault();
      if (busy === null && pinSetupEntry.length < pinLength) pinSetupEntry += event.key;
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      if (busy === null) pinSetupEntry = pinSetupEntry.slice(0, -1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closePinSetup();
    }
  }
</script>

<svelte:window onkeydown={handlePinSetupKeydown} />

<div class="mx-auto max-w-2xl space-y-4 p-6">
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant transition-colors hover:text-md3-on-surface"
    style="font-family: var(--font-md3-sans);"
    onclick={() => navigateUp(page.url.pathname)}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <div class="flex items-center gap-3">
    <span class="rounded-2xl bg-md3-primary-container p-3 text-md3-on-primary-container">
      <Icon name="lockPerson" size="28px" />
    </span>
    <div class="min-w-0">
      <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('appLock.settings.title')}
      </h1>
      <p class="text-xs text-md3-on-surface-variant">
        {$t('appLock.settings.description')}
      </p>
    </div>
  </div>

  {#if !authStore.isLoggedIn}
    <div class="rounded-xl border border-md3-outline bg-md3-surface-container/70 p-5 text-sm text-md3-on-surface-variant">
      {$t('appLock.settings.signInRequired')}
    </div>
  {:else}
    <section class="rounded-xl border border-md3-outline bg-md3-surface-container/70 p-5 backdrop-blur-sm">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('appLock.settings.enableTitle')}
          </h2>
          <p class="mt-1 text-xs text-md3-on-surface-variant">
            {$t('appLock.settings.methodCount', { values: { count: methodCount } })}
          </p>
        </div>
        <MdSwitch
          checked={appLockStore.settings.enabled}
          disabled={!canEnable}
          ariaLabel={$t('appLock.settings.enableTitle')}
          onChange={setEnabled}
        />
      </div>
    </section>

    <section class="rounded-xl border border-md3-outline bg-md3-surface-container/70 p-5 backdrop-blur-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('appLock.settings.pinTitle')}
          </h2>
          <p class="mt-1 text-xs text-md3-on-surface-variant">
            {appLockStore.hasPin ? $t('appLock.settings.pinReady') : $t('appLock.settings.pinDescription')}
          </p>
        </div>
        {#if appLockStore.hasPin}
          <span class="inline-flex items-center gap-1 rounded-full bg-md3-primary-container px-3 py-1 text-xs font-medium text-md3-on-primary-container">
            <Icon name="done" size="16px" />
            {$t('common.enabled')}
          </span>
        {/if}
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <button
          class="app-lock-action app-lock-action--primary"
          onclick={openPinSetup}
          disabled={busy !== null}
        >
          <Icon name="pin" size="18px" />
          {appLockStore.hasPin ? $t('appLock.settings.changePin') : $t('appLock.settings.setPin')}
        </button>
        {#if appLockStore.hasPin}
          <button
            class="app-lock-action app-lock-action--danger"
            onclick={removePin}
            disabled={busy !== null}
          >
            <Icon name="delete" size="18px" />
            {$t('appLock.settings.removePin')}
          </button>
        {/if}
      </div>
    </section>

    <section class="rounded-xl border border-md3-outline bg-md3-surface-container/70 p-5 backdrop-blur-sm">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('appLock.settings.platformTitle')}
          </h2>
          <p class="mt-1 text-xs text-md3-on-surface-variant">
            {$t('appLock.settings.platformDescription')}
          </p>
        </div>
        <span
          class="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium"
          class:bg-md3-primary-container={appLockStore.platformAvailable}
          class:text-md3-on-primary-container={appLockStore.platformAvailable}
          class:bg-md3-surface-container-high={!appLockStore.platformAvailable}
          class:text-md3-on-surface-variant={!appLockStore.platformAvailable}
        >
          <Icon name={appLockStore.platformAvailable ? 'verified' : 'warningAmber'} size="16px" />
          {platformStatus}
        </span>
      </div>

      {#if appLockStore.settings.platformCredentials.length > 0}
        <div class="mt-4 divide-y divide-md3-outline/50 overflow-hidden rounded-lg border border-md3-outline/60">
          {#each appLockStore.settings.platformCredentials as credential}
            <div class="flex items-center gap-3 bg-md3-surface-container-high/35 px-3 py-2.5">
              <span class="text-md3-primary-emphasis">
                <Icon name="fingerprint" size="22px" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-md3-on-surface">
                  {credential.label}
                </p>
                <p class="truncate text-xs text-md3-on-surface-variant">
                  {formatDate(credential.createdAt)}
                </p>
              </div>
              <button
                class="rounded-full p-2 text-md3-error transition-colors hover:bg-md3-error-container hover:text-md3-on-error-container disabled:opacity-45"
                aria-label={$t('appLock.settings.removePlatform')}
                onclick={() => removePlatformCredential(credential.id)}
                disabled={busy !== null}
              >
                <Icon name="delete" size="18px" />
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="mt-4 flex flex-wrap gap-2">
        <button
          class="app-lock-action app-lock-action--primary"
          onclick={addPlatformCredential}
          disabled={!appLockStore.platformAvailable || busy !== null}
        >
          <Icon name="fingerprint" size="18px" />
          {$t('appLock.settings.addPlatform')}
        </button>
        <button
          class="app-lock-action"
          onclick={() => appLockStore.refreshPlatformAvailability()}
          disabled={busy !== null}
        >
          <Icon name="refresh" size="18px" />
          {$t('common.refresh')}
        </button>
      </div>
    </section>
  {/if}
</div>

{#if pinSetupOpen}
  <div
    class="pin-setup-backdrop fixed inset-0 z-[70] flex items-center justify-center overflow-auto px-5 py-8"
    role="presentation"
    onclick={() => closePinSetup()}
  >
    <div
      class="pin-setup-panel flex w-[520px] max-w-full flex-col items-center text-center text-white"
      role="dialog"
      aria-modal="true"
      aria-label={pinSetupTitle}
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
    >
      <div class="mb-6 rounded-[1.75rem] bg-white/12 p-4 shadow-2xl shadow-black/20">
        <Icon name="password" size="48px" />
      </div>
      <h2 class="text-3xl font-light" style="font-family: var(--font-md3-sans);">
        {pinSetupTitle}
      </h2>
      <p class="mt-4 min-h-6 text-base text-white/82">
        {pinSetupMessage ?? (pinSetupStep === 'new'
          ? $t('appLock.settings.enterNewPin')
          : $t('appLock.settings.enterConfirmPin'))}
      </p>

      <AppPinPad
        class="mt-7"
        bind:value={pinSetupEntry}
        length={pinLength}
        density="compact"
        disabled={busy !== null}
        shake={pinSetupShake}
        deleteLabel={$t('common.delete')}
      />

      <button
        type="button"
        class="pin-setup-cancel mt-6"
        onclick={() => closePinSetup()}
        disabled={busy === 'pin'}
      >
        <Icon name="arrowBack" size="18px" />
        {$t('common.cancel')}
      </button>
    </div>
  </div>
{/if}

<style>
  .app-lock-action {
    display: inline-flex;
    min-block-size: 40px;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 72%, transparent);
    color: var(--color-md3-on-surface);
    padding: 0.55rem 0.9rem;
    font-size: 0.8125rem;
    font-weight: 650;
    transition:
      background var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .app-lock-action:hover:not(:disabled) {
    background: var(--color-md3-surface-container-highest);
    transform: translateY(-1px);
  }

  .app-lock-action:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .app-lock-action--primary {
    border-color: color-mix(in srgb, var(--color-md3-primary) 55%, transparent);
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
  }

  .app-lock-action--danger {
    border-color: color-mix(in srgb, var(--color-md3-error) 55%, transparent);
    color: var(--color-md3-error);
  }

  .pin-setup-backdrop {
    min-block-size: 100dvh;
    padding-block-start: calc(var(--safe-area-top, 0px) + 1.25rem);
    padding-block-end: calc(var(--safe-area-bottom, 0px) + 1.25rem);
    padding-inline-start: max(1.25rem, var(--safe-area-left, 0px));
    padding-inline-end: max(1.25rem, var(--safe-area-right, 0px));
    background:
      linear-gradient(145deg, rgba(14, 19, 50, 0.94), rgba(43, 16, 55, 0.95) 58%, rgba(30, 20, 39, 0.95));
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
  }

  .pin-setup-panel {
    max-block-size: calc(100dvh - var(--safe-area-top, 0px) - var(--safe-area-bottom, 0px) - 2.5rem);
    animation: pin-setup-enter 280ms var(--motion-easing-emphasized-decelerate) both;
  }

  .pin-setup-cancel {
    display: inline-flex;
    min-block-size: 42px;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border: 0;
    border-radius: 9999px;
    background: transparent;
    color: white;
    padding: 0.5rem 0.9rem;
    font-size: 0.875rem;
    font-weight: 650;
    transition:
      background-color 160ms var(--motion-easing-standard),
      opacity 160ms var(--motion-easing-standard);
  }

  .pin-setup-cancel:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }

  .pin-setup-cancel:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  @keyframes pin-setup-enter {
    from {
      opacity: 0;
      transform: translateY(14px) scale(0.985);
      filter: blur(6px);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pin-setup-panel {
      animation: none !important;
    }
  }
</style>
