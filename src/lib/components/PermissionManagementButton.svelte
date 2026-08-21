<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    label,
    disabled = false,
    onclick,
  }: {
    label: string;
    disabled?: boolean;
    onclick: () => void | Promise<void>;
  } = $props();
</script>

<button
  type="button"
  class="permission-action-button"
  title={label}
  aria-label={label}
  {disabled}
  onclick={() => { if (!disabled) void onclick(); }}
>
  <Icon name="adminPanelSettings" size="17px" />
  <span>{label}</span>
</button>

<style>
  .permission-action-button {
    display: inline-flex;
    min-height: 2rem;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid color-mix(in srgb, var(--color-md3-primary) 30%, transparent);
    border-radius: var(--explorer-radius-small, 6px);
    padding: 0.28rem 0.6rem;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
    font: 600 0.72rem/1.2 var(--font-md3-sans);
    white-space: nowrap;
    transition:
      border-color 100ms ease,
      background-color 100ms ease,
      transform 120ms cubic-bezier(0.2, 0, 0, 1);
  }

  .permission-action-button:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--color-md3-primary) 55%, transparent);
    background: color-mix(in srgb, var(--color-md3-primary-container) 82%, white 18%);
  }

  .permission-action-button:active:not(:disabled) { transform: scale(0.97); }

  .permission-action-button:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  @media (pointer: coarse) {
    .permission-action-button {
      min-height: 2.5rem;
      padding-inline: 0.75rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .permission-action-button { transition: none; }
  }
</style>
