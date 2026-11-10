<script lang="ts">
  import { onDestroy } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { respondPublicKeyInteraction, cancelPublicKeyAuthentication, type AuthPrivateKeyInfo, type PublicKeyInteraction } from '$lib/api';
  import { publicKeyError } from '$lib/features/authentication/public-key-errors';
  import PrivateKeyField from '$lib/features/authentication/PrivateKeyField.svelte';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';

  let { onVerify, onCancel, onBack, onComplete, interactionId = null } : {
    onVerify?: (keyRef: string, passphrase: string, onInteraction: (event: PublicKeyInteraction) => void) => Promise<boolean>;
    onCancel: () => void;
    onBack?: () => void;
    onComplete?: (interactionId: string) => void;
    interactionId?: string | null;
  } = $props();
  let selection = $state<AuthPrivateKeyInfo | null>(null);
  let passphrase = $state('');
  let pending = $state<string | null>(null);
  let busy = $state(false);
  let submitting = $state(false);
  let error = $state('');
  const waiting = $derived(interactionId ?? pending);
  onDestroy(() => { passphrase = ''; });
  function receive(event: PublicKeyInteraction) {
    if (event.kind === 'select_key') { pending = event.interaction_id; selection = null; passphrase = ''; }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!selection || submitting || (busy && !waiting)) return;
    error = '';
    if (waiting) {
      const step = waiting;
      submitting = true;
      try {
        await respondPublicKeyInteraction(step, selection.keyRef, passphrase);
        passphrase = ''; selection = null;
        if (pending === step) pending = null;
        if (interactionId) onComplete?.(step);
      } catch (e) { error = publicKeyError(e, $t); }
      finally { submitting = false; }
      return;
    }
    busy = true;
    try { if (!(await onVerify!(selection.keyRef, passphrase, receive))) error = $t('authentication.failed'); }
    catch (e) {
      error = publicKeyError(e, $t);
      if (e !== 'publicKey.wrongPassphrase') selection = null;
    }
    finally { busy = false; passphrase = ''; pending = null; }
  }
  function cancel() { if (busy || interactionId) void cancelPublicKeyAuthentication().catch(() => {}); onCancel(); }
</script>

<form class="flex flex-col gap-5 p-5" onsubmit={submit}>
  {#if waiting}<p class="text-sm text-md3-on-surface-variant" role="status">{$t('publicKey.nextKey')}</p>{/if}
  <PrivateKeyField bind:selection bind:passphrase disabled={submitting || (busy && !waiting)} id="verification-key" />
  {#if error}<p role="alert" class="text-sm text-md3-error">{error}</p>{/if}
  <div class="flex justify-end gap-2">
    {#if onBack}<DialogActionButton disabled={busy} onclick={onBack}>{$t('common.back')}</DialogActionButton>{/if}
    <DialogActionButton onclick={cancel}>{$t('common.cancel')}</DialogActionButton>
    <DialogActionButton type="submit" variant="primary" disabled={submitting || !selection || (busy && !waiting) || (selection.encrypted && !passphrase)}>
      {#if busy && !waiting}<ProgressRing size={16} tone="inherit" label={$t('common.verifying')} />{/if}
      {$t(waiting ? 'publicKey.continue' : 'dialog.twoFactor.verify')}
    </DialogActionButton>
  </div>
</form>
