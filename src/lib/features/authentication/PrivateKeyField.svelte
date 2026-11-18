<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { getManagedAuthKeys, pickAuthPrivateKey, releaseAuthPrivateKey, selectManagedAuthKey, type AuthPrivateKeyInfo, type ManagedAuthKeySummary } from '$lib/api';
  import { shortKeyIdentity } from '$lib/features/authentication/auth-policy-editor';
  import { publicKeyError } from '$lib/features/authentication/public-key-errors';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';

  let { selection = $bindable<AuthPrivateKeyInfo | null>(null), passphrase = $bindable(''), username = '', disabled = false, invalid = false, describedBy, id = 'auth-private-key' }:
    { selection?: AuthPrivateKeyInfo | null; passphrase?: string; username?: string | null; disabled?: boolean; invalid?: boolean; describedBy?: string; id?: string } = $props();
  let choosing = $state(false);
  let choosingManagedId = $state<string | null>(null);
  let boundKeys = $state<ManagedAuthKeySummary[]>([]);
  let rescueKeys = $state<ManagedAuthKeySummary[]>([]);
  let inventoryLoaded = $state(false);
  let error = $state('');
  let input = $state<HTMLInputElement>();
  let alive = true;

  const trimmedUsername = $derived((username ?? '').trim());
  const visibleBoundKeys = $derived(
    trimmedUsername ? boundKeys.filter((key) => key.username === trimmedUsername) : [],
  );
  const matchingRescueKeys = $derived(
    trimmedUsername ? rescueKeys.filter((key) => key.username === trimmedUsername) : [],
  );
  const otherRescueKeys = $derived(
    trimmedUsername ? rescueKeys.filter((key) => key.username !== trimmedUsername) : [],
  );
  const totalRescueCount = $derived(matchingRescueKeys.length + otherRescueKeys.length);
  const externalSelected = $derived(Boolean(selection && selection.source !== 'managed'));

  onMount(() => {
    void loadManagedKeys();
  });

  onDestroy(() => {
    alive = false;
    if (selection) void releaseAuthPrivateKey(selection.keyRef).catch(() => {});
    passphrase = '';
  });

  $effect(() => {
    const activeUsername = trimmedUsername;
    const loaded = inventoryLoaded;
    const matchingIds = new Set(visibleBoundKeys.map((key) => key.keyId));
    const current = untrack(() => selection);
    if (!loaded || current?.source !== 'managed') return;
    if (!activeUsername || (!current.rescue && (!current.keyId || !matchingIds.has(current.keyId)))) {
      void releaseAuthPrivateKey(current.keyRef).catch(() => {});
      selection = null;
      passphrase = '';
    }
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
    } finally {
      if (alive) inventoryLoaded = true;
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

{#snippet keyOption(key: ManagedAuthKeySummary, isRescue: boolean)}
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
    <span class="key-picker-icon" aria-hidden="true">
      <Icon name={key.hardwareBacked ? 'verifiedUser' : 'passkey'} size="22px" />
    </span>
    <span class="key-picker-copy">
      <span class="key-picker-title-row">
        <strong>{key.label || key.algorithm}</strong>
        <span class="key-trust-pill" class:key-trust-pill--hardware={key.hardwareBacked}>
          {$t(key.hardwareBacked ? 'publicKey.hardwareBackedBadge' : 'publicKey.deviceStoredBadge')}
        </span>
      </span>
      <span class="key-picker-meta">
        {#if isRescue}
          {$t('publicKey.rescueServerMeta', { values: { server: key.serverAddress, username: key.username } })}
        {:else}
          @{key.username} · {key.algorithm}
        {/if}
        · <code>{shortKeyIdentity(key.fingerprint)}</code>
      </span>
    </span>
    <span class="key-picker-status" aria-hidden="true">
      {#if choosingManagedId === key.keyId}
        <ProgressRing size={18} label={$t('common.loading')} />
      {:else if isSelected}
        <Icon name="checkCircle" filled size="18px" />
      {/if}
    </span>
  </button>
{/snippet}

<div class="private-key-field">
  <p class="key-help">{$t('publicKey.help')}</p>
  {#if visibleBoundKeys.length > 0}
    <div class="key-managed-group">
      <p class="key-section-title">{$t('publicKey.boundKeysTitle')}</p>
      {#each visibleBoundKeys as key (key.keyId)}
        {@render keyOption(key, false)}
      {/each}
    </div>
    <div class="key-divider" aria-hidden="true">
      <span>{$t('publicKey.externalKeyDivider')}</span>
    </div>
  {/if}
  <button
    type="button"
    class="key-picker"
    class:key-picker--secondary={visibleBoundKeys.length > 0 && !externalSelected}
    class:selected={externalSelected}
    class:invalid={invalid && !selection}
    onclick={choose}
    disabled={disabled || choosing || Boolean(choosingManagedId)}
    aria-describedby={`${id}-help${describedBy ? ` ${describedBy}` : ''}`}
  >
    <span class="key-picker-icon" aria-hidden="true"><Icon name="passkey" size="22px" /></span>
    <span class="key-picker-copy">
      <strong>{externalSelected ? selection?.filename : $t('publicKey.chooseFile')}</strong>
      <span class="key-picker-meta">{externalSelected ? selection?.algorithm : $t('publicKey.fileType')}</span>
    </span>
    <span class="key-picker-status" aria-hidden="true">
      {#if choosing}<ProgressRing size={18} label={$t('common.loading')} />{:else}<Icon name="folderOpen" size="18px" />{/if}
    </span>
  </button>
  {#if totalRescueCount > 0}
    <details class="key-rescue">
      <summary>
        <span>{$t('publicKey.rescueTitle')}</span>
        <span class="key-rescue-count">{totalRescueCount}</span>
      </summary>
      <div class="key-rescue-body">
        <p class="key-caption">{$t('publicKey.rescueHelp')}</p>
        {#each matchingRescueKeys as key (key.keyId)}
          {@render keyOption(key, true)}
        {/each}
        {#if otherRescueKeys.length > 0}
          <details class="key-rescue-other">
            <summary>{$t('publicKey.rescueOtherAccounts', { values: { count: otherRescueKeys.length } })}</summary>
            <div class="key-rescue-body">
              {#each otherRescueKeys as key (key.keyId)}
                {@render keyOption(key, true)}
              {/each}
            </div>
          </details>
        {/if}
      </div>
    </details>
  {/if}
  {#if selection?.rescue}
    <div role="status" class="key-rescue-notice">
      <span class="cfms-icon-text__icon" aria-hidden="true"><Icon name="info" size="16px" /></span>
      <span>{$t('publicKey.rescueSelectedNotice', { values: { server: selection.boundServer ?? '' } })}</span>
    </div>
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
  .key-help, .key-caption, .key-section-title { margin: 0; color: var(--colorNeutralForeground3); font-size: 12px; line-height: 16px; }
  .key-section-title { font-weight: 600; color: var(--colorNeutralForeground2); }
  .key-managed-group, .key-rescue-body { display: grid; gap: 8px; }
  .key-rescue-body { padding-top: 8px; }
  .key-divider { display: flex; align-items: center; gap: 10px; color: var(--colorNeutralForeground3); font-size: 12px; line-height: 16px; }
  .key-divider::before, .key-divider::after { content: ''; flex: 1; height: 1px; background: var(--colorNeutralStroke2); }
  .key-picker { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 60px; padding: 10px 12px; border: 1px solid var(--colorNeutralStroke1); border-radius: var(--borderRadiusXLarge); background: var(--colorNeutralBackground1); color: var(--colorNeutralForeground1); text-align: left; cursor: pointer; transition: background-color var(--durationFaster, 120ms) var(--curveEasyEase, ease), border-color var(--durationFaster, 120ms) var(--curveEasyEase, ease), box-shadow var(--durationFaster, 120ms) var(--curveEasyEase, ease); }
  .key-picker--secondary { border-style: dashed; border-color: var(--colorNeutralStroke2); background: transparent; min-height: 52px; }
  .key-picker:hover:not(:disabled) { border-color: var(--colorNeutralStroke1Hover); border-style: solid; background: var(--colorNeutralBackground1Hover); }
  .key-picker.selected { border-color: var(--colorBrandStroke1); border-style: solid; background: color-mix(in srgb, var(--colorBrandBackground2) 45%, var(--colorNeutralBackground1)); box-shadow: inset 0 0 0 1px var(--colorBrandStroke1); }
  .key-picker:disabled { opacity: 0.55; cursor: default; }
  .key-picker.invalid { border-color: var(--colorStatusDangerBorder1); border-style: solid; }
  .key-picker-icon { display: grid; place-items: center; flex: none; color: var(--colorBrandForeground1); }
  .key-picker--secondary .key-picker-icon { color: var(--colorNeutralForeground2); }
  .key-picker-copy { display: grid; gap: 4px; min-width: 0; flex: 1; }
  .key-picker-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
  .key-picker-copy strong { font-size: 14px; line-height: 20px; font-weight: 600; overflow-wrap: anywhere; }
  .key-picker-meta { font-size: 12px; line-height: 16px; color: var(--colorNeutralForeground3); overflow-wrap: anywhere; }
  .key-picker-meta code { font-family: var(--fontFamilyMonospace); font-size: 12px; }
  .key-picker-status { display: grid; place-items: center; flex: none; color: var(--colorBrandForeground1); }
  .key-trust-pill { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 12px; line-height: 16px; font-weight: 500; background: var(--colorNeutralBackground3); color: var(--colorNeutralForeground2); border: 1px solid var(--colorNeutralStroke2); }
  .key-trust-pill--hardware { background: var(--colorBrandBackground2); color: var(--colorBrandForeground1); border-color: var(--colorBrandStroke2, var(--colorNeutralStroke1)); }
  .key-fingerprint, .key-rescue, .key-rescue-other { color: var(--colorNeutralForeground3); font-size: 12px; line-height: 16px; }
  .key-fingerprint summary, .key-rescue summary, .key-rescue-other summary { cursor: pointer; padding: 4px 0; }
  .key-rescue > summary { display: inline-flex; align-items: center; gap: 8px; font-weight: 500; color: var(--colorNeutralForeground2); }
  .key-rescue-count { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 18px; padding: 0 6px; border-radius: 999px; background: var(--colorNeutralBackground3); color: var(--colorNeutralForeground2); font-size: 12px; line-height: 16px; }
  .key-rescue-other { margin-top: 4px; padding-left: 8px; border-left: 1px solid var(--colorNeutralStroke2); }
  .key-fingerprint code { display: block; padding-top: 8px; overflow-wrap: anywhere; font-family: var(--fontFamilyMonospace); }
  .key-rescue-notice { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 8px 12px; border-radius: var(--borderRadiusXLarge); border: 1px solid var(--colorBrandStroke2, var(--colorNeutralStroke2)); background: color-mix(in srgb, var(--colorBrandBackground2) 38%, transparent); font-size: 12px; line-height: 16px; color: var(--colorBrandForeground1); }
  .key-error { margin: 0; font-size: 12px; line-height: 16px; color: var(--colorStatusDangerForeground1); }
  @media (pointer: coarse) {
    .key-picker { min-height: 64px; }
    .key-fingerprint summary, .key-rescue summary, .key-rescue-other summary { min-height: 44px; display: flex; align-items: center; }
  }
  @media (forced-colors: active) {
    .key-picker.selected { border-color: Highlight; box-shadow: inset 0 0 0 1px Highlight; }
    .key-rescue-notice { border-color: Highlight; background: Canvas; color: CanvasText; }
  }
  @media (prefers-reduced-motion: reduce) { .key-picker { transition: none; } }
</style>
