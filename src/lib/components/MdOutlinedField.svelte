<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    inputId: string;
    label: string;
    error?: boolean;
    children: Snippet;
  }

  let {
    inputId,
    label,
    error = false,
    children,
  }: Props = $props();
</script>

<div class="md-outlined-field" class:md-outlined-field--error={error}>
  <label class="md-outlined-field__label" for={inputId}>{label}</label>
  <div class="md-outlined-field__content">
    {@render children()}
  </div>
</div>

<style>
  .md-outlined-field {
    position: relative;
    min-width: 0;
    margin: 0;
    border: 1px solid var(--color-md3-outline, var(--explorer-border));
    border-radius: 12px;
    padding: 0;
    background: var(--color-md3-field, var(--explorer-surface-raised));
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .md-outlined-field:focus-within {
    border-color: var(--color-md3-primary, var(--explorer-accent));
    box-shadow: inset 0 0 0 1px var(--color-md3-primary, var(--explorer-accent));
  }

  .md-outlined-field--error,
  .md-outlined-field--error:focus-within {
    border-color: var(--color-md3-error, var(--explorer-danger));
    box-shadow: inset 0 0 0 1px var(--color-md3-error, var(--explorer-danger));
  }

  .md-outlined-field__label {
    position: absolute;
    top: 0;
    left: 0.75rem;
    z-index: 1;
    transform: translateY(-50%);
    padding: 0 0.35rem;
    color: var(--color-md3-on-surface-variant, var(--explorer-text-muted));
    /* The label straddles two surfaces. Matching each half to the surface
       beneath it hides only the outline instead of cutting a card-coloured
       rectangle out of the filled input container. */
    background: linear-gradient(
      to bottom,
      var(--color-md3-surface-container, var(--explorer-surface)) 0 50%,
      var(--color-md3-field, var(--explorer-surface-raised)) 50% 100%
    );
    font-family: var(--font-md3-sans);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.25;
    transition: color 120ms ease;
  }

  .md-outlined-field:focus-within .md-outlined-field__label {
    color: var(--color-md3-primary, var(--explorer-accent));
  }

  .md-outlined-field--error .md-outlined-field__label,
  .md-outlined-field--error:focus-within .md-outlined-field__label {
    color: var(--color-md3-error, var(--explorer-danger));
  }

  .md-outlined-field__content {
    display: flex;
    min-height: 42px;
    align-items: center;
    overflow: hidden;
    border-radius: inherit;
  }
</style>
