<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  type DialogActionVariant = 'primary' | 'secondary' | 'danger' | 'tonal';

  interface Props extends Omit<HTMLButtonAttributes, 'class'> {
    variant?: DialogActionVariant;
    class?: string;
    children: Snippet;
  }

  let {
    variant = 'secondary',
    class: className = '',
    children,
    type = 'button',
    ...attributes
  }: Props = $props();
</script>

<button
  {...attributes}
  {type}
  class="dialog-action-button dialog-action-button--{variant} {className}"
>
  {@render children()}
</button>

<style>
  .dialog-action-button {
    box-sizing: border-box;
    display: inline-flex;
    min-height: 2rem;
    flex: none;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-small, 6px);
    padding: 0.28rem 0.8rem;
    font: 600 0.78rem/1.25 var(--font-md3-sans);
    transition:
      color 120ms ease,
      background-color 120ms ease,
      border-color 120ms ease,
      box-shadow 120ms ease,
      transform 120ms ease;
  }

  .dialog-action-button:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .dialog-action-button:active:not(:disabled) {
    transform: translateY(0) scale(0.97);
  }

  .dialog-action-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  /* Loading indicators replace the button icon, so they should use the same
     foreground token instead of ProgressRing's standalone primary colour. */
  .dialog-action-button :global(.md-progress-ring) {
    color: inherit;
  }

  .dialog-action-button--secondary {
    color: var(--explorer-text-muted, var(--color-md3-on-surface-variant));
    background: transparent;
  }

  .dialog-action-button--secondary:hover:not(:disabled) {
    border-color: var(--explorer-border, var(--color-md3-outline));
    color: var(--explorer-text, var(--color-md3-on-surface));
    background: var(--explorer-surface-hover, var(--color-md3-surface-container-high));
  }

  .dialog-action-button--primary {
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--color-md3-primary) 28%, transparent);
  }

  .dialog-action-button--primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-md3-primary) 88%, white 12%);
    box-shadow: 0 3px 8px color-mix(in srgb, var(--color-md3-primary) 30%, transparent);
  }

  .dialog-action-button--danger {
    color: var(--color-md3-on-error-action);
    background: var(--color-md3-error-action);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--color-md3-error-action) 28%, transparent);
  }

  .dialog-action-button--danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-md3-error-action) 88%, white 12%);
    box-shadow: 0 3px 8px color-mix(in srgb, var(--color-md3-error-action) 30%, transparent);
  }

  .dialog-action-button--tonal {
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  .dialog-action-button--tonal:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-md3-primary-container) 84%, white 16%);
  }

  @media (pointer: coarse) {
    .dialog-action-button {
      min-height: 2.5rem;
      padding-inline: 1rem;
    }
  }
</style>
