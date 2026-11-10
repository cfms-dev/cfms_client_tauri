<script lang="ts">
  // Methods explain what the account owns; flows explain when and how to use it.
  // The diagram and editor share one policy draft.
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { getUserAuthentication, setUserAuthPolicies, registerUserAuthPublicKey, updateUserAuthPublicKey, deleteUserAuthPublicKey, changePassword, clearAuthSession, resetUserPassword, disableManagedTwoFactor, serverErrorData, type AuthPolicyStep, type AuthPurpose, type UserAuthentication } from '$lib/api';
  import { AUTH_PURPOSES, changedAuthPolicies, canCompleteChain, invalidPolicyDraft, hasDuplicateAuthChains, type AuthCredential } from '$lib/features/authentication/auth-policy-editor';
  import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
  import { canReadAuthentication, canConfigureAuthentication } from '$lib/features/authentication/auth-permissions';
  import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import IconButton from '$lib/shared/ui/IconButton.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import ChangePasswordDialog from '$lib/features/authentication/ChangePasswordDialog.svelte';
  import ResetUserPasswordDialog from '$lib/features/authentication/ResetUserPasswordDialog.svelte';
  import AuthenticationMethods from '$lib/features/authentication/authentication/AuthenticationMethods.svelte';
  import AuthenticationFlowGraph from '$lib/features/authentication/authentication/AuthenticationFlowGraph.svelte';
  import AuthenticationStepEditor from '$lib/features/authentication/authentication/AuthenticationStepEditor.svelte';
  import AuthenticatorSettings from '$lib/features/authentication/authentication/AuthenticatorSettings.svelte';
  import '$lib/features/authentication/authentication/authentication.css';

  let { userId, username, header }: {
    userId?: string;
    username?: string;
    header?: Snippet<[() => Promise<void>, boolean]>;
  } = $props();
  let inventory = $state<UserAuthentication | null>(null);
  let draft = $state<Record<AuthPurpose, AuthPolicyStep[][]>>({ login: [], mfa: [], escalation: [] });
  let loading = $state(true);
  let busy = $state(false);
  let methodBusy = $state(false);
  let error = $state('');
  let conflict = $state(false);
  let tab = $state<'methods' | 'flows'>('methods');
  let purpose = $state<AuthPurpose>('login');
  let selectedChain = $state(0);
  let selectedStep = $state(0);
  let showPassword = $state(false);
  let now = $state(Date.now());
  let authenticatorSettings = $state<AuthenticatorSettings>();
  let allowNavigation = false;
  const managed = $derived(Boolean(userId && userId !== authStore.userId));
  const elevated = $derived((authStore.escalationExp ?? 0) * 1000 > now);
  const changed = $derived(inventory ? changedAuthPolicies(inventory.policies, draft) : []);
  const canConfigure = $derived(canConfigureAuthentication(authStore.permissions, managed));
  const writable = $derived(canConfigure && elevated && !busy && !methodBusy && !loading);
  const invalid = $derived(inventory ? changed.some((policy) => invalidPolicyDraft(policy.chains, inventory!.credentials)) : true);
  const canSave = $derived(writable && changed.length > 0 && !conflict && !invalid);
  const canPassword = $derived(canConfigure && elevated);
  const selected = $derived(draft[purpose][selectedChain]);
  const loginAvailable = $derived.by(() => {
    if (!inventory) return true;
    const login = draft.login.filter((chain) => canCompleteChain(chain, inventory!.credentials));
    const mfa = draft.mfa.filter((chain) => canCompleteChain(chain, inventory!.credentials));
    return login.some((chain) => !draft.mfa.length || mfa.some((alternative) => alternative[0].method !== chain[0].method));
  });

  onMount(() => {
    void load();
    const timer = window.setInterval(() => { now = Date.now(); }, 1000);
    return () => window.clearInterval(timer);
  });
  beforeNavigate((navigation) => {
    if (allowNavigation || (!changed.length && !authenticatorSettings?.hasPending())) return;
    navigation.cancel();
    if (navigation.willUnload) return;
    void canLeave().then((leave) => {
      if (leave && navigation.to) { allowNavigation = true; void goto(navigation.to.url.href).finally(() => { allowNavigation = false; }); }
    });
  });

  async function load() {
    error = '';
    if (!canReadAuthentication(authStore.permissions, managed)) {
      inventory = null;
      loading = false;
      return;
    }
    try {
      const result = await getUserAuthentication(userId);
      inventory = result;
      draft = Object.fromEntries(AUTH_PURPOSES.map((key) => [key, structuredClone(result.policies[key].chains)])) as typeof draft;
      conflict = false;
      selectedChain = 0; selectedStep = 0;
    } catch (e) { error = formatUserFacingError(e); }
    finally { loading = false; }
  }
  async function reload() {
    if (!(await canLeave())) return;
    busy = true;
    try { await load(); await authenticatorSettings?.refreshStatus(); } finally { busy = false; }
  }
  export async function canLeave(): Promise<boolean> {
    if (busy || methodBusy || showPassword) return false;
    if (changed.length) {
      if (!(await dialogStore.confirm({ message: $t('authManagement.leaveChanges'), confirmLabel: $t('authManagement.discard'), danger: true }))) return false;
    }
    if (!(await authenticatorSettings?.canLeave() ?? true)) return false;
    discardDraft();
    return true;
  }
  async function beforeMethodChange(): Promise<boolean> {
    if (!changed.length) return true;
    const choice = await dialogStore.choose({ message: $t('authManagement.pendingAction'), choices: [
      { value: 'save', label: $t('authManagement.saveFirst'), intent: 'primary' },
      { value: 'discard', label: $t('authManagement.discard'), intent: 'danger' },
    ], cancelLabel: $t('common.cancel') });
    if (choice?.value === 'save') return await savePolicies();
    if (choice?.value === 'discard' && inventory) {
      discardDraft();
      return true;
    }
    return false;
  }
  function discardDraft() {
    if (!inventory) return;
    draft = Object.fromEntries(AUTH_PURPOSES.map((key) => [key, structuredClone($state.snapshot(inventory!.policies[key].chains))])) as typeof draft;
    selectedChain = 0; selectedStep = 0;
  }
  async function write(action: () => Promise<void>): Promise<boolean> {
    if (!writable) return false;
    busy = true; error = '';
    try { await action(); notificationStore.success($t('authManagement.saved')); return true; }
    catch (e) {
      const reason = serverErrorData(e)?.reason;
      if (reason === 'revision_conflict') conflict = true;
      const reasons = ['revision_conflict', 'duplicate_public_key', 'login_unavailable', 'escalation_unavailable', 'invalid_public_key', 'unsupported_public_key', 'invalid_policy'];
      error = typeof reason === 'string' && reasons.includes(reason) ? $t(`authManagement.errors.${reason}`) : formatUserFacingError(e);
      return false;
    } finally { busy = false; }
  }
  async function savePolicies(): Promise<boolean> {
    if (!inventory || !canSave) return false;
    const replacements = structuredClone($state.snapshot(changed));
    return await write(async () => {
      const result = await setUserAuthPolicies(replacements, userId);
      if (!inventory) return;
      for (const key of AUTH_PURPOSES) {
        const policy = result.policies[key];
        if (policy) { inventory.policies[key] = policy; draft[key] = structuredClone(policy.chains); }
      }
      conflict = false;
    });
  }
  function clearEscalationPolicy() {
    if (!writable) return;
    draft.escalation = [];
    selectedChain = 0; selectedStep = 0;
  }
  function addAlternative() {
    if (!writable || !inventory) return;
    const eligible = Object.keys(inventory.methods).filter((method) => inventory!.methods[method].purposes.includes(purpose));
    const method = eligible.find((name) => inventory!.credentials.some((c) => c.method === name && c.active)) ?? eligible[0];
    if (!method) return;
    const active = inventory.credentials.filter((c) => c.method === method && c.active);
    draft[purpose].push([{ method, credential_ids: active.length === 1 ? [active[0].credential_id] : [] }]);
    selectedChain = draft[purpose].length - 1; selectedStep = 0;
  }
  async function setMethod(method: string) {
    if (!selected || selected[0]?.method === method || !writable) return;
    if (selected.some((step) => step.credential_ids.length) && !(await dialogStore.confirm({ message: $t('authManagement.replaceMethod') }))) return;
    if (!writable) return;
    const active = inventory!.credentials.filter((c) => c.method === method && c.active);
    draft[purpose][selectedChain] = [{ method, credential_ids: active.length === 1 ? [active[0].credential_id] : [] }];
    selectedStep = 0;
  }
  function toggle(id: string) {
    if (!writable || !selected?.[selectedStep]) return;
    const step = selected[selectedStep];
    step.credential_ids = step.credential_ids.includes(id) ? step.credential_ids.filter((value) => value !== id) : [...step.credential_ids, id];
  }
  async function registerKey(key: string, label: string) {
    if (!key) return false;
    return await write(async () => {
      const result = await registerUserAuthPublicKey(key, label || null, userId);
      inventory?.credentials.push({ method: 'publickey', credential_id: result.credential_id, active: true, label: result.label, key_identity: result.fingerprint });
    });
  }
  async function editKey(credential: AuthCredential) {
    const next = await dialogStore.prompt({ message: $t('authManagement.keyLabel'), defaultValue: credential.label ?? '', maxLength: 255 });
    if (next === null) return;
    await write(async () => { const result = await updateUserAuthPublicKey(credential.credential_id, next.trim() || null, userId); credential.label = result.label; });
  }
  async function deleteKey(credential: AuthCredential) {
    if (!writable || !(await beforeMethodChange())) return;
    if (!(await dialogStore.confirm({ title: $t('authManagement.deleteKey'), message: $t('authManagement.deleteKeyConfirm'), danger: true }))) return;
    await write(async () => { await deleteUserAuthPublicKey(credential.credential_id, userId); await load(); });
  }
  async function beginPassword() {
    if (!canPassword || busy || methodBusy || !(await beforeMethodChange())) return;
    if (!(await authenticatorSettings?.canLeave() ?? true)) return;
    showPassword = true;
  }
  async function updatePassword(newPassword: string) {
    if (!canPassword) throw new Error($t('authManagement.elevationRequired'));
    await changePassword(authStore.username!, newPassword);
    showPassword = false;
    await clearAuthSession(); authStore.clear();
    notificationStore.success($t('settings.password.changed'));
    allowNavigation = true; await goto('/login', { replaceState: true });
  }
  async function resetPassword(password: string, bypass: boolean, force: boolean, disableTotp: boolean) {
    if (!canPassword) throw new Error($t('authManagement.elevationRequired'));
    await resetUserPassword(userId!, password, bypass, force);
    showPassword = false;
    if (disableTotp && canConfigure) {
      try { await disableManagedTwoFactor(userId!); }
      catch (e) { notificationStore.error($t('manage.passwordChangedTwoFactorFailed', { values: { username: username ?? userId!, error: formatUserFacingError(e) } })); await load(); return; }
    }
    notificationStore.success($t('authManagement.saved')); await load(); await authenticatorSettings?.refreshStatus();
  }
