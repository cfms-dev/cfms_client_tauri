<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { getManagedAuthKeys, pickAuthPrivateKey, releaseAuthPrivateKey, selectManagedAuthKey, type AuthPrivateKeyInfo, type ManagedAuthKeySummary } from '$lib/api';
  import { shortKeyIdentity } from '$lib/features/authentication/auth-policy-editor';
  import { publicKeyError } from '$lib/features/authentication/public-key-errors';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';

  let { selection = $bindable<AuthPrivateKeyInfo | null>(null), passphrase = $bindable(''), disabled = false, invalid = false, describedBy, id = 'auth-private-key' }:
    { selection?: AuthPrivateKeyInfo | null; passphrase?: string; disabled?: boolean; invalid?: boolean; describedBy?: string; id?: string } = $props();
  let choosing = $state(false);
  let choosingManagedId = $state<string | null>(null);
  let boundKeys = $state<ManagedAuthKeySummary[]>([]);
  let rescueKeys = $state<ManagedAuthKeySummary[]>([]);
  let error = $state('');
  let input = $state<HTMLInputElement>();
  let alive = true;
  const externalSelected = $derived(Boolean(selection && selection.source !== 'managed'));

  onMount(() => {
    void loadManagedKeys();
  });

  onDestroy(() => {
    alive = false;
    if (selection) void releaseAuthPrivateKey(selection.keyRef).catch(() => {});
    passphrase = '';
  });

  async function loadManagedKeys() {
    try {
      const inventory = await getManagedAuthKeys();
      if (!alive || !inventory) return;
      boundKeys = Array.isArray(inventory.boundKeys) ? inventory.boundKeys : [];
      rescueKeys = Array.isArray(inventory.rescueKeys) ? inventory.rescueKeys : [];
    } catch {
      if (!alive) return;
      boundKeys = [];
      rescueKeys = [];
    }
  }

  async function chooseManaged(keyId: string) {
    if (disabled || choosing || choosingManagedId) return;
    choosingManagedId = keyId;
    error = '';
    try {
      const next = await selectManagedAuthKey(keyId);
      if (!alive) { if (next) void releaseAuthPrivateKey(next.keyRef).catch(() => {}); return; }
      if (selection) void releaseAuthPrivateKey(selection.keyRef).catch(() => {});
      passphrase = '';
      selection = next;
    } catch (e) { if (alive) error = publicKeyError(e, $t); }
    finally { choosingManagedId = null; }
  }

  async function choose() {
    if (disabled || choosing || Boolean(choosingManagedId)) return;
    choosing = true;
    error = '';
    try {
      const next = await pickAuthPrivateKey();
      if (!alive) { if (next) void releaseAuthPrivateKey(next.keyRef).catch(() => {}); return; }
      if (!next) return;
      if (selection) void releaseAuthPrivateKey(selection.keyRef).catch(() => {});
      passphrase = '';
      selection = next;
      await tick();
      input?.focus();
    } catch (e) { if (alive) error = publicKeyError(e, $t); }
    finally { choosing = false; }
  }
</script>

