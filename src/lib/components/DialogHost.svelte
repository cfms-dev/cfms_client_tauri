<script lang="ts">
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import { dialogStore } from '$lib/dialogs.svelte';

  let inputValue = $state('');
  let applyChoiceToAll = $state(false);
  let lastDialogId = $state<number | null>(null);
  let inputElement = $state<HTMLInputElement | HTMLTextAreaElement | null>(null);

  $effect(() => {
    const request = dialogStore.current;
    if (!request || request.id === lastDialogId) return;
    lastDialogId = request.id;
    inputValue = request.defaultValue;
    applyChoiceToAll = false;
    tick().then(() => {
      inputElement?.focus();
      if (request.kind === 'prompt' && request.selectOnOpen) {
        inputElement?.select();
      }
    });
  });

  function close() {
    dialogStore.resolve(dialogStore.current?.kind === 'confirm' ? false : null);
  }

  function submit() {
    const request = dialogStore.current;
    if (!request) return;
    if (request.kind === 'confirm') {
      dialogStore.resolve(true);
    } else if (request.kind === 'choice') {
      dialogStore.resolve(null);
    } else {
      dialogStore.resolve(inputValue);
    }
  }

  function choose(value: string) {
    dialogStore.resolve({ value, applyToAll: applyChoiceToAll });
  }
</script>

{#if dialogStore.current}
  <ModalFrame
    title={dialogStore.current.title}
    maxWidth={dialogStore.current.multiline ? 'max-w-2xl' : dialogStore.current.kind === 'choice' ? 'max-w-xl' : 'max-w-md'}
    closeLabel={$t('common.close')}
    onClose={close}
  >
    <form class={dialogStore.current.kind === 'choice' ? 'space-y-5 p-6' : 'space-y-5 p-5'} onsubmit={(event) => { event.preventDefault(); submit(); }}>
      <p class="whitespace-pre-line text-sm leading-6 text-md3-on-surface-variant">{dialogStore.current.message}</p>

      {#if dialogStore.current.kind === 'prompt'}
        {#if dialogStore.current.multiline}
          <textarea
            bind:this={inputElement}
            bind:value={inputValue}
            rows="9"
            class="min-h-44 w-full resize-y rounded-md border border-md3-outline bg-md3-field px-3 py-2 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/25"
            placeholder={dialogStore.current.placeholder}
          ></textarea>
        {:else}
          <input
            bind:this={inputElement}
            bind:value={inputValue}
            type={dialogStore.current.inputType}
            class="w-full rounded-md border border-md3-outline bg-md3-field px-3 py-2 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/25"
            placeholder={dialogStore.current.placeholder}
          />
        {/if}
      {/if}

      {#if dialogStore.current.kind === 'choice'}
        {#if dialogStore.current.details.length > 0}
          <section class="overflow-hidden rounded-xl border border-md3-outline bg-md3-surface-container-low">
            {#if dialogStore.current.detailLabel}
              <div class="border-b border-md3-outline bg-md3-surface-container-high/55 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-md3-on-surface-variant">
                {dialogStore.current.detailLabel}
              </div>
            {/if}
            <div class="max-h-48 divide-y divide-md3-outline overflow-y-auto">
              {#each dialogStore.current.details as detail (detail.label)}
                <div class="flex items-center gap-3 px-4 py-3">
                  <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-md3-primary-container/60 text-md3-on-primary-container">
                    <Icon name={detail.kind === 'directory' ? 'folder' : 'filePresent'} size="22px" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-semibold text-md3-on-surface">{detail.label}</span>
                    {#if detail.meta}
                      <span class="mt-0.5 block text-xs text-md3-on-surface-variant">{detail.meta}</span>
                    {/if}
                  </span>
                  {#if detail.badge}
                    <span class="shrink-0 rounded-full bg-md3-error-container px-2.5 py-1 text-[11px] font-semibold text-md3-on-error-container">
                      {detail.badge}
                    </span>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}

        <div class="overflow-hidden rounded-xl border border-md3-outline" aria-label={dialogStore.current.title}>
          {#each dialogStore.current.choices as choice, index (choice.value)}
            <button
              type="button"
              class={`group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-md3-primary ${
                index > 0 ? 'border-t border-md3-outline' : ''
              } bg-md3-surface-container-low hover:bg-md3-primary-container/25`}
              onclick={() => choose(choice.value)}
            >
              <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-md3-surface-container-highest text-md3-on-surface-variant transition-colors group-hover:bg-md3-primary-container group-hover:text-md3-on-primary-container">
                <Icon name={choice.icon ?? (choice.intent === 'danger' ? 'refresh' : 'block')} size="22px" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-semibold text-md3-on-surface">{choice.label}</span>
                {#if choice.description}
                  <span class="mt-0.5 block text-xs leading-5 text-md3-on-surface-variant">{choice.description}</span>
                {/if}
              </span>
              <Icon name="breadcrumbSep" size="20px" class="text-md3-on-surface-variant/55 transition-transform group-hover:translate-x-0.5" />
            </button>
          {/each}
        </div>
      {/if}

      <div class={`flex gap-3 border-t border-md3-outline pt-4 ${dialogStore.current.kind === 'choice' ? 'flex-col sm:flex-row sm:items-center' : 'justify-end'}`}>
        {#if dialogStore.current.kind === 'choice' && dialogStore.current.applyToAllLabel}
          <label class="group flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-xs text-md3-on-surface-variant">
            <input
              type="checkbox"
              class="peer sr-only"
              bind:checked={applyChoiceToAll}
            />
            <span class={`grid size-5 shrink-0 place-items-center rounded border transition-colors ${applyChoiceToAll
              ? 'border-md3-primary bg-md3-primary text-md3-on-primary'
              : 'border-md3-outline bg-md3-surface-container-high group-hover:border-md3-primary'
            }`} aria-hidden="true">
              {#if applyChoiceToAll}
                <Icon name="check" size="14px" />
              {/if}
            </span>
            <span>{dialogStore.current.applyToAllLabel}</span>
          </label>
        {/if}
        <div class={dialogStore.current.kind === 'choice' ? 'ml-auto flex justify-end gap-2' : 'flex justify-end gap-2'}>
          <button
            type="button"
            class={`rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${dialogStore.current.kind === 'choice'
              ? 'text-md3-primary hover:bg-md3-primary/10'
              : 'border border-md3-outline bg-md3-surface-container-high text-md3-on-surface-variant hover:bg-md3-surface-container-highest hover:text-md3-on-surface'
            }`}
            onclick={close}
          >
            {dialogStore.current.cancelLabel}
          </button>
          {#if dialogStore.current.kind !== 'choice'}
            <button
              type="submit"
              class={`rounded-md px-4 py-2 text-sm font-medium transition-all hover:brightness-110 ${
                dialogStore.current.danger
                  ? 'bg-md3-error-action text-md3-on-error-action'
                  : 'bg-md3-primary text-md3-on-primary'
              }`}
            >
              {dialogStore.current.confirmLabel}
            </button>
          {/if}
        </div>
      </div>
    </form>
  </ModalFrame>
{/if}
