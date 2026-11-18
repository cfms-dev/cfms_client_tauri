<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import type { Snippet } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { ManagedAuthKeyInventory, ManagedAuthKeySummary, UserAuthentication } from '$lib/api';
  import { AUTH_PURPOSES, authMethodName, credentialName, shortKeyIdentity, type AuthCredential } from '$lib/features/authentication/auth-policy-editor';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';

  let { inventory, managedKeys = null, currentUsername = null, writable, busy, managed = false, canChangePassword, onPassword, onRegister, onGenerate, onEdit, onDelete, authenticator }: {
    inventory: UserAuthentication;
    managedKeys?: ManagedAuthKeyInventory | null;
    currentUsername?: string | null;
    writable: boolean;
    busy: boolean;
    canChangePassword: boolean;
    managed?: boolean;
    onPassword: () => void;
    onRegister: (key: string, label: string) => Promise<boolean>;
    onGenerate?: (label: string) => Promise<boolean>;
    onEdit: (credential: AuthCredential) => void;
    onDelete: (credential: AuthCredential) => void;
    authenticator: Snippet;
  } = $props();
  let adding = $state(false);
  let publicKey = $state('');
  let label = $state('');
  let pendingAction = $state<'generate' | 'register' | null>(null);
  function usage(id: string): string {
    const purposes = AUTH_PURPOSES.filter((purpose) => inventory.policies[purpose].chains.some((chain) => chain.some((step) => step.credential_ids.includes(id))));
    return purposes.length ? $t('authManagement.usedFor', { values: { purposes: purposes.map((purpose) => $t(`authManagement.purposes.${purpose}`)).join(' · ') } }) : $t('authManagement.notUsed');
  }
  function findManagedKey(credential: AuthCredential): ManagedAuthKeySummary | undefined {
    if (managed || !managedKeys) return undefined;
    const byCredential = managedKeys.boundKeys.find(
      (k) => k.credentialId === credential.credential_id,
    );
    if (byCredential) return byCredential;
    if (!credential.key_identity) return undefined;
    return managedKeys.boundKeys.find(
      (k) => !k.credentialId
        && k.fingerprint === credential.key_identity
        && (!currentUsername || k.username === currentUsername),
    );
  }
  async function register(event: SubmitEvent) {
    event.preventDefault();
    if (pendingAction || !writable || !publicKey.trim()) return;
    pendingAction = 'register';
    try {
      if (await onRegister(publicKey.trim(), label.trim())) {
        publicKey = '';
        label = '';
        adding = false;
      }
    } finally {
      pendingAction = null;
    }
  }
  async function generate() {
    if (pendingAction || !writable || !managedKeys?.storageAvailable || !onGenerate) return;
    pendingAction = 'generate';
    try {
      if (await onGenerate(label.trim())) {
        publicKey = '';
        label = '';
        adding = false;
      }
    } finally {
      pendingAction = null;
    }
  }
  const outlinedId = $props.id();
</script>

