<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import type { AuthPolicyStep, AuthPurpose, UserAuthentication } from '$lib/api';
  import { authMethodName, canCompleteChain, credentialName } from '$lib/features/authentication/auth-policy-editor';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  let { inventory, purpose, chain, chainIndex, stepIndex, writable, onMethod, onToggle, onAddStep, onRemoveStep, onRemoveChain }: {
    inventory: UserAuthentication; purpose: AuthPurpose; chain: AuthPolicyStep[]; chainIndex: number; stepIndex: number; writable: boolean;
    onMethod: (method: string) => void; onToggle: (id: string) => void; onAddStep: () => void; onRemoveStep: () => void; onRemoveChain: () => void;
  } = $props();
  const step = $derived(chain[stepIndex]);
  const clientSupported = $derived((purpose === 'escalation' ? ['password', 'totp'] : purpose === 'login' ? ['password', 'publickey'] : ['password', 'totp', 'publickey']).includes(step?.method));
</script>

<fieldset class="auth-step-editor" disabled={!writable}>
  <legend>{$t('authManagement.selectedStep', { values: { alternative: chainIndex + 1, step: stepIndex + 1 } })}</legend>
  {#if step}
    <label>{$t('authManagement.method')}
      <select class="cfms-native-field" value={step.method} onchange={(event) => onMethod(event.currentTarget.value)}>
        {#if !inventory.methods[step.method]}<option value={step.method}>{authMethodName(step.method, $t)}</option>{/if}
        {#each Object.entries(inventory.methods) as [method, metadata]}{#if metadata.purposes.includes(purpose)}<option value={method}>{authMethodName(method, $t)}</option>{/if}{/each}
      </select>
    </label>
    {#if !clientSupported}<p class="auth-notice">{$t('authManagement.unavailableClient')}</p>{/if}
    <h3>{$t('authManagement.allowedCredentials')}</h3>
    {#each inventory.credentials.filter((c) => c.method === step.method) as credential (credential.credential_id)}
      <label class="auth-choice"><input type="checkbox" checked={step.credential_ids.includes(credential.credential_id)} onchange={() => onToggle(credential.credential_id)} /><span>{credentialName(credential, authMethodName(credential.method, $t))}{credential.active ? '' : ` · ${$t('authManagement.inactiveCredential')}`}</span></label>
    {:else}<p>{$t('authManagement.credentialsUnavailable')}</p>{/each}
    {#each step.credential_ids.filter((id) => !inventory.credentials.some((c) => c.credential_id === id && c.method === step.method)) as id}
      <label class="auth-choice"><input type="checkbox" checked onchange={() => onToggle(id)} /><span>{$t('authManagement.missingCredential')}</span></label>
    {/each}
    {#if !step.credential_ids.length}<p class="auth-error">{$t('authManagement.selectCredential')}</p>{/if}
    {#if step.method === 'publickey'}
      <p>{$t('authManagement.distinctKeys')}</p>
      {#if chain.length > 1 && !canCompleteChain(chain, inventory.credentials)}<p class="auth-notice">{$t('authManagement.distinctKeysUnavailable')}</p>{/if}
      <DialogActionButton disabled={!writable} onclick={onAddStep}>{$t('authManagement.addStep')}</DialogActionButton>
    {/if}
    <div class="auth-editor-actions">
      {#if chain.length > 1}<DialogActionButton disabled={!writable} onclick={onRemoveStep}>{$t('authManagement.removeStep')}</DialogActionButton>{/if}
      <DialogActionButton variant="danger" disabled={!writable} onclick={onRemoveChain}>{$t('authManagement.removeAlternative')}</DialogActionButton>
    </div>
  {/if}
</fieldset>
