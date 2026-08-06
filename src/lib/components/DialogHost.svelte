<script lang="ts">
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import DialogActionButton from '$lib/components/DialogActionButton.svelte';
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
    <form class={dialogStore.current.kind === 'choice' ? 'choice-dialog' : 'space-y-5 p-5'} onsubmit={(event) => { event.preventDefault(); submit(); }}>
      <p class={dialogStore.current.kind === 'choice'
        ? 'choice-dialog-message whitespace-pre-line'
        : 'whitespace-pre-line text-sm leading-6 text-md3-on-surface-variant'}>{dialogStore.current.message}</p>

      {#if dialogStore.current.kind === 'prompt'}
        {#if dialogStore.current.multiline}
          <textarea
            bind:this={inputElement}
            bind:value={inputValue}
            maxlength={dialogStore.current.maxLength}
            rows="9"
            class="min-h-44 w-full resize-y rounded-md border border-md3-outline bg-md3-field px-3 py-2 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/25"
            placeholder={dialogStore.current.placeholder}
          ></textarea>
        {:else}
          <input
            bind:this={inputElement}
            bind:value={inputValue}
            maxlength={dialogStore.current.maxLength}
            type={dialogStore.current.inputType}
            class="w-full rounded-md border border-md3-outline bg-md3-field px-3 py-2 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/25"
            placeholder={dialogStore.current.placeholder}
          />
        {/if}
      {/if}

      {#if dialogStore.current.kind === 'choice'}
        {#if dialogStore.current.details.length > 0}
          <section class="choice-conflict-summary">
            {#if dialogStore.current.detailLabel}
              <div class="choice-conflict-progress">
                {dialogStore.current.detailLabel}
              </div>
            {/if}
            <div class="choice-conflict-list">
              {#each dialogStore.current.details as detail (detail.label)}
                <div class="choice-conflict-item">
                  <span class="choice-conflict-icon">
                    <Icon name={detail.kind === 'directory' ? 'folder' : 'filePresent'} size="22px" />
                  </span>
                  <span class="choice-conflict-copy">
                    <span class="choice-conflict-name">{detail.label}</span>
                    {#if detail.meta}
                      <span class="choice-conflict-meta">{detail.meta}</span>
                    {/if}
                  </span>
                  {#if detail.badge}
                    <span class="choice-conflict-badge">
                      {detail.badge}
                    </span>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}

        <div class="choice-actions" aria-label={dialogStore.current.title}>
          {#each dialogStore.current.choices as choice, index (choice.value)}
            <!-- svelte-ignore a11y_autofocus -->
            <button
              type="button"
              data-focus-ring="delegated"
              data-intent={choice.intent ?? 'neutral'}
              autofocus={choice.intent === 'primary' || (
                index === 0 && !dialogStore.current.choices.some((item) => item.intent === 'primary')
              )}
              class={`choice-action choice-action--${choice.intent ?? 'neutral'} ${index > 0 ? 'choice-action--divided' : ''}`}
              onclick={() => choose(choice.value)}
            >
              <span class="choice-action-icon">
                <Icon name={choice.icon ?? (choice.intent === 'danger' ? 'refresh' : 'block')} size="22px" />
              </span>
              <span class="choice-action-copy">
                <span class="choice-action-label">{choice.label}</span>
                {#if choice.description}
                  <span class="choice-action-description">{choice.description}</span>
                {/if}
              </span>
              <Icon name="breadcrumbSep" size="20px" class="choice-action-arrow" />
            </button>
          {/each}
        </div>
      {/if}

      <div class={dialogStore.current.kind === 'choice' ? 'choice-footer' : 'flex justify-end gap-3 border-t border-md3-outline pt-4'}>
        {#if dialogStore.current.kind === 'choice' && dialogStore.current.applyToAllLabel}
          <label class="choice-apply-all">
            <input
              type="checkbox"
              data-focus-ring="delegated"
              class="peer sr-only"
              bind:checked={applyChoiceToAll}
            />
            <span class={`choice-checkbox ${applyChoiceToAll
              ? 'border-md3-primary bg-md3-primary text-md3-on-primary'
              : ''
            }`} aria-hidden="true">
              {#if applyChoiceToAll}
                <Icon name="check" size="14px" />
              {/if}
            </span>
            <span>{dialogStore.current.applyToAllLabel}</span>
          </label>
        {/if}
        <div class={dialogStore.current.kind === 'choice' ? 'choice-footer-actions' : 'flex justify-end gap-2'}>
          <DialogActionButton onclick={close}>
            {dialogStore.current.cancelLabel}
          </DialogActionButton>
          {#if dialogStore.current.kind !== 'choice'}
            <DialogActionButton
              type="submit"
              variant={dialogStore.current.danger ? 'danger' : 'primary'}
            >
              {dialogStore.current.confirmLabel}
            </DialogActionButton>
          {/if}
        </div>
      </div>
    </form>
  </ModalFrame>
{/if}

<style>
  .choice-dialog {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.25rem 1.5rem 1rem;
  }

  .choice-dialog-message {
    max-width: 68ch;
    margin: 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .choice-conflict-summary {
    overflow: hidden;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 8px);
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 44%, transparent);
  }

  .choice-conflict-progress {
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 78%, transparent);
    padding: 0.5rem 0.75rem;
    color: var(--color-md3-on-surface-variant);
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 58%, transparent);
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.25;
  }

  .choice-conflict-list {
    max-height: 12rem;
    overflow-y: auto;
  }

  .choice-conflict-item {
    display: grid;
    grid-template-columns: 2.25rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
  }

  .choice-conflict-item + .choice-conflict-item {
    border-top: 1px solid var(--color-md3-outline);
  }

  .choice-conflict-icon,
  .choice-action-icon {
    display: grid;
    width: 2.25rem;
    height: 2.25rem;
    flex: none;
    place-items: center;
    border-radius: var(--explorer-radius-small, 5px);
  }

  .choice-conflict-icon {
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  .choice-conflict-copy,
  .choice-action-copy {
    min-width: 0;
  }

  .choice-conflict-name,
  .choice-conflict-meta,
  .choice-action-label,
  .choice-action-description {
    display: block;
    overflow-wrap: anywhere;
  }

  .choice-conflict-name {
    color: var(--color-md3-on-surface);
    font-size: 0.875rem;
    font-weight: 650;
    line-height: 1.35;
  }

  .choice-conflict-meta {
    margin-top: 0.2rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.45;
  }

  .choice-conflict-badge {
    align-self: center;
    border-radius: 9999px;
    padding: 0.22rem 0.55rem;
    color: var(--color-md3-on-error-container);
    background: var(--color-md3-error-container);
    font-size: 0.6875rem;
    font-weight: 650;
    line-height: 1.25;
    white-space: nowrap;
  }

  .choice-actions {
    overflow: hidden;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 8px);
    background: color-mix(in srgb, var(--color-md3-surface-container) 84%, transparent);
  }

  .choice-action {
    display: grid;
    width: 100%;
    min-height: 4.125rem;
    grid-template-columns: 2.25rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    border: 0;
    padding: 0.75rem;
    color: var(--color-md3-on-surface);
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition:
      color 120ms ease,
      background-color 120ms ease,
      box-shadow 120ms ease;
  }

  .choice-action--divided {
    border-top: 1px solid var(--color-md3-outline);
  }

  .choice-action:focus-visible {
    position: relative;
    z-index: 1;
    outline: none;
    box-shadow: inset 0 0 0 2px var(--color-md3-primary-emphasis, var(--color-md3-primary));
  }

  .choice-action-icon {
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-surface-container-highest);
    transition:
      color 120ms ease,
      background-color 120ms ease;
  }

  .choice-action-label {
    font-size: 0.875rem;
    font-weight: 650;
    line-height: 1.35;
  }

  .choice-action-description {
    margin-top: 0.2rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.45;
  }

  :global(.choice-action-arrow) {
    color: var(--color-md3-on-surface-variant);
    opacity: 0.56;
    transition:
      color 120ms ease,
      opacity 120ms ease,
      transform 120ms ease;
  }

  .choice-action--primary {
    background: color-mix(in srgb, var(--color-md3-primary-container) 30%, transparent);
  }

  .choice-action--primary .choice-action-icon {
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  .choice-action--primary .choice-action-label {
    color: var(--color-md3-primary-emphasis, var(--color-md3-primary));
  }

  .choice-action--danger .choice-action-icon {
    color: var(--color-md3-on-error-container);
    background: var(--color-md3-error-container);
  }

  .choice-action--danger .choice-action-label {
    color: var(--color-md3-error);
  }

  .choice-action--primary:hover {
    background: color-mix(in srgb, var(--color-md3-primary-container) 68%, transparent);
  }

  .choice-action--danger:hover {
    background: color-mix(in srgb, var(--color-md3-error-container) 48%, transparent);
  }

  .choice-action--neutral:hover {
    background: var(--color-md3-surface-container-high);
  }

  .choice-action:hover :global(.choice-action-arrow) {
    color: currentColor;
    opacity: 0.9;
    transform: translateX(2px);
  }

  .choice-action:active {
    background: var(--color-md3-surface-container-highest);
  }

  .choice-footer {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    border-top: 1px solid var(--color-md3-outline);
    padding-top: 0.875rem;
  }

  .choice-apply-all {
    display: flex;
    min-width: 0;
    min-height: 2.75rem;
    flex: 1;
    align-items: center;
    gap: 0.625rem;
    border-radius: var(--explorer-radius-small, 5px);
    padding: 0.375rem 0;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.4;
    cursor: pointer;
  }

  .choice-checkbox {
    display: grid;
    width: 1.25rem;
    height: 1.25rem;
    flex: none;
    place-items: center;
    border: 1px solid var(--color-md3-outline-variant);
    border-radius: 4px;
    color: transparent;
    background: var(--color-md3-surface-container-high);
    transition:
      color 120ms ease,
      border-color 120ms ease,
      background-color 120ms ease,
      box-shadow 120ms ease;
  }

  .choice-apply-all:hover .choice-checkbox {
    border-color: var(--color-md3-primary);
  }

  .choice-apply-all input:focus-visible + .choice-checkbox {
    box-shadow: 0 0 0 2px var(--color-md3-surface-container), 0 0 0 4px var(--color-md3-primary);
  }

  .choice-footer-actions {
    display: flex;
    flex: none;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-left: auto;
  }

  @media (max-width: 39.999rem) {
    .choice-dialog {
      gap: 0.875rem;
      padding: 1rem;
    }

    .choice-conflict-item {
      grid-template-columns: 2.25rem minmax(0, 1fr);
    }

    .choice-conflict-badge {
      grid-column: 2;
      justify-self: start;
    }

    .choice-footer {
      align-items: stretch;
      flex-direction: column;
      gap: 0.5rem;
    }

    .choice-footer-actions {
      align-self: flex-end;
      margin-left: 0;
    }
  }

  @media (pointer: coarse) {
    .choice-action {
      min-height: 4.75rem;
      padding-block: 0.875rem;
    }

    .choice-apply-all {
      min-height: 3rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .choice-action,
    .choice-action-icon,
    .choice-checkbox,
    :global(.choice-action-arrow) {
      transition-duration: 0.01ms;
    }

    .choice-action:hover :global(.choice-action-arrow) {
      transform: none;
    }
  }
</style>
