<script lang="ts">
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import { dialogStore } from '$lib/dialogs.svelte';

  let inputValue = $state('');
  let lastDialogId = $state<number | null>(null);
  let inputElement = $state<HTMLInputElement | HTMLTextAreaElement | null>(null);

  $effect(() => {
    const request = dialogStore.current;
    if (!request || request.id === lastDialogId) return;
    lastDialogId = request.id;
    inputValue = request.defaultValue;
    tick().then(() => inputElement?.focus());
  });

  function close() {
    dialogStore.resolve(dialogStore.current?.kind === 'confirm' ? false : null);
  }

  function submit() {
    const request = dialogStore.current;
    if (!request) return;
    dialogStore.resolve(request.kind === 'confirm' ? true : inputValue);
  }
</script>

{#if dialogStore.current}
  <ModalFrame
    title={dialogStore.current.title}
    maxWidth={dialogStore.current.multiline ? 'max-w-2xl' : 'max-w-md'}
    closeLabel={$t('common.close')}
    onClose={close}
  >
    <form class="space-y-5 p-5" onsubmit={(event) => { event.preventDefault(); submit(); }}>
      <p class="text-sm leading-6 text-md3-on-surface-variant">{dialogStore.current.message}</p>

      {#if dialogStore.current.kind === 'prompt'}
        {#if dialogStore.current.multiline}
          <textarea
            bind:this={inputElement}
            bind:value={inputValue}
            rows="9"
            class="min-h-44 w-full resize-y rounded-lg border border-md3-outline bg-md3-field px-3 py-2 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/25"
            placeholder={dialogStore.current.placeholder}
          ></textarea>
        {:else}
          <input
            bind:this={inputElement}
            bind:value={inputValue}
            type={dialogStore.current.inputType}
            class="w-full rounded-lg border border-md3-outline bg-md3-field px-3 py-2 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/25"
            placeholder={dialogStore.current.placeholder}
          />
        {/if}
      {/if}

      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-full px-4 py-2 text-sm font-medium text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high"
          onclick={close}
        >
          {dialogStore.current.cancelLabel}
        </button>
        <button
          type="submit"
          class={`rounded-full px-4 py-2 text-sm font-medium transition-all hover:brightness-110 ${
            dialogStore.current.danger
              ? 'bg-md3-error-container text-md3-on-error-container'
              : 'bg-md3-primary text-md3-on-primary'
          }`}
        >
          {dialogStore.current.confirmLabel}
        </button>
      </div>
    </form>
  </ModalFrame>
{/if}
