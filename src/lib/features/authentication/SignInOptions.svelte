<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import IconButton from '$lib/shared/ui/IconButton.svelte';
  let { value, disabled = false, onchange }: { value: 'password' | 'publickey'; disabled?: boolean; onchange: (value: 'password' | 'publickey') => void } = $props();
  const optionsId = $props.id();
  let expanded = $state(false);
</script>

<div class="sign-in-options">
  <button
    type="button"
    class="options-toggle"
    aria-expanded={expanded}
    aria-controls={optionsId}
    {disabled}
    onclick={() => (expanded = !expanded)}
  >
    {$t('publicKey.signInOptions')}
  </button>
  <div id={optionsId} class="options-row" hidden={!expanded} role="group" aria-label={$t('publicKey.signInOptions')}>
    <IconButton icon="password" label={$t('publicKey.passwordOption')} active={value === 'password'} {disabled} size={18} class="sign-in-method" onclick={() => onchange('password')} />
    <IconButton icon="passkey" label={$t('publicKey.keyOption')} active={value === 'publickey'} {disabled} size={18} class="sign-in-method" onclick={() => onchange('publickey')} />
  </div>
</div>

<style>
  .sign-in-options { min-width: 0; }
  .options-toggle { display: block; min-height: 32px; margin: 0 auto; padding: 0.25rem 0; border: 0; background: transparent; color: var(--explorer-accent); font-size: 12px; cursor: pointer; }
  .options-toggle:hover:not(:disabled) { color: var(--explorer-text); }
  .options-toggle:disabled { opacity: 0.5; cursor: default; }
  .options-row { display: flex; justify-content: center; gap: 8px; padding-top: 0.5rem; }
  .options-row[hidden] { display: none; }
  @media (pointer: coarse) {
    .options-toggle { min-height: 44px; }
    .options-row :global(.sign-in-method) { inline-size: 44px; block-size: 44px; }
  }
</style>
