<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { setupTwoFactor, validateTwoFactor, cancelTwoFactorSetup, disableTwoFactor, getTwoFactorStatus, getManagedTwoFactorStatus, disableManagedTwoFactor, type TwoFactorSetup, type TwoFactorStatus } from '$lib/api';
  import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
  import { canReadAuthentication, canConfigureAuthentication } from '$lib/features/authentication/auth-permissions';
  import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import IconButton from '$lib/shared/ui/IconButton.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';

  let { userId, busy = $bindable(false), disabled = false, beforeChange, onChanged }: {
    userId?: string; busy?: boolean; disabled?: boolean; beforeChange: () => Promise<boolean>; onChanged: () => Promise<void>;
  } = $props();
  const managed = $derived(Boolean(userId && userId !== authStore.userId));
  const canRead = $derived(canReadAuthentication(authStore.permissions, managed));
  const canManage = $derived(canConfigureAuthentication(authStore.permissions, managed));
  let status = $state<TwoFactorStatus | null>(null);
  let loading = $state(true);
  let setup = $state<TwoFactorSetup | null>(null);
  let qr = $state('');
  let code = $state('');
  let password = $state('');
  let recovery = $state<string[]>([]);
  let disabling = $state(false);
  let error = $state('');
  let alive = true;
  onMount(() => { void refresh(); });
  onDestroy(() => { alive = false; setup = null; recovery = []; password = ''; code = ''; });

  async function refresh() {
    loading = true;
    error = '';
    try { if (canRead) { const result = managed ? await getManagedTwoFactorStatus(userId!) : await getTwoFactorStatus(); if (alive) status = result; } }
    catch (e) { if (alive) error = formatUserFacingError(e); }
    finally { if (alive) loading = false; }
  }
  export async function refreshStatus() { await refresh(); }
  export function hasPending() { return Boolean(setup || recovery.length); }
  async function run(action: () => Promise<void>) {
    if (busy || disabled || !canManage) return;
    busy = true;
    error = '';
    try { await action(); } catch (e) { if (alive) error = formatUserFacingError(e); }
    finally { busy = false; }
  }
  async function begin() {
    if (!(await beforeChange())) return;
    await run(async () => {
      const result = await setupTwoFactor();
      if (!alive) return;
      setup = result;
      recovery = [];
      code = '';
    });
  }
  $effect(() => {
    const uri = setup?.provisioning_uri;
    qr = '';
    if (!uri) return;
    let cancelled = false;
    void import('qrcode').then(({ toDataURL }) => toDataURL(uri, { width: 192, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#111827', light: '#ffffff' } }))
      .then((value) => { if (!cancelled) qr = value; }).catch((e) => { if (!cancelled) error = formatUserFacingError(e); });
    return () => { cancelled = true; };
  });
  async function verify() {
    if (!setup || !code.trim()) return;
    if (!(await beforeChange())) return;
    await run(async () => {
      await validateTwoFactor(code.trim());
      if (!alive) return;
      recovery = [...setup!.backup_codes];
      setup = null;
      code = '';
      await refresh();
      await onChanged();
    });
  }
  async function cancel() {
    if (!(await beforeChange())) return;
    await run(async () => { await cancelTwoFactorSetup(); setup = null; code = ''; await refresh(); await onChanged(); });
  }
  async function beginDisable() {
    if (!(await beforeChange())) return;
    if (managed) {
      if (!(await dialogStore.confirm({ message: $t('authManagement.managedDisableConfirm'), danger: true }))) return;
      await disable();
    } else { disabling = true; }
  }
  async function disable() {
    if (!managed && !password) return;
    if (!(await beforeChange())) return;
    await run(async () => {
      if (managed) await disableManagedTwoFactor(userId!); else await disableTwoFactor(password);
      password = ''; disabling = false; recovery = [];
      await refresh(); await onChanged();
    });
  }
  export async function canLeave(): Promise<boolean> {
    if (busy) return false;
    if (setup) {
      if (!(await dialogStore.confirm({ message: $t('authManagement.cancelSetupLeave') }))) return false;
      // The container has already confirmed its draft. Do not refresh it until
      // all leave checks succeed, or a cancelled leave could erase that draft.
      await run(async () => { await cancelTwoFactorSetup(); setup = null; code = ''; });
      if (setup) return false;
    }
    if (recovery.length && !(await dialogStore.confirm({ message: $t('authManagement.recoveryHelp'), confirmLabel: $t('authManagement.recoveryDone') }))) return false;
    recovery = [];
    return true;
  }
  const outlinedId = $props.id();
</script>

<div class="auth-authenticator">
  {#if error}<p role="alert" class="auth-error">{error}</p>{/if}
  {#if loading}<ProgressRing size={18} label={$t('common.loading')} />
  {:else if canRead && !status}
    <div class="auth-row"><h3>{$t('authManagement.totpName')}</h3><IconButton icon="refresh" label={$t('common.refresh')} disabled={disabled || busy} onclick={refresh} /></div>
  {:else if canRead}
    <div class="auth-row"><span class="auth-state">{$t(status?.enabled ? 'common.enabled' : status?.configured ? 'authManagement.pendingTotp' : 'authManagement.notRegistered')}</span>{#if status?.enabled}<p>{$t('settings.twofa.backupCodesCount')}: {status.backup_codes_count}</p>{/if}</div>
    {#if managed}<p>{$t('authManagement.managedAuthenticator')}</p>{/if}
    {#if setup}
      <form class="auth-form auth-inset" onsubmit={(event) => { event.preventDefault(); void verify(); }}>
        <div class="cfms-heading-copy"><h3>{$t('authManagement.setupTitle')}</h3><p>{$t('authManagement.scanCode')}</p></div>
        {#if qr}<img class="auth-qr" src={qr} alt={$t('settings.twofa.provisioningUri')} width="192" height="192" />{:else}<ProgressRing label={$t('common.loading')} />{/if}
        <details><summary>{$t('authManagement.manualSetup')}</summary><code>{setup.secret}</code></details>
        <div>
          <MdOutlinedField inputId={`${outlinedId}-1`} label={$t('settings.twofa.verificationCode')} disabled={disabled || busy}>
            <input id={`${outlinedId}-1`} data-focus-ring="delegated" class="cfms-native-field" bind:value={code} inputmode="numeric" autocomplete="one-time-code" disabled={disabled || busy} />
          </MdOutlinedField>
        </div>
        <div class="auth-actions"><DialogActionButton disabled={disabled || busy} onclick={cancel}>{$t('common.cancel')}</DialogActionButton><DialogActionButton type="submit" variant="primary" disabled={disabled || busy || !code.trim()}>{$t('settings.twofa.verifyEnable')}</DialogActionButton></div>
      </form>
    {:else if recovery.length}
      <div class="auth-inset auth-form" role="status"><div class="cfms-heading-copy"><h3>{$t('authManagement.saveRecovery')}</h3><p>{$t('authManagement.recoveryHelp')}</p><p>{$t('authManagement.totpActivated')}</p></div><div class="auth-recovery">{#each recovery as value}<code>{value}</code>{/each}</div><div class="auth-actions"><DialogActionButton onclick={() => { recovery = []; }}>{$t('authManagement.recoveryDone')}</DialogActionButton></div></div>
    {:else if disabling}
      <form class="auth-form auth-inset" onsubmit={(event) => { event.preventDefault(); void disable(); }}><p>{$t('authManagement.disableHelp')}</p><div>
        <MdOutlinedField inputId={`${outlinedId}-2`} label={$t('settings.twofa.currentPassword')} disabled={disabled || busy}>
          <input id={`${outlinedId}-2`} data-focus-ring="delegated" class="cfms-native-field" type="password" autocomplete="current-password" bind:value={password} disabled={disabled || busy} />
        </MdOutlinedField>
      </div><div class="auth-actions"><DialogActionButton disabled={busy} onclick={() => { disabling = false; password = ''; }}>{$t('common.cancel')}</DialogActionButton><DialogActionButton type="submit" variant="danger" disabled={disabled || busy || !password}>{$t('authManagement.disableAuthenticator')}</DialogActionButton></div></form>
    {:else if canManage}<div class="auth-actions">{#if status?.enabled}<DialogActionButton variant="danger" disabled={disabled || busy} onclick={beginDisable}>{$t('authManagement.disableAuthenticator')}</DialogActionButton>{:else if !managed && status?.configured}<DialogActionButton disabled={disabled || busy} onclick={cancel}>{$t('authManagement.cancelPendingTotp')}</DialogActionButton>{:else if !managed}<DialogActionButton variant="tonal" disabled={disabled || busy} onclick={begin}>{$t('settings.twofa.enable')}</DialogActionButton>{/if}</div>{/if}
  {:else}<p>{$t('authManagement.managedAuthenticator')}</p>{/if}
</div>
