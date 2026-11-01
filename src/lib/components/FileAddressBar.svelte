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
  let form = $state<HTMLFormElement | null>(null);

  export async function beginEdit() {
    if (!lookupEnabled || editing || busy) return;
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
    if (busy) return;
    onSubmit(value);
  }

  function clearInput() {
    value = '';
    input?.focus();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || busy) return;
    event.preventDefault();
    cancelEdit();
  }

  function handleBlankPointer(event: PointerEvent) {
    if (event.button > 0 || !(event.target instanceof Element)) return;
    if (event.target.closest('button, [data-breadcrumb-segment], [data-breadcrumb-separator]')) return;
    void beginEdit();
  }

  $effect(() => {
    if (!lookupEnabled) editing = false;
  });

  $effect(() => {
    if (!editing || !form) return;
    const editingForm = form;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (editing && !event.composedPath().includes(editingForm)) cancelEdit();
    };
    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  });
</script>

<div
  class="file-address"
  class:file-address--editing={editing}
  class:file-address--error={Boolean(error)}
  aria-busy={busy}
>
  {#if editing}
    <form bind:this={form} class="file-address__form cfms-field-surface" aria-label={$t('files.addressLabel')} onsubmit={(event) => { event.preventDefault(); submit(); }}>
      <input
        bind:this={input}
        bind:value
        class="cfms-native-field file-address__input"
        data-focus-ring="delegated"
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
      {#if busy}
        <span class="file-address__progress">
          <ProgressRing size={17} strokeWidth={2.5} label={$t('files.addressResolving')} tone="inherit" />
        </span>
      {:else if value.length > 0}
        <button class="file-address__action" type="button" title={$t('common.clear')} aria-label={$t('common.clear')} onclick={clearInput}>
          <Icon name="close" size="18px" />
        </button>
      {/if}
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
    <div class="file-address__view cfms-field-surface" class:file-address__view--editable={lookupEnabled && !busy} role="group" aria-label={$t('files.addressLabel')} onpointerup={handleBlankPointer}>
      <div class="file-address__breadcrumb">
        <Breadcrumb {segments} {onNavigate} collapseOverflow />
      </div>
      {#if lookupEnabled}
        <button
          class="file-address__blank"
          type="button"
          title={$t('files.editAddress')}
          aria-label={$t('files.editAddress')}
          aria-keyshortcuts="Alt+D F4"
          disabled={busy}
          onclick={() => beginEdit()}
        ></button>
      {:else}
        <span class="file-address__blank" aria-hidden="true"></span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .file-address {
    --file-address-height: var(--files-field-height, 32px);
    --breadcrumb-target-height: calc(var(--file-address-height) - 2px);
    min-width: 0;
    width: 100%;
    font-family: var(--font-md3-sans);
  }

  .file-address__view,
  .file-address__form {
    display: flex;
    min-width: 0;
    box-sizing: border-box;
    height: var(--file-address-height);
    align-items: center;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-small);
    background: transparent;
  }

  .file-address__view--editable {
    cursor: text;
  }

  .file-address__breadcrumb {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    padding-inline: 0 4px;
  }

  .file-address__form {
    border-color: var(--explorer-accent);
    box-shadow: inset 0 0 0 1px var(--explorer-accent);
  }

  .file-address--error .file-address__form {
    border-color: var(--color-md3-error);
    box-shadow: inset 0 0 0 1px var(--color-md3-error);
  }

  .file-address__input {
    min-width: 0;
    height: 100%;
    flex: 1;
    border: 0;
    border-radius: var(--borderRadiusMedium);
    padding: 0 0.7rem;
    outline: 0;
    color: var(--explorer-text);
    background: transparent;
    font-family: var(--font-md3-mono);
    font-size: 14px;
    line-height: 20px;
  }

  .file-address__input::placeholder {
    color: var(--explorer-text-muted);
    opacity: 1;
  }

  .file-address__action,
  .file-address__progress {
    display: inline-grid;
    width: calc(var(--file-address-height) - 2px);
    height: calc(var(--file-address-height) - 2px);
    flex: none;
    place-items: center;
    border: 0;
    border-radius: var(--borderRadiusMedium);
    color: var(--explorer-text-muted);
    background: transparent;
  }

  .file-address__action {
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
    transform: none;
  }

  .file-address__blank {
    flex: none;
    align-self: stretch;
    width: 32px;
    padding: 0;
    border: 0;
    border-radius: var(--borderRadiusMedium);
    background: transparent;
    cursor: inherit;
  }

  .file-address__blank:focus-visible {
    outline: 2px solid var(--explorer-accent);
    outline-offset: -2px;
  }

  .file-address__support {
    display: block;
    padding: 0.22rem 0.7rem 0.05rem;
    color: var(--explorer-text-muted);
    font-size: 12px;
    line-height: 1.35;
  }

  .file-address__support--error {
    color: var(--color-md3-error);
  }

  @media (pointer: coarse) {
    .file-address {
      --file-address-height: var(--files-field-height, 44px);
    }

    .file-address__input {
      font-size: 16px;
    }

    .file-address__blank { width: 44px; }
  }

  @media (forced-colors: active) {
    .file-address__view,
    .file-address__form { color: FieldText; background: Field; border-color: ButtonText; }
    .file-address__form:focus-within { outline: 2px solid Highlight; outline-offset: -2px; box-shadow: none; }
    .file-address__input { color: FieldText; }
    .file-address__blank:focus-visible { outline-color: Highlight; }
  }

  @media (prefers-reduced-motion: reduce) {
    .file-address__action {
      transition: none;
    }
  }
</style>
