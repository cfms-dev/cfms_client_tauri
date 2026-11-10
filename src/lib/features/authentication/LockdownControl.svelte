<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { tick } from 'svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';

  interface Props {
    active: boolean;
    currentReason: string | null;
    busy: boolean;
    enableLabel: string;
    disableLabel: string;
    confirmLabel: string;
    cancelLabel: string;
    editLabel: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    remainingLabel: (count: number) => string;
    onToggle: (status: boolean, reason?: string | null) => Promise<boolean | void> | boolean | void;
  }

  let {
    active,
    currentReason,
    busy,
    enableLabel,
    disableLabel,
    confirmLabel,
    cancelLabel,
    editLabel,
    reasonLabel,
    reasonPlaceholder,
    remainingLabel,
    onToggle,
  }: Props = $props();

  let editorMode = $state<'enable' | 'edit' | null>(null);
  let reason = $state('');
  let reasonInput = $state<HTMLInputElement | null>(null);
  let primaryButton = $state<HTMLButtonElement | null>(null);

  const primaryLabel = $derived(
    editorMode ? confirmLabel : active ? disableLabel : enableLabel,
  );
  const remainingCharacters = $derived(1024 - reason.length);

  $effect(() => {
    if ((active && editorMode === 'enable') || (!active && editorMode === 'edit')) {
      resetReasonEditor();
    }
  });

  async function handlePrimaryAction() {
    if (busy) return;

    if (editorMode) {
      const applied = await onToggle(true, reason || null);
      if (applied === false) return;
      resetReasonEditor();
      return;
    }

    if (active) {
      await onToggle(false);
      return;
    }

    await openReasonEditor('enable');
  }

  async function openReasonEditor(mode: 'enable' | 'edit') {
    editorMode = mode;
    reason = mode === 'edit' ? currentReason ?? '' : '';
    await tick();
    reasonInput?.focus({ preventScroll: true });
  }

  function resetReasonEditor() {
    editorMode = null;
    reason = '';
  }

  async function cancelReasonEditor() {
    resetReasonEditor();
    await tick();
    primaryButton?.focus({ preventScroll: true });
  }

  function handleReasonKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    void cancelReasonEditor();
  }
</script>

