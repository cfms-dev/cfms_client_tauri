<script lang="ts">
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  interface Props {
    segments: Array<{ label: string; path: string }>;
    lookupEnabled: boolean;
    knownPath: string | null;
    busy: boolean;
    error: string | null;
    onNavigate: (path: string) => void;
    onSubmit: (path: string) => void;
    onCancel: () => void;
    onBeginEdit: () => void;
  }

  let {
    segments,
    lookupEnabled,
    knownPath,
    busy,
    error,
    onNavigate,
    onSubmit,
    onCancel,
    onBeginEdit,
  }: Props = $props();

  let editing = $state(false);
  let value = $state('');
  let input = $state<HTMLInputElement | null>(null);

  export async function beginEdit() {
    if (!lookupEnabled || editing) return;
    value = knownPath ?? '';
    editing = true;
    onBeginEdit();
    await tick();
    input?.focus();
    input?.select();
  }

  export function finishEdit() {
    editing = false;
  }

  function cancelEdit() {
    editing = false;
    onCancel();
  }

  function submit() {
    onSubmit(value);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || busy) return;
    event.preventDefault();
    cancelEdit();
  }

  function handleBlankPointer(event: PointerEvent) {
    if (event.target === event.currentTarget) void beginEdit();
  }

  $effect(() => {
    if (!lookupEnabled) editing = false;
  });
</script>

<div
  class="file-address"
  class:file-address--editing={editing}
  class:file-address--error={Boolean(error)}
  aria-busy={busy}
>
  {#if editing}
    <form class="file-address__form" aria-label={$t('files.addressLabel')} onsubmit={(event) => { event.preventDefault(); submit(); }}>
      <input
        bind:this={input}
        bind:value
        class="file-address__input"
        type="text"
        inputmode="url"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        readonly={busy}
        aria-label={$t('files.addressLabel')}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby="file-address-supporting-text"
        placeholder={$t('files.addressPlaceholder')}
        onkeydown={handleKeydown}
      />
      <button class="file-address__action" type="button" disabled={busy} title={$t('common.cancel')} aria-label={$t('common.cancel')} onclick={cancelEdit}>
        <Icon name="close" size="18px" />
      </button>
      <button class="file-address__action file-address__action--submit" type="submit" disabled={busy} title={$t('files.addressGo')} aria-label={$t('files.addressGo')}>
        {#if busy}
          <ProgressRing size={17} strokeWidth={2.5} label={$t('files.addressResolving')} tone="inherit" />
        {:else}
          <Icon name="done" size="18px" />
        {/if}
      </button>
    </form>
    <span
      id="file-address-supporting-text"
      class="file-address__support"
      class:file-address__support--error={Boolean(error)}
      role={error ? 'alert' : undefined}
      aria-live="polite"
    >
      {error ?? $t('files.addressHelp')}
    </span>
  {:else}
    <div class="file-address__view" role="group" aria-label={$t('files.addressLabel')} onpointerup={handleBlankPointer}>
      <div class="file-address__breadcrumb">
        <Breadcrumb {segments} {onNavigate} />
      </div>
      {#if lookupEnabled}
        <button
          class="file-address__action file-address__edit"
          type="button"
          title={$t('files.editAddress')}
          aria-label={$t('files.editAddress')}
          aria-keyshortcuts="Alt+D F4"
          onclick={() => beginEdit()}
        >
          <Icon name="edit" size="17px" />
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .file-address {
    min-width: 0;
    width: 100%;
    font-family: var(--font-md3-sans);
  }

  .file-address__view,
  .file-address__form {
    display: flex;
    min-width: 0;
    min-height: 34px;
    align-items: center;
  }

  .file-address__view {
    cursor: text;
  }

  .file-address__breadcrumb {
    min-width: 0;
    flex: 1;
    overflow-x: auto;
    padding-inline: 0.7rem 0.25rem;
    scrollbar-width: none;
  }

  .file-address__breadcrumb::-webkit-scrollbar {
    display: none;
  }

  .file-address__form {
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px var(--explorer-accent);
  }

  .file-address--error .file-address__form {
    box-shadow: inset 0 0 0 1px var(--color-md3-error);
  }

  .file-address__input {
    min-width: 0;
    height: 34px;
    flex: 1;
    border: 0 !important;
    border-radius: inherit !important;
    padding: 0 0.7rem;
    outline: 0;
    color: var(--explorer-text) !important;
    background: transparent !important;
    font-family: var(--font-md3-mono);
    font-size: 0.82rem;
  }

  .file-address__input::placeholder {
    color: var(--explorer-text-muted);
    opacity: 1;
  }

  .file-address__action {
    display: inline-grid;
    width: 32px;
    height: 32px;
    flex: none;
    place-items: center;
    border: 0;
    border-radius: var(--explorer-radius-small);
    color: var(--explorer-text-muted);
    background: transparent;
    transition:
      color var(--motion-duration-short4) var(--motion-easing-standard),
      background var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate);
  }

  .file-address__action:hover:not(:disabled) {
    color: var(--explorer-text);
    background: color-mix(in srgb, var(--explorer-text) 9%, transparent);
  }

  .file-address__action:focus-visible {
    outline: 2px solid var(--explorer-accent);
    outline-offset: -2px;
  }

  .file-address__action:active:not(:disabled) {
    transform: scale(0.92);
  }

  .file-address__action:disabled {
    opacity: 0.55;
  }

  .file-address__action--submit {
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  .file-address__edit {
    margin-inline-end: 1px;
  }

  .file-address__support {
    display: block;
    padding: 0.22rem 0.7rem 0.05rem;
    color: var(--explorer-text-muted);
    font-size: 0.69rem;
    line-height: 1.35;
  }

  .file-address__support--error {
    color: var(--color-md3-error);
  }

  @media (pointer: coarse) {
    .file-address__action {
      width: 40px;
      height: 40px;
    }

    .file-address__view,
    .file-address__form,
    .file-address__input {
      min-height: 40px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .file-address__action {
      transition: none;
    }
  }
</style>
