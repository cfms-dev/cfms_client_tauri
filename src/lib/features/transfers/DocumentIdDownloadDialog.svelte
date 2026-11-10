<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import { _ as t } from 'svelte-i18n';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';

  let {
    open,
    busy = false,
    error = '',
    onClose,
    onSubmit,
  }: {
    open: boolean;
    busy?: boolean;
    error?: string;
    onClose: () => void;
    onSubmit: (documentId: string) => void | Promise<void>;
  } = $props();

  let documentId = $state('');
  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) documentId = '';
    wasOpen = open;
  });

  function handleClose() {
    if (!busy) onClose();
  }

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const normalizedDocumentId = documentId.trim();
    if (!normalizedDocumentId || busy) return;
    void onSubmit(normalizedDocumentId);
  }
  const outlinedId = $props.id();
</script>

{#if open}
  <ModalFrame
    title={$t('tasks.downloadByIdTitle')}
    maxWidth="max-w-md"
    closeLabel={$t('common.close')}
    dismissible={!busy}
    closeOnBackdrop={!busy}
    onClose={handleClose}
  >
    <form class="space-y-5 p-5" aria-busy={busy} onsubmit={handleSubmit}>
      <div class="flex items-start gap-3 text-md3-on-surface-variant">
        <span class="cfms-icon-text__icon shrink-0 text-md3-primary-emphasis" style="--cfms-icon-line-height: 24px">
          <Icon name="download" size="22px" />
        </span>
        <p id="document-id-download-description" class="text-sm leading-6">
          {$t('tasks.downloadByIdDescription')}
        </p>
      </div>

      <div class="block">
        <MdOutlinedField inputId={`${outlinedId}-1`} label={$t('files.documentId')} disabled={busy}>
          <input id={`${outlinedId}-1`} data-focus-ring="delegated"
            required
            type="text"
            autocomplete="off"
            autocapitalize="none"
            spellcheck={false}
            placeholder={$t('tasks.downloadByIdPlaceholder')}
            aria-describedby="document-id-download-description{error ? ' document-id-download-error' : ''}"
            aria-invalid={error ? 'true' : undefined}
            class="cfms-native-field document-id-input w-full px-3 font-mono text-sm text-md3-on-surface transition disabled:cursor-not-allowed disabled:opacity-60"
            bind:value={documentId}
            disabled={busy}
          />
        </MdOutlinedField>
      </div>

      {#if error}
        <div
          id="document-id-download-error"
          class="flex items-start gap-2 rounded-lg bg-md3-error-container/55 px-3 py-2.5 text-sm leading-5 text-md3-on-error-container"
          role="alert"
        >
          <span class="cfms-icon-text__icon shrink-0"><Icon name="errorFilled" size="18px" /></span>
          <span class="min-w-0 break-words">{error}</span>
        </div>
      {/if}

      <div class="flex justify-end gap-2 border-t border-md3-outline pt-4">
        <DialogActionButton disabled={busy} onclick={handleClose}>
          {$t('common.cancel')}
        </DialogActionButton>
        <DialogActionButton
          type="submit"
          variant="primary"
          disabled={busy || !documentId.trim()}
        >
          {#if busy}
            <ProgressRing
              size={16}
              strokeWidth={2}
              tone="inherit"
              label={$t('tasks.downloadByIdSubmitting')}
            />
          {:else}
            <Icon name="download" size="18px" />
          {/if}
          {$t(busy ? 'tasks.downloadByIdSubmitting' : 'tasks.downloadByIdAction')}
        </DialogActionButton>
      </div>
    </form>
  </ModalFrame>
{/if}

<style>
  .document-id-input {
    font-variant-ligatures: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .document-id-input { transition: none; }
  }
</style>
