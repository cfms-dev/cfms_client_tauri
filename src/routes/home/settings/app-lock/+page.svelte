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
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';

  const pinLength = getRequiredPinLength();

  let pin = $state('');
  let confirmPin = $state('');
  let busy = $state<'enable' | 'pin' | 'pin-remove' | 'platform' | 'platform-remove' | null>(null);
  let error = $state<string | null>(null);

  const methodCount = $derived((appLockStore.hasPin ? 1 : 0) + appLockStore.settings.platformCredentials.length);
  const canEnable = $derived(appLockStore.hasAnyMethod && !busy);
  const canSavePin = $derived(pin.length === pinLength && confirmPin.length === pinLength && !busy);
  const platformStatus = $derived(
    appLockStore.platformAvailable ? $t('appLock.settings.available') : $t('appLock.settings.unavailable'),
  );

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(async () => {
    await appLockStore.init();
    await appLockStore.refreshPlatformAvailability();
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

  async function savePin() {
    if (!canSavePin) return;
    if (pin !== confirmPin) {
      error = $t('appLock.settings.pinMismatch');
      return;
    }

    busy = 'pin';
    try {
      await appLockStore.setPin(pin);
      pin = '';
      confirmPin = '';
      notificationStore.success($t('appLock.settings.pinSaved'));
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
      await appLockStore.registerPlatformCredential(authStore.nickname ?? authStore.username ?? 'CFMS user');
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

  function sanitizePinInput(event: Event, target: 'pin' | 'confirm') {
    const input = event.currentTarget as HTMLInputElement;
    const next = input.value.replace(/\D/gu, '').slice(0, pinLength);
    input.value = next;
    if (target === 'pin') pin = next;
    else confirmPin = next;
  }

  function formatDate(value: number) {
    return new Date(value).toLocaleString();
  }
</script>

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

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <label class="space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('appLock.settings.newPin')}
          <input
            class="app-lock-input"
            type="password"
            inputmode="numeric"
            autocomplete="new-password"
            maxlength={pinLength}
            value={pin}
            oninput={(event) => sanitizePinInput(event, 'pin')}
            disabled={busy !== null}
          />
        </label>
        <label class="space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('appLock.settings.confirmPin')}
          <input
            class="app-lock-input"
            type="password"
            inputmode="numeric"
            autocomplete="new-password"
            maxlength={pinLength}
            value={confirmPin}
            oninput={(event) => sanitizePinInput(event, 'confirm')}
            disabled={busy !== null}
          />
        </label>
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <button
          class="app-lock-action app-lock-action--primary"
          onclick={savePin}
          disabled={!canSavePin}
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

<style>
  .app-lock-input {
    display: block;
    inline-size: 100%;
    border: 1px solid var(--color-md3-outline);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 78%, transparent);
    color: var(--color-md3-on-surface);
    padding: 0.7rem 0.85rem;
    font-size: 1rem;
    letter-spacing: 0.18em;
    transition:
      border-color var(--motion-duration-short4) var(--motion-easing-standard),
      box-shadow var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .app-lock-input:focus {
    border-color: var(--color-md3-primary);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-md3-primary) 18%, transparent);
    outline: none;
  }

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
</style>
