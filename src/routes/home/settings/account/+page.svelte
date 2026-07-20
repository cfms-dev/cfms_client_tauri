<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    cancelTwoFactorSetup,
    changePassword,
    clearAuthSession,
    disableTwoFactor,
    getAuthStatus,
    getTwoFactorStatus,
    setupTwoFactor,
    validateTwoFactor,
    type TwoFactorSetup,
    type TwoFactorStatus,
  } from '$lib/api';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import ChangePasswordDialog from '$lib/components/ChangePasswordDialog.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';

  let showPasswordDialog = $state(false);
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
        if (!canceled) error = formatError(err);
      }
    })();

    return () => {
      canceled = true;
    };
  });

  onMount(async () => {
    await refreshTwoFactorStatus();
  });

  async function handleChangePassword(oldPassword: string, newPassword: string): Promise<void> {
    const username = authStore.username;
    if (!authStore.isLoggedIn || !username) {
      throw new Error($t('settings.password.signInRequired'));
    }

    await changePassword(username, oldPassword, newPassword);
    showPasswordDialog = false;
    await clearAuthSession();
    authStore.clear();
    notificationStore.success($t('more.passwordChanged'));
    await goto('/login', { replaceState: true });
  }

  async function refreshTwoFactorStatus(options?: { preserveVerifiedBackupCodes?: boolean }) {
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
      error = formatError(err);
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
      error = formatError(err);
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
      await refreshTwoFactorStatus({ preserveVerifiedBackupCodes: true });
    } catch (err) {
      error = formatError(err);
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
      error = formatError(err);
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
      await refreshTwoFactorStatus();
    } catch (err) {
      error = formatError(err);
    } finally {
      busy = false;
    }
  }

  function formatError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
</script>

