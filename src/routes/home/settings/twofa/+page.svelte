<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    cancelTwoFactorSetup,
    disableTwoFactor,
    getAuthStatus,
    getTwoFactorStatus,
    setupTwoFactor,
    validateTwoFactor,
    type TwoFactorSetup,
    type TwoFactorStatus,
  } from '$lib/api';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let authReady = $state(false);
  let twofa = $state<TwoFactorStatus | null>(null);
  let setup = $state<TwoFactorSetup | null>(null);
  let qrCodeDataUrl = $state<string | null>(null);
  let verifiedBackupCodes = $state<string[]>([]);
  let verificationCode = $state('');
  let disablePassword = $state('');
  let loading = $state(true);
  let busy = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const enabled = $derived(Boolean(twofa?.enabled));
  const statusLabel = $derived(enabled ? $t('common.enabled') : $t('common.disabled'));
  const canVerify = $derived(Boolean(setup && verificationCode.trim().length > 0));
  const canDisable = $derived(enabled && disablePassword.trim().length > 0);

  $effect(() => {
    if (!status) return;
    notificationStore.success(status, 5000);
    status = null;
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  $effect(() => {
    const provisioningUri = setup?.provisioning_uri;
    qrCodeDataUrl = null;
    if (!provisioningUri) return;

    let canceled = false;
    void (async () => {
      try {
        const { toDataURL } = await import('qrcode');
        const dataUrl = await toDataURL(provisioningUri, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 192,
          color: {
            dark: '#111827',
            light: '#ffffff',
          },
        });
        if (!canceled) qrCodeDataUrl = dataUrl;
      } catch (err) {
        if (!canceled) error = err instanceof Error ? err.message : String(err);
      }
    })();

    return () => {
      canceled = true;
    };
  });

  onMount(async () => {
    await refreshStatus();
  });

  async function refreshStatus(options?: { preserveVerifiedBackupCodes?: boolean }) {
    loading = true;
    error = null;
    if (!options?.preserveVerifiedBackupCodes) verifiedBackupCodes = [];
    try {
      const auth = await getAuthStatus();
      authReady = auth.has_token;
      if (auth.has_token) {
        twofa = await getTwoFactorStatus();
      } else {
        twofa = { enabled: false, method: null, backup_codes_count: 0 };
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function startSetup() {
    busy = true;
    error = null;
    try {
      setup = await setupTwoFactor();
      verifiedBackupCodes = [];
      verificationCode = '';
      status = $t('settings.twofa.setupStarted');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function verifySetup() {
    if (!canVerify) return;
    busy = true;
    error = null;
    try {
      const backupCodes = setup?.backup_codes ?? [];
      await validateTwoFactor(verificationCode.trim());
      verifiedBackupCodes = backupCodes;
      setup = null;
      verificationCode = '';
      status = $t('settings.twofa.enabledStatus');
      await refreshStatus({ preserveVerifiedBackupCodes: true });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function cancelSetup() {
    busy = true;
    error = null;
    try {
      await cancelTwoFactorSetup();
      setup = null;
      verifiedBackupCodes = [];
      verificationCode = '';
      status = $t('settings.twofa.setupCanceled');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function disableCurrentTwoFactor() {
    if (!canDisable) return;
    busy = true;
    error = null;
    try {
      await disableTwoFactor(disablePassword);
      verifiedBackupCodes = [];
      disablePassword = '';
      status = $t('settings.twofa.disabledStatus');
      await refreshStatus();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => goto('/home/settings')}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    {$t('settings.twofa.title')}
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.twofa.statusTitle')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {authReady ? $t('settings.twofa.readyDescription') : $t('settings.twofa.signInDescription')}
        </p>
      </div>
      <span
        class="px-3 py-1 rounded-full text-xs font-medium"
        class:bg-md3-primary-container={enabled}
        class:text-md3-on-primary-container={enabled}
        class:bg-md3-surface-container-high={!enabled}
        class:text-md3-on-surface-variant={!enabled}
        style="font-family: var(--font-md3-sans);"
      >
        {loading ? $t('common.checking') : statusLabel}
      </span>
    </div>

    {#if twofa?.method}
      <p class="text-sm text-md3-on-surface-variant">
        {$t('settings.twofa.method')}: <span class="text-md3-on-surface uppercase">{twofa.method}</span>
        · {$t('settings.twofa.backupCodesCount')}: {twofa.backup_codes_count}
      </p>
    {/if}

    {#if setup}
      <div class="space-y-3">
        <div class="rounded-lg border border-md3-outline/60 bg-md3-surface-container-high/40 p-3">
          <div class="flex flex-col sm:flex-row gap-4">
            <div
              class="w-52 h-52 shrink-0 rounded-lg bg-white p-2 grid place-items-center
                     border border-md3-outline/40"
            >
              {#if qrCodeDataUrl}
                <img
                  class="w-full h-full object-contain"
                  src={qrCodeDataUrl}
                  alt={$t('settings.twofa.provisioningUri')}
                />
              {:else}
                <Icon name="qrCode" size="48px" class="text-md3-on-surface-variant" />
              {/if}
            </div>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="text-xs text-md3-on-surface-variant">{$t('settings.twofa.secret')}</p>
              <p class="text-sm text-md3-on-surface break-all">{setup.secret}</p>
              <p class="text-xs text-md3-on-surface-variant">{$t('settings.twofa.provisioningUri')}</p>
              <p class="text-xs text-md3-on-surface-variant break-all">{setup.provisioning_uri}</p>
            </div>
          </div>
        </div>

        <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.twofa.verificationCode')}
          <input
            class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                   px-3 py-2 text-md3-on-surface"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            bind:value={verificationCode}
            disabled={busy}
          />
        </label>
      </div>
    {:else if enabled}
      <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.twofa.currentPassword')}
        <input
          class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                 px-3 py-2 text-md3-on-surface"
          type="password"
          bind:value={disablePassword}
          disabled={busy}
        />
      </label>
    {/if}

    {#if verifiedBackupCodes.length > 0}
      <div class="rounded-lg border border-md3-outline/60 bg-md3-surface-container-high/40 p-3">
        <p class="text-xs text-md3-on-surface-variant mb-2">{$t('settings.twofa.backupCodes')}</p>
        <div class="grid grid-cols-2 gap-1 text-sm text-md3-on-surface">
          {#each verifiedBackupCodes as code}
            <span>{code}</span>
          {/each}
        </div>
      </div>
    {/if}

    <div class="flex flex-wrap gap-2">
      {#if setup}
        <button
          class="px-4 py-2 rounded-full font-medium text-sm
                 bg-md3-primary-container text-md3-on-primary-container
                 hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
          style="font-family: var(--font-md3-sans);"
          onclick={verifySetup}
          disabled={busy || !canVerify}
        >
          <Icon name="verified" size="18px" />
          {$t('settings.twofa.verifyEnable')}
        </button>
        <button
          class="px-4 py-2 rounded-full font-medium text-sm
                 bg-md3-surface-container-high text-md3-on-surface
                 hover:brightness-110 disabled:opacity-50 transition-all"
          style="font-family: var(--font-md3-sans);"
          onclick={cancelSetup}
          disabled={busy}
        >
          {$t('settings.twofa.cancelSetup')}
        </button>
      {:else if enabled}
        <button
          class="px-4 py-2 rounded-full font-medium text-sm
                 bg-md3-surface-container-high text-md3-error
                 hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
          style="font-family: var(--font-md3-sans);"
          onclick={disableCurrentTwoFactor}
          disabled={busy || !canDisable}
        >
          <Icon name="lockOpen" size="18px" />
          {$t('settings.twofa.disable')}
        </button>
      {:else}
        <button
          class="px-4 py-2 rounded-full font-medium text-sm
                 bg-md3-primary-container text-md3-on-primary-container
                 hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
          style="font-family: var(--font-md3-sans);"
          onclick={startSetup}
          disabled={loading || busy || !authReady}
        >
          <Icon name="security" size="18px" />
          {$t('settings.twofa.enable')}
        </button>
      {/if}
      <button
        class="px-4 py-2 rounded-full font-medium text-sm
               bg-md3-surface-container-high text-md3-on-surface
               hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
        style="font-family: var(--font-md3-sans);"
        onclick={() => refreshStatus()}
        disabled={loading || busy}
      >
        <Icon name="refresh" size="18px" />
        {$t('common.refresh')}
      </button>
    </div>
  </div>
</div>
