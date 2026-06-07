<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
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
  import Icon from '$lib/components/Icon.svelte';

  let authReady = $state(false);
  let twofa = $state<TwoFactorStatus | null>(null);
  let setup = $state<TwoFactorSetup | null>(null);
  let verificationCode = $state('');
  let disablePassword = $state('');
  let loading = $state(true);
  let busy = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const enabled = $derived(Boolean(twofa?.enabled));
  const statusLabel = $derived(enabled ? 'Enabled' : 'Disabled');
  const canVerify = $derived(Boolean(setup && verificationCode.trim().length > 0));
  const canDisable = $derived(enabled && disablePassword.trim().length > 0);

  $effect(() => {
    if (!status) return;
    const timeout = window.setTimeout(() => (status = null), 5000);
    return () => window.clearTimeout(timeout);
  });

  onMount(async () => {
    await refreshStatus();
  });

  async function refreshStatus() {
    loading = true;
    error = null;
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
      verificationCode = '';
      status = 'Scan the provisioning URI or enter the secret, then verify a code.';
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
      await validateTwoFactor(verificationCode.trim());
      setup = null;
      verificationCode = '';
      status = 'Two-factor authentication enabled successfully.';
      await refreshStatus();
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
      verificationCode = '';
      status = 'Two-factor authentication setup canceled.';
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
      disablePassword = '';
      status = 'Two-factor authentication disabled.';
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
    Back
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    Two-Factor Auth
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          TOTP Status
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {authReady ? 'Authenticator app verification for this account.' : 'Sign in before managing account 2FA.'}
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
        {loading ? 'Checking...' : statusLabel}
      </span>
    </div>

    {#if twofa?.method}
      <p class="text-sm text-md3-on-surface-variant">
        Method: <span class="text-md3-on-surface uppercase">{twofa.method}</span>
        · Backup codes: {twofa.backup_codes_count}
      </p>
    {/if}

    {#if setup}
      <div class="space-y-3">
        <div class="rounded-lg border border-md3-outline/60 bg-md3-surface-container-high/40 p-3 space-y-2">
          <p class="text-xs text-md3-on-surface-variant">Secret</p>
          <p class="text-sm text-md3-on-surface break-all">{setup.secret}</p>
          <p class="text-xs text-md3-on-surface-variant">Provisioning URI</p>
          <p class="text-xs text-md3-on-surface-variant break-all">{setup.provisioning_uri}</p>
        </div>

        {#if setup.backup_codes.length > 0}
          <div class="rounded-lg border border-md3-outline/60 bg-md3-surface-container-high/40 p-3">
            <p class="text-xs text-md3-on-surface-variant mb-2">Backup Codes</p>
            <div class="grid grid-cols-2 gap-1 text-sm text-md3-on-surface">
              {#each setup.backup_codes as code}
                <span>{code}</span>
              {/each}
            </div>
          </div>
        {/if}

        <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          Verification Code
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
        Current Password
        <input
          class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                 px-3 py-2 text-md3-on-surface"
          type="password"
          bind:value={disablePassword}
          disabled={busy}
        />
      </label>
    {/if}

    {#if status}
      <p class="text-sm text-md3-success flex items-center gap-1.5">
        <Icon name="checkCircle" size="16px" />
        {status}
      </p>
    {/if}
    {#if error}
      <p class="text-sm text-md3-error flex items-center gap-1.5">
        <Icon name="errorFilled" size="16px" />
        {error}
      </p>
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
          Verify and Enable
        </button>
        <button
          class="px-4 py-2 rounded-full font-medium text-sm
                 bg-md3-surface-container-high text-md3-on-surface
                 hover:brightness-110 disabled:opacity-50 transition-all"
          style="font-family: var(--font-md3-sans);"
          onclick={cancelSetup}
          disabled={busy}
        >
          Cancel Setup
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
          Disable Two-Factor Auth
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
          Enable Two-Factor Auth
        </button>
      {/if}
      <button
        class="px-4 py-2 rounded-full font-medium text-sm
               bg-md3-surface-container-high text-md3-on-surface
               hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
        style="font-family: var(--font-md3-sans);"
        onclick={refreshStatus}
        disabled={loading || busy}
      >
        <Icon name="refresh" size="18px" />
        Refresh
      </button>
    </div>
  </div>
</div>
