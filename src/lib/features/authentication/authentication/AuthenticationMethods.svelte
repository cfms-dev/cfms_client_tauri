<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import type { Snippet } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { UserAuthentication } from '$lib/api';
  import { AUTH_PURPOSES, authMethodName, credentialName, shortKeyIdentity, type AuthCredential } from '$lib/features/authentication/auth-policy-editor';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';

  let { inventory, writable, busy, managed = false, canChangePassword, onPassword, onRegister, onEdit, onDelete, authenticator }: {
    inventory: UserAuthentication; writable: boolean; busy: boolean; canChangePassword: boolean;
    managed?: boolean;
    onPassword: () => void; onRegister: (key: string, label: string) => Promise<boolean>;
    onEdit: (credential: AuthCredential) => void; onDelete: (credential: AuthCredential) => void;
    authenticator: Snippet;
  } = $props();
  let adding = $state(false);
  let publicKey = $state('');
  let label = $state('');
  function usage(id: string): string {
    const purposes = AUTH_PURPOSES.filter((purpose) => inventory.policies[purpose].chains.some((chain) => chain.some((step) => step.credential_ids.includes(id))));
    return purposes.length ? $t('authManagement.usedFor', { values: { purposes: purposes.map((purpose) => $t(`authManagement.purposes.${purpose}`)).join(' · ') } }) : $t('authManagement.notUsed');
  }
  async function register(event: SubmitEvent) {
    event.preventDefault();
    if (await onRegister(publicKey.trim(), label.trim())) { publicKey = ''; label = ''; adding = false; }
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
        <li>
          <div class="auth-row">
            <div class="auth-grow"><strong>{credentialName(credential, $t('authentication.publickey'))}</strong><p>{credential.active ? $t('authManagement.registered') : $t('authManagement.inactiveCredential')}{credential.label && credential.key_identity ? ` · ${shortKeyIdentity(credential.key_identity)}` : ''}</p><p>{usage(credential.credential_id)}</p></div>
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
          <MdOutlinedField inputId={`${outlinedId}-1`} label={$t('authManagement.publicKey')} disabled={!writable}>
            <textarea id={`${outlinedId}-1`} data-focus-ring="delegated" class="cfms-native-field" bind:value={publicKey} disabled={!writable} rows="3" spellcheck="false" placeholder="ssh-ed25519 AAAA…"></textarea>
          </MdOutlinedField>
        </div>
        <div>
          <MdOutlinedField inputId={`${outlinedId}-2`} label={$t('authManagement.keyLabel')} disabled={!writable}>
            <input id={`${outlinedId}-2`} data-focus-ring="delegated" class="cfms-native-field" bind:value={label} disabled={!writable} maxlength="255" />
          </MdOutlinedField>
        </div>
        <div class="auth-actions"><DialogActionButton type="submit" variant="primary" disabled={!writable || !publicKey.trim()}>{$t('authManagement.registerKey')}</DialogActionButton></div>
      </form>
    {/if}
  </section>
  {#each inventory.credentials.filter((c) => !['password', 'totp', 'publickey'].includes(c.method)) as credential (credential.credential_id)}
    <section class="auth-method"><h2>{credentialName(credential, authMethodName(credential.method, $t))}</h2><p>{usage(credential.credential_id)}</p><p>{$t('authManagement.unavailableClient')}</p><details><summary>{$t('authManagement.details')}</summary><code>{credential.credential_id}</code></details></section>
  {/each}
</div>