<div class="workspace-page p-4 sm:p-6 space-y-4 max-w-2xl mx-auto">
  <SettingsPageHeader
    title={$t('settings.account.title')}
    description={$t('settings.account.description')}
    icon="accountCircle"
  />

  <section
    class="overflow-hidden rounded-xl border border-md3-outline
           bg-md3-surface-container/70 backdrop-blur-sm"
  >
    <div class="p-5">
      <h2
        class="text-sm font-semibold text-md3-on-surface"
        style="font-family: var(--font-md3-sans);"
      >
        {$t('settings.password.accountTitle')}
      </h2>
      <p class="mt-1 text-xs text-md3-on-surface-variant">
        {$t('settings.password.accountHint')}
      </p>
    </div>

    <div
      class="flex flex-col gap-3 border-t border-md3-outline/50
             bg-md3-surface-container-high/30 px-5 py-4 sm:flex-row sm:items-center"
    >
      <p class="min-w-0 flex-1 text-xs leading-5 text-md3-on-surface-variant">
        {$t('settings.password.sessionHint')}
      </p>
      <button
        type="button"
        class="inline-flex shrink-0 items-center justify-center gap-2 rounded-full
               bg-md3-primary-container px-4 py-2 text-sm font-medium
               text-md3-on-primary-container transition-all hover:brightness-110
               disabled:cursor-not-allowed disabled:opacity-50"
        style="font-family: var(--font-md3-sans);"
        disabled={!authStore.isLoggedIn || !authStore.username}
        onclick={() => (showPasswordDialog = true)}
      >
        <Icon name="password" size="18px" />
        {$t('settings.password.action')}
      </button>
    </div>
  </section>

  <section
    class="space-y-4 rounded-xl border border-md3-outline
           bg-md3-surface-container/70 p-5 backdrop-blur-sm"
    aria-labelledby="account-twofa-title"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2
          id="account-twofa-title"
          class="text-sm font-semibold text-md3-on-surface"
          style="font-family: var(--font-md3-sans);"
        >
          {$t('settings.twofa.title')}
        </h2>
        <p class="mt-1 text-xs text-md3-on-surface-variant">
          {$t('settings.twofa.description')}
        </p>
      </div>
      <span
        class="shrink-0 rounded-full px-3 py-1 text-xs font-medium"
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
        {$t('settings.twofa.method')}: <span class="uppercase text-md3-on-surface">{twofa.method}</span>
        · {$t('settings.twofa.backupCodesCount')}: {twofa.backup_codes_count}
      </p>
    {/if}

    {#if setup}
      <div class="space-y-3">
        <div class="rounded-lg border border-md3-outline/60 bg-md3-surface-container-high/40 p-3">
          <div class="flex flex-col gap-4 sm:flex-row">
            <div
              class="grid h-52 w-52 shrink-0 place-items-center rounded-lg border
                     border-md3-outline/40 bg-white p-2"
            >
              {#if qrCodeDataUrl}
                <img
                  class="h-full w-full object-contain"
                  src={qrCodeDataUrl}
                  alt={$t('settings.twofa.provisioningUri')}
                />
              {:else}
                <Icon name="qrCode" size="48px" class="text-md3-on-surface-variant" />
              {/if}
            </div>
            <div class="min-w-0 flex-1 space-y-2">
              <p class="text-xs text-md3-on-surface-variant">{$t('settings.twofa.secret')}</p>
              <p class="break-all text-sm text-md3-on-surface">{setup.secret}</p>
              <p class="text-xs text-md3-on-surface-variant">{$t('settings.twofa.provisioningUri')}</p>
              <p class="break-all text-xs text-md3-on-surface-variant">{setup.provisioning_uri}</p>
            </div>
          </div>
        </div>

        <label
          class="block space-y-1.5 text-sm text-md3-on-surface"
          style="font-family: var(--font-md3-sans);"
        >
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
      <label
        class="block space-y-1.5 text-sm text-md3-on-surface"
        style="font-family: var(--font-md3-sans);"
      >
        {$t('settings.twofa.currentPassword')}
        <input
          class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                 px-3 py-2 text-md3-on-surface"
          type="password"
          autocomplete="current-password"
          bind:value={disablePassword}
          disabled={busy}
        />
      </label>
    {/if}

    {#if verifiedBackupCodes.length > 0}
      <div class="rounded-lg border border-md3-outline/60 bg-md3-surface-container-high/40 p-3">
        <p class="mb-2 text-xs text-md3-on-surface-variant">{$t('settings.twofa.backupCodes')}</p>
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
          class="flex items-center gap-2 rounded-full bg-md3-primary-container px-4 py-2
                 text-sm font-medium text-md3-on-primary-container transition-all
                 hover:brightness-110 disabled:opacity-50"
          style="font-family: var(--font-md3-sans);"
          onclick={verifySetup}
          disabled={busy || !canVerify}
        >
          <Icon name="verified" size="18px" />
          {$t('settings.twofa.verifyEnable')}
        </button>
        <button
          class="rounded-full bg-md3-surface-container-high px-4 py-2 text-sm font-medium
                 text-md3-on-surface transition-all hover:brightness-110 disabled:opacity-50"
          style="font-family: var(--font-md3-sans);"
          onclick={cancelSetup}
          disabled={busy}
        >
          {$t('settings.twofa.cancelSetup')}
        </button>
      {:else if enabled}
        <button
          class="flex items-center gap-2 rounded-full bg-md3-surface-container-high px-4 py-2
                 text-sm font-medium text-md3-error transition-all hover:brightness-110
                 disabled:opacity-50"
          style="font-family: var(--font-md3-sans);"
          onclick={disableCurrentTwoFactor}
          disabled={busy || !canDisable}
        >
          <Icon name="lockOpen" size="18px" />
          {$t('settings.twofa.disable')}
        </button>
      {:else}
        <button
          class="flex items-center gap-2 rounded-full bg-md3-primary-container px-4 py-2
                 text-sm font-medium text-md3-on-primary-container transition-all
                 hover:brightness-110 disabled:opacity-50"
          style="font-family: var(--font-md3-sans);"
          onclick={startSetup}
          disabled={loading || busy || !authReady}
        >
          <Icon name="security" size="18px" />
          {$t('settings.twofa.enable')}
        </button>
      {/if}
      <button
        class="flex items-center gap-2 rounded-full bg-md3-surface-container-high px-4 py-2
               text-sm font-medium text-md3-on-surface transition-all hover:brightness-110
               disabled:opacity-50"
        style="font-family: var(--font-md3-sans);"
        onclick={() => refreshTwoFactorStatus()}
        disabled={loading || busy}
      >
        <Icon name="refresh" size="18px" />
        {$t('common.refresh')}
      </button>
    </div>
  </section>
</div>

{#if showPasswordDialog && authStore.username}
  <ChangePasswordDialog
    username={authStore.username}
    tip={$t('more.passwordTip')}
    onSubmit={handleChangePassword}
    onCancel={() => (showPasswordDialog = false)}
  />
{/if}