<div class="private-key-field">
  <p class="key-help">{$t('publicKey.help')}</p>
  {#if boundKeys.length > 0}
    <div class="key-managed-group">
      <p class="key-section-title">{$t('publicKey.boundKeysTitle')}</p>
      {#each boundKeys as key (key.keyId)}
        {@const isSelected = selection?.source === 'managed' && selection?.keyId === key.keyId}
        <button
          type="button"
          class="key-picker"
          class:selected={isSelected}
          class:invalid={invalid && !selection}
          aria-pressed={isSelected}
          disabled={disabled || choosing || Boolean(choosingManagedId)}
          onclick={() => chooseManaged(key.keyId)}
        >
          <span class="key-picker-icon"><Icon name="passkey" size="24px" /></span>
          <span class="key-picker-copy">
            <strong>{key.label || key.algorithm}</strong>
            <span>{key.algorithm} · {$t(key.hardwareBacked ? 'publicKey.hardwareBackedBadge' : 'publicKey.deviceStoredBadge')} · {shortKeyIdentity(key.fingerprint)}</span>
          </span>
          {#if choosingManagedId === key.keyId}<ProgressRing size={18} label={$t('common.loading')} />{:else if isSelected}<Icon name="checkCircle" size="18px" />{/if}
        </button>
      {/each}
    </div>
  {/if}
  <button type="button" class="key-picker" class:selected={externalSelected} class:invalid onclick={choose} disabled={disabled || choosing || Boolean(choosingManagedId)} aria-describedby={`${id}-help${describedBy ? ` ${describedBy}` : ''}`}>
    <span class="key-picker-icon"><Icon name="passkey" size="24px" /></span>
    <span class="key-picker-copy">
      <strong>{externalSelected ? selection?.filename : $t('publicKey.chooseFile')}</strong>
      <span>{externalSelected ? selection?.algorithm : $t('publicKey.fileType')}</span>
    </span>
    {#if choosing}<ProgressRing size={18} label={$t('common.loading')} />{:else}<Icon name="folderOpen" size="18px" />{/if}
  </button>
  {#if rescueKeys.length > 0}
    <details class="key-rescue">
      <summary>{$t('publicKey.rescueTitle')}</summary>
      <div class="key-rescue-body">
        <p class="key-caption">{$t('publicKey.rescueHelp')}</p>
        {#each rescueKeys as key (key.keyId)}
          {@const isSelected = selection?.source === 'managed' && selection?.keyId === key.keyId}
          <button
            type="button"
            class="key-picker"
            class:selected={isSelected}
            aria-pressed={isSelected}
            disabled={disabled || choosing || Boolean(choosingManagedId)}
            onclick={() => chooseManaged(key.keyId)}
          >
            <span class="key-picker-icon"><Icon name="passkey" size="24px" /></span>
            <span class="key-picker-copy">
              <strong>{key.label || key.algorithm}</strong>
              <span>{$t('publicKey.rescueServerMeta', { values: { server: key.serverAddress, username: key.username } })} · {shortKeyIdentity(key.fingerprint)}</span>
            </span>
            {#if choosingManagedId === key.keyId}<ProgressRing size={18} label={$t('common.loading')} />{:else if isSelected}<Icon name="checkCircle" size="18px" />{/if}
          </button>
        {/each}
      </div>
    </details>
  {/if}
  {#if selection?.rescue}
    <p role="status" class="key-rescue-notice">{$t('publicKey.rescueSelectedNotice', { values: { server: selection.boundServer ?? '' } })}</p>
  {/if}
  <p id={`${id}-help`} class="key-caption">{$t('publicKey.localOnly')}</p>
  {#if selection}
    <details class="key-fingerprint">
      <summary>{$t('publicKey.fingerprint')}</summary>
      <code>{selection.fingerprint}</code>
    </details>
    {#if selection.encrypted}
      <MdOutlinedField inputId={`${id}-passphrase`} label={$t('publicKey.passphrase')} controlSize="large">
        <input bind:this={input} id={`${id}-passphrase`} data-focus-ring="delegated" type="password" bind:value={passphrase} {disabled} autocomplete="off" class="cfms-native-field key-passphrase" />
      </MdOutlinedField>
    {/if}
  {/if}
  {#if error}<p role="alert" class="key-error">{error}</p>{/if}
</div>

<style>
  .private-key-field { display: grid; gap: 12px; min-width: 0; }
  .key-help, .key-caption, .key-section-title { margin: 0; color: var(--color-md3-on-surface-variant); font-size: 12px; line-height: 1.55; }
  .key-section-title { font-weight: 600; }
  .key-managed-group, .key-rescue-body { display: grid; gap: 8px; }
  .key-rescue-body { padding-top: 8px; }
  .key-picker { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 60px; padding: 0.625rem 0.75rem; border: 1px solid var(--color-md3-outline); border-radius: 8px; background: var(--color-md3-surface-container); color: var(--color-md3-on-surface); text-align: left; cursor: pointer; transition: background 140ms ease, border-color 140ms ease; }
  .key-picker:hover:not(:disabled) { border-color: var(--color-md3-primary); background: var(--color-md3-surface-container-highest); }
  .key-picker.selected { border-color: var(--colorCompoundBrandForeground1, var(--color-md3-primary)); background: var(--color-md3-surface-container-highest); }
  .key-picker:disabled { opacity: 0.55; cursor: default; }
  .key-picker.invalid { border-color: var(--color-md3-error); }
  .key-picker-icon { display: grid; place-items: center; flex: none; color: var(--colorCompoundBrandForeground1); }
  .key-picker-copy { display: grid; gap: 4px; min-width: 0; flex: 1; }
  .key-picker-copy strong { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
  .key-picker-copy span { font-size: 12px; color: var(--color-md3-on-surface-variant); overflow-wrap: anywhere; }
  .key-fingerprint, .key-rescue { color: var(--color-md3-on-surface-variant); font-size: 12px; }
  .key-fingerprint summary, .key-rescue summary { cursor: pointer; padding: 0.25rem 0; }
  .key-fingerprint code { display: block; padding-top: 0.5rem; overflow-wrap: anywhere; font-family: var(--font-md3-mono); }
  .key-rescue-notice { margin: 0; font-size: 12px; line-height: 1.5; color: var(--colorCompoundBrandForeground1, var(--color-md3-primary)); }
  .key-error { margin: 0; font-size: 12px; color: var(--color-md3-error); }
  @media (pointer: coarse) { .key-picker { min-height: 64px; } .key-fingerprint summary, .key-rescue summary { min-height: 44px; display: flex; align-items: center; } }
  @media (prefers-reduced-motion: reduce) { .key-picker { transition: none; } }
</style>
