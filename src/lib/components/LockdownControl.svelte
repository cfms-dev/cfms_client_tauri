<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

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
      <input
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
      <button
        type="button"
        class="explorer-command-button lockdown-cancel-button"
        title={cancelLabel}
        aria-label={cancelLabel}
        disabled={busy}
        onclick={cancelReasonEditor}
      >
        <Icon name="close" size="18px" />
      </button>
    </form>
  {/if}

  {#if active && !editorMode}
    <button
      type="button"
      class="explorer-command-button lockdown-edit-button"
      title={editLabel}
      aria-label={editLabel}
      disabled={busy}
      onclick={() => openReasonEditor('edit')}
    >
      <Icon name="edit" size="17px" />
    </button>
  {/if}

  <button
    bind:this={primaryButton}
    type="button"
    class="explorer-command-button lockdown-primary-button"
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
      <Icon name="supervisedUserCircleOff" size="18px" />
    {/if}
  </button>
</div>

<style>
  .lockdown-control {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.4rem;
  }

  .lockdown-reason-entry {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 0.3rem;
    animation: reason-entry-in 160ms var(--motion-easing-emphasized-decelerate) both;
  }

  .lockdown-reason-entry input {
    width: clamp(12rem, 26vw, 22rem);
    height: 34px;
    min-width: 0;
    border: 1px solid var(--explorer-border-strong);
    border-radius: var(--explorer-radius-small);
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

  .lockdown-reason-entry input::placeholder {
    color: var(--explorer-text-muted);
  }

  .lockdown-reason-entry input:focus {
    border-color: var(--explorer-accent);
    background: var(--explorer-surface-raised);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--explorer-accent) 18%, transparent);
  }

  .lockdown-reason-entry input:disabled {
    opacity: 0.55;
  }

  .lockdown-cancel-button,
  .lockdown-edit-button,
  .lockdown-primary-button {
    width: 34px;
    flex: none;
    padding-inline: 0;
  }

  .lockdown-primary-button[data-active='true'] {
    color: var(--explorer-danger);
    background: color-mix(in srgb, var(--explorer-danger) 14%, transparent);
  }

  .lockdown-primary-button[data-confirming='true'] {
    color: var(--explorer-on-accent, white);
    border-color: var(--explorer-accent);
    background: var(--explorer-accent);
  }

  .lockdown-primary-button[data-confirming='true']:hover:not(:disabled) {
    background: color-mix(in srgb, var(--explorer-accent) 88%, var(--explorer-text));
  }

  @keyframes reason-entry-in {
    from { opacity: 0; transform: translateX(8px); }
    to { opacity: 1; transform: translateX(0); }
  }

  @media (max-width: 640px) {
    .lockdown-control {
      position: static;
    }

    .lockdown-reason-entry {
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
      backdrop-filter: blur(24px) saturate(1.2);
      animation-name: reason-entry-mobile-in;
    }

    .lockdown-reason-entry input {
      width: auto;
      flex: 1;
    }
  }

  @keyframes reason-entry-mobile-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.99); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .lockdown-reason-entry { animation: none; }
  }
</style>