</script>

<div class="authentication-management">
  {#if header}
    {@render header(reload, busy || methodBusy || loading)}
  {:else}
    <div class="auth-heading">
      <div class="auth-toolbar">
        <h2>{$t('authManagement.title')}</h2>
        <IconButton icon="refresh" label={$t('common.refresh')} disabled={busy || methodBusy || loading} onclick={reload} />
      </div>
      <p>{$t('authManagement.description')}</p>
    </div>
  {/if}
  {#if managed}<p>{$t('authManagement.adminAccount', { values: { username: username ?? userId! } })}</p>{/if}
  {#if error}<p role="alert" class="auth-error auth-feedback">{error}</p>{/if}
  {#if !canReadAuthentication(authStore.permissions, managed)}<p role="status">{$t('authManagement.inventoryPermissionRequired')}</p>{/if}
  {#if loading}<ProgressRing label={$t('common.loading')} />
  {:else if inventory}
    {#if !canConfigure}<p role="status" class="auth-notice auth-feedback">{$t('authManagement.readOnly')}</p>
    {:else if !elevated}<p role="status" class="auth-notice auth-feedback">{$t('authManagement.elevationRequired')}</p>{/if}
    <div class="auth-tabs" role="tablist" aria-label={$t('authManagement.title')}>
      {#each ['methods', 'flows'] as value}
        <button id={`auth-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`auth-panel-${value}`} tabindex={tab === value ? 0 : -1} onclick={() => { tab = value as typeof tab; }} onkeydown={(event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); tab = event.key === 'Home' ? 'methods' : event.key === 'End' ? 'flows' : tab === 'methods' ? 'flows' : 'methods'; document.getElementById(`auth-tab-${tab}`)?.focus(); } }}>{$t(`authManagement.${value}Tab`)}</button>
      {/each}
    </div>
    <div id="auth-panel-methods" role="tabpanel" aria-labelledby="auth-tab-methods" hidden={tab !== 'methods'}>
      <AuthenticationMethods {inventory} {writable} {managed} busy={busy || methodBusy} canChangePassword={canPassword} onPassword={beginPassword} onRegister={registerKey} onEdit={editKey} onDelete={deleteKey}>
        {#snippet authenticator()}
          <AuthenticatorSettings bind:this={authenticatorSettings} {userId} bind:busy={methodBusy} disabled={busy || loading || !authStore.isLoggedIn} beforeChange={beforeMethodChange} onChanged={load} />
        {/snippet}
      </AuthenticationMethods>
    </div>
    <div id="auth-panel-flows" role="tabpanel" aria-labelledby="auth-tab-flows" hidden={tab !== 'flows'}>
      <div class="auth-purposes" aria-label={$t('authManagement.flowsTab')}>
        {#each AUTH_PURPOSES as key}<DialogActionButton variant={purpose === key ? 'tonal' : 'secondary'} aria-pressed={purpose === key} onclick={() => { purpose = key; selectedChain = 0; selectedStep = 0; }}>{$t(`authManagement.purposes.${key}`)}</DialogActionButton>{/each}
      </div>
      <p>{$t(`authManagement.purposeHelp.${purpose}`)}</p>
      {#if hasDuplicateAuthChains(draft[purpose])}<p role="alert" class="auth-error">{$t('authManagement.duplicateAlternatives')}</p>{/if}
      {#if purpose === 'mfa'}<p>{$t('authManagement.mfaMethodHint')}</p>{/if}
      {#if !loginAvailable}<p class="auth-notice">{$t('authManagement.noCompleteLogin')}</p>{/if}
      <div class="auth-flow-layout">
        <div class="auth-grow">
          <AuthenticationFlowGraph chains={draft[purpose]} {purpose} credentials={inventory.credentials} {selectedChain} {selectedStep} onSelect={(chain, step) => { selectedChain = chain; selectedStep = step; }} />
          <div class="auth-actions">
            {#if purpose === 'escalation' && draft.escalation.length}
              <DialogActionButton variant="danger" disabled={!writable} onclick={clearEscalationPolicy}>{$t('authManagement.clearEscalation')}</DialogActionButton>
            {/if}
            <DialogActionButton disabled={!writable || !Object.values(inventory.methods).some((metadata) => metadata.purposes.includes(purpose))} onclick={addAlternative}>{$t('authManagement.addAlternative')}</DialogActionButton>
          </div>
        </div>
        {#if selected?.[selectedStep]}
          <AuthenticationStepEditor {inventory} {purpose} chain={selected} chainIndex={selectedChain} stepIndex={selectedStep} {writable} onMethod={setMethod} onToggle={toggle}
            onAddStep={() => { if (writable) { selected.push({ method: selected[0].method, credential_ids: [] }); selectedStep = selected.length - 1; } }}
            onRemoveStep={() => { if (writable) { selected.splice(selectedStep, 1); selectedStep = Math.max(0, selectedStep - 1); } }}
            onRemoveChain={() => { if (writable) { draft[purpose].splice(selectedChain, 1); selectedChain = Math.max(0, selectedChain - 1); selectedStep = 0; } }} />
        {:else}<p>{$t('authManagement.selectNode')}</p>{/if}
      </div>
    </div>
    {#if changed.length}<div class="auth-savebar"><p role="status">{$t('authManagement.unsaved')}</p><div class="auth-actions"><DialogActionButton disabled={busy || methodBusy} onclick={reload}>{$t('authManagement.discard')}</DialogActionButton><DialogActionButton variant="primary" disabled={!canSave} onclick={savePolicies}>{$t('authManagement.savePolicies')}</DialogActionButton></div></div>{/if}
    {#if managed}<details><summary>{$t('authManagement.details')}</summary><dl><dt>{$t('manage.userId')}</dt><dd><code>{inventory.user_id}</code></dd></dl></details>{/if}
  {/if}
</div>

{#if showPassword}
  {#if managed}<ResetUserPasswordDialog username={username ?? userId!} canDisableTwoFactor={canConfigure} onSave={resetPassword} onClose={() => { showPassword = false; }} />
  {:else}<ChangePasswordDialog username={authStore.username!} tip={$t('settings.password.tip')} onSubmit={updatePassword} onCancel={() => { showPassword = false; }} />{/if}
{/if}