<div class="lockdown-control">
  {#if editorMode}
    <form
      id="lockdown-reason-entry"
      class="lockdown-reason-entry"
      aria-label={reasonLabel}
      onsubmit={(event) => {
        event.preventDefault();
        void handlePrimaryAction();
      }}
    >
      <span class="lockdown-remaining-count" aria-live="polite" aria-atomic="true">
        {remainingLabel(remainingCharacters)}
      </span>
      <input class="cfms-native-field"
        bind:this={reasonInput}
        bind:value={reason}
        type="text"
        maxlength="1024"
        autocomplete="off"
        aria-label={reasonLabel}
        placeholder={reasonPlaceholder}
        disabled={busy}
        onkeydown={handleReasonKeydown}
      />
      <FluentButton data-fluent-owner="lib-components-lockdown-control"
        type="button"
        title={cancelLabel}
        aria-label={cancelLabel}
        disabled={busy}
        onclick={cancelReasonEditor}
        appearance="subtle"
        class="cfms-control-action explorer-command-button lockdown-cancel-button"
        iconOnly
      >
        <Icon name="close" size="18px" />
      </FluentButton>
    </form>
  {/if}

  {#if active && !editorMode}
    <FluentButton data-fluent-owner="lib-components-lockdown-control"
      type="button"
      title={editLabel}
      aria-label={editLabel}
      disabled={busy}
      onclick={() => openReasonEditor('edit')}
      appearance="subtle"
      class="cfms-control-action explorer-command-button lockdown-edit-button"
      iconOnly
    >
      <Icon name="edit" size="17px" />
    </FluentButton>
  {/if}

  <button data-fluent-owner="lib-components-lockdown-control"
    bind:this={primaryButton}
    type="button"
    class="cfms-control-action cfms-control-action--icon explorer-command-button lockdown-primary-button"
    data-active={active ? 'true' : undefined}
    data-confirming={editorMode ? 'true' : undefined}
    disabled={busy}
    aria-pressed={active}
    aria-expanded={Boolean(editorMode)}
    aria-controls={editorMode ? 'lockdown-reason-entry' : undefined}
    title={primaryLabel}
    aria-label={primaryLabel}
    onclick={handlePrimaryAction}
  >
    {#if busy}
      <ProgressRing size={17} strokeWidth={2.5} label={primaryLabel} />
    {:else if editorMode}
      <Icon name="check" size="19px" />
    {:else}
      <Icon name="security" size="18px" filled={active} />
    {/if}
  </button>
</div>

<style>
  .lockdown-control {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    gap: 8px;
  }

  :global(.lockdown-reason-entry) {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
    animation: reason-entry-in 160ms var(--motion-easing-emphasized-decelerate) both;
  }

  :global(.lockdown-reason-entry) input {
    width: clamp(12rem, 26vw, 22rem);
    min-width: 0;
    border: 1px solid var(--explorer-border-strong);
    border-radius: var(--borderRadiusMedium);
    padding: 0 0.65rem;
    outline: none;
    color: var(--explorer-text);
    background: color-mix(in srgb, var(--explorer-surface-raised) 96%, transparent);
    font: 0.75rem/1 var(--font-md3-sans);
    transition: border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
  }

  .lockdown-remaining-count {
    flex: none;
    color: var(--explorer-text-muted);
    font: 0.68rem/1.2 var(--font-md3-sans);
    white-space: nowrap;
  }

  :global(.lockdown-reason-entry) input::placeholder {
    color: var(--explorer-text-muted);
  }

  :global(.lockdown-reason-entry) input:focus {
    background: var(--explorer-surface-raised);
  }

  :global(.lockdown-reason-entry) input:is(:disabled, [disabled]) {
    opacity: 0.55;
  }

  :global(.lockdown-cancel-button[data-fluent-owner="lib-components-lockdown-control"]),
  :global(.lockdown-edit-button[data-fluent-owner="lib-components-lockdown-control"]),
  .lockdown-primary-button {
    flex: none;
    padding-inline: 0;
  }

  .lockdown-primary-button[data-active='true'] {
    color: var(--explorer-danger);
    background: color-mix(in srgb, var(--explorer-danger) 14%, transparent);
  }

  .lockdown-primary-button[data-confirming='true'] {
    color: var(--colorNeutralForegroundOnBrand);
    border-color: var(--colorBrandBackground);
    background: var(--colorBrandBackground);
  }

  .lockdown-primary-button[data-confirming='true']:hover:not(:is(:disabled, [disabled])) {
    background: var(--colorBrandBackgroundHover);
  }

  .lockdown-primary-button[data-confirming='true']:active:not(:is(:disabled, [disabled])) {
    background: var(--colorBrandBackgroundPressed);
  }

  @keyframes reason-entry-in {
    from { opacity: 0; transform: translateX(8px); }
    to { opacity: 1; transform: translateX(0); }
  }

  @media (max-width: 640px) {
    .lockdown-control {
      position: static;
    }

    :global(.lockdown-reason-entry) {
      position: absolute;
      top: calc(100% + 0.35rem);
      right: 0.45rem;
      left: 0.45rem;
      z-index: 70;
      padding: 0.4rem;
      border: 1px solid var(--explorer-border-strong);
      border-radius: var(--explorer-radius-medium);
      background: color-mix(in srgb, var(--explorer-surface-raised) 97%, transparent);
      box-shadow: var(--explorer-shadow);
      backdrop-filter: none;
      animation-name: reason-entry-mobile-in;
    }

    :global(.lockdown-reason-entry) input {
      width: auto;
      flex: 1;
    }
  }

  @keyframes reason-entry-mobile-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.99); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.lockdown-reason-entry) { animation: none; }
  }
</style>