<div class="auth-method-list">
  <section class="auth-method" aria-labelledby="auth-password-heading">
    <div class="auth-method-heading">
      <Icon name="password" size="22px" />
      <div class="auth-grow"><h2 id="auth-password-heading">{$t('authentication.password')}</h2><p>{$t(managed ? 'authManagement.managedPasswordHelp' : 'authManagement.passwordHelp')}</p></div>
      <DialogActionButton disabled={!canChangePassword || busy} onclick={onPassword}>{$t(managed ? 'manage.resetPassword' : 'settings.password.action')}</DialogActionButton>
    </div>
    <p class="auth-usage auth-state">{$t(inventory.credentials.some((c) => c.method === 'password' && c.active) ? 'authManagement.registered' : 'authManagement.notRegistered')}</p>
    {#each inventory.credentials.filter((c) => c.method === 'password') as credential (credential.credential_id)}
      <p class="auth-usage">{usage(credential.credential_id)}</p>
    {/each}
  </section>
  <section class="auth-method" aria-labelledby="auth-totp-heading">
    <div class="auth-method-heading"><Icon name="verifiedUser" size="22px" /><div class="auth-grow"><h2 id="auth-totp-heading">{$t('authManagement.totpName')}</h2><p>{$t('authManagement.totpHelp')}</p></div></div>
    {#each inventory.credentials.filter((c) => c.method === 'totp' && c.active) as credential (credential.credential_id)}<p class="auth-usage">{usage(credential.credential_id)}</p>{/each}
    {@render authenticator()}
  </section>
  <section class="auth-method" aria-labelledby="auth-keys-heading">
    <div class="auth-method-heading"><Icon name="passkey" size="22px" /><div class="auth-grow"><h2 id="auth-keys-heading">{$t('authentication.publickey')}</h2><p>{$t('authManagement.publickeyHelp')}</p></div><DialogActionButton disabled={!writable} onclick={() => { adding = !adding; }} aria-expanded={adding}>{$t(adding ? 'authManagement.cancelAddKey' : 'authManagement.addKey')}</DialogActionButton></div>
    <ul class="auth-key-list">
      {#each inventory.credentials.filter((c) => c.method === 'publickey') as credential (credential.credential_id)}
        {@const localKey = findManagedKey(credential)}
        <li>
          <div class="auth-row">
            <div class="auth-grow">
              <div class="auth-key-title-row">
                <strong>{credentialName(credential, $t('authentication.publickey'))}</strong>
                {#if localKey}
                  <span class="auth-managed-badge" class:auth-managed-badge--hardware={localKey.hardwareBacked}>
                    <Icon name={localKey.hardwareBacked ? 'verifiedUser' : 'passkey'} size="14px" />
                    <span>{$t(localKey.hardwareBacked ? 'authManagement.managedHardwareKeyBadge' : 'authManagement.managedDeviceKeyBadge')}</span>
                  </span>
                {/if}
              </div>
              <p>{credential.active ? $t('authManagement.registered') : $t('authManagement.inactiveCredential')}{credential.label && credential.key_identity ? ` · ${shortKeyIdentity(credential.key_identity)}` : ''}</p>
              <p>{usage(credential.credential_id)}</p>
            </div>
            <div class="auth-actions"><DialogActionButton disabled={!writable} onclick={() => onEdit(credential)}>{$t('authManagement.editLabel')}</DialogActionButton><DialogActionButton variant="danger" disabled={!writable} onclick={() => onDelete(credential)}>{$t('common.delete')}</DialogActionButton></div>
          </div>
          <details><summary>{$t('authManagement.details')}</summary><dl><dt>{$t('authManagement.credentialId')}</dt><dd><code>{credential.credential_id}</code></dd><dt>{$t('authManagement.fingerprint')}</dt><dd><code>{credential.key_identity ?? '—'}</code></dd></dl></details>
        </li>
      {:else}<p class="auth-empty">{$t('authManagement.noCredentials')}</p>{/each}
    </ul>
    {#if adding}
      <form class="auth-form auth-inset" onsubmit={register}>
        <p>{$t('authManagement.keyHelp')}</p>
        <div>
          <MdOutlinedField inputId={`${outlinedId}-2`} label={$t('authManagement.keyLabel')} disabled={!writable || Boolean(pendingAction)}>
            <input id={`${outlinedId}-2`} data-focus-ring="delegated" class="cfms-native-field" bind:value={label} disabled={!writable || Boolean(pendingAction)} maxlength="255" />
          </MdOutlinedField>
        </div>
        {#if !managed}
          <div class="auth-generate-panel">
            {#if managedKeys?.storageAvailable}
              <div class="auth-generate-copy">
                <span class="cfms-icon-text__icon" aria-hidden="true">
                  <Icon name={managedKeys.hardwareBacked ? 'verifiedUser' : 'storage'} size="16px" />
                </span>
                <p>{$t(managedKeys.hardwareBacked ? 'authManagement.generateHardwareHelp' : 'authManagement.generateDeviceHelp')}</p>
              </div>
            {:else}
              <div class="auth-generate-copy auth-generate-copy--warning">
                <span class="cfms-icon-text__icon" aria-hidden="true">
                  <Icon name="warningAmber" size="16px" />
                </span>
                <p role="status" class="auth-notice">{$t('authManagement.generateUnavailable')}</p>
              </div>
            {/if}
            <div class="auth-actions">
              <DialogActionButton variant="tonal" disabled={!writable || Boolean(pendingAction) || !managedKeys?.storageAvailable} onclick={generate}>
                {#if pendingAction === 'generate'}<ProgressRing size={16} tone="inherit" label={$t('common.loading')} />{/if}
                {$t('authManagement.generateKey')}
              </DialogActionButton>
            </div>
          </div>
          <div class="auth-method-or" aria-hidden="true"><span>{$t('authManagement.orDivider')}</span></div>
        {/if}
        <div>
          <MdOutlinedField inputId={`${outlinedId}-1`} label={$t('authManagement.publicKey')} disabled={!writable || Boolean(pendingAction)}>
            <textarea id={`${outlinedId}-1`} data-focus-ring="delegated" class="cfms-native-field" bind:value={publicKey} disabled={!writable || Boolean(pendingAction)} rows="3" spellcheck="false" placeholder="ssh-ed25519 AAAA…"></textarea>
          </MdOutlinedField>
        </div>
        <div class="auth-actions">
          <DialogActionButton type="submit" variant="primary" disabled={!writable || Boolean(pendingAction) || !publicKey.trim()}>
            {#if pendingAction === 'register'}<ProgressRing size={16} tone="inherit" label={$t('common.loading')} />{/if}
            {$t('authManagement.registerKey')}
          </DialogActionButton>
        </div>
      </form>
    {/if}
  </section>
  {#each inventory.credentials.filter((c) => !['password', 'totp', 'publickey'].includes(c.method)) as credential (credential.credential_id)}
    <section class="auth-method"><h2>{credentialName(credential, authMethodName(credential.method, $t))}</h2><p>{usage(credential.credential_id)}</p><p>{$t('authManagement.unavailableClient')}</p><details><summary>{$t('authManagement.details')}</summary><code>{credential.credential_id}</code></details></section>
  {/each}
</div>
