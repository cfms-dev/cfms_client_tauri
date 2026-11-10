<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { onDestroy, onMount, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { publicKeyError } from '$lib/features/authentication/public-key-errors';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  let { onUnlock, onDiscard, onCancel }: { onUnlock: (password: string) => Promise<void>; onDiscard: () => Promise<void>; onCancel: () => void } = $props();
  let password = $state('');
  let busy = $state(false);
  let error = $state('');
  let confirmingDiscard = $state(false);
  let discarding = $state(false);
  let input = $state<HTMLInputElement>();
  let confirmationActions = $state<HTMLDivElement>();
  onMount(() => input?.focus());
  onDestroy(() => { password = ''; });
  async function setDiscardConfirmation(value: boolean) {
    confirmingDiscard = value; password = ''; error = '';
    await tick();
    if (value) confirmationActions?.querySelector<HTMLElement>('button, fluent-button')?.focus();
    else input?.focus();
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !password) return;
    busy = true; error = '';
    try { await onUnlock(password); }
    catch (e) { error = publicKeyError(e, $t); }
    finally { password = ''; busy = false; }
  }
  async function discard() {
    if (busy) return;
    busy = true; discarding = true; error = ''; password = '';
    try { await onDiscard(); }
    catch (e) { error = publicKeyError(e, $t); }
    finally { busy = false; discarding = false; }
  }
</script>
<ModalFrame title={$t('publicKey.migrationTitle')} onClose={onCancel} dismissible={!busy} maxWidth="max-w-md">
  {#if confirmingDiscard}
    <div class="flex flex-col gap-5 p-5">
      <p class="text-sm leading-6 text-md3-on-surface-variant">{$t('publicKey.discardBody')}</p>
      {#if error}<p role="alert" class="text-sm text-md3-error">{error}</p>{/if}
      <div bind:this={confirmationActions} class="flex flex-wrap justify-end gap-2">
        <DialogActionButton onclick={() => setDiscardConfirmation(false)} disabled={busy}>{$t('common.cancel')}</DialogActionButton>
        <DialogActionButton variant="danger" onclick={discard} disabled={busy}>
          {#if discarding}<ProgressRing size={16} tone="inherit" label={$t('publicKey.discardBusy')} />{/if}
          {$t(discarding ? 'publicKey.discardBusy' : 'publicKey.discardConfirm')}
        </DialogActionButton>
      </div>
    </div>
  {:else}
    <form class="flex flex-col gap-5 p-5" onsubmit={submit}>
      <p class="text-sm text-md3-on-surface-variant">{$t('publicKey.migrationBody')}</p>
      <MdOutlinedField inputId="preference-migration-password" label={$t('publicKey.previousPassword')}>
        <input bind:this={input} id="preference-migration-password" data-focus-ring="delegated" type="password" bind:value={password} disabled={busy} autocomplete="off" class="cfms-native-field w-full px-4 text-md3-on-surface" />
      </MdOutlinedField>
      {#if error}<p role="alert" class="text-sm text-md3-error">{error}</p>{/if}
      <FluentButton data-fluent-owner="lib-components-preference-unlock-dialog"
        type="button"
        disabled={busy}
        onclick={() => setDiscardConfirmation(true)}
        appearance="outline"
        class="self-start border-0 bg-transparent py-2 text-left text-sm text-md3-primary-emphasis underline underline-offset-4 disabled:opacity-50"
      >{$t('publicKey.discardLink')}</FluentButton>
      <div class="flex flex-wrap justify-end gap-2">
        <DialogActionButton onclick={onCancel} disabled={busy}>{$t('common.cancel')}</DialogActionButton>
        <DialogActionButton type="submit" variant="primary" disabled={busy || !password}>
          {#if busy}<ProgressRing size={16} tone="inherit" label={$t('common.verifying')} />{/if}
          {$t('publicKey.migrate')}
        </DialogActionButton>
      </div>
    </form>
  {/if}
</ModalFrame>
