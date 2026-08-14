<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import DialogActionButton from '$lib/components/DialogActionButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

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
        <span class="mt-0.5 shrink-0 text-md3-primary-emphasis">
          <Icon name="download" size="22px" />
        </span>
        <p id="document-id-download-description" class="text-sm leading-6">
          {$t('tasks.downloadByIdDescription')}
        </p>
      </div>

      <label class="block">
        <span class="mb-1.5 block text-sm font-semibold text-md3-on-surface">
          {$t('files.documentId')}
        </span>
        <input
          required
          type="text"
          autocomplete="off"
          autocapitalize="none"
          spellcheck={false}
          placeholder={$t('tasks.downloadByIdPlaceholder')}
          aria-describedby="document-id-download-description{error ? ' document-id-download-error' : ''}"
          aria-invalid={error ? 'true' : undefined}
          class="document-id-input w-full rounded-xl border border-md3-outline bg-md3-field px-3 py-2.5 font-mono text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
          bind:value={documentId}
          disabled={busy}
        />
      </label>

      {#if error}
        <div
          id="document-id-download-error"
          class="flex items-start gap-2 rounded-lg bg-md3-error-container/55 px-3 py-2.5 text-sm leading-5 text-md3-on-error-container"
          role="alert"
        >
          <span class="mt-0.5 shrink-0"><Icon name="errorFilled" size="18px" /></span>
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
    min-height: 42px;
    font-variant-ligatures: none;
  }

  @media (pointer: coarse) {
    .document-id-input { min-height: 48px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .document-id-input { transition: none; }
  }
</style>
