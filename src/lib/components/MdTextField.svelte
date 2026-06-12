<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props {
    id: string;
    label: string;
    value: string;
    type?: 'text' | 'password';
    placeholder?: string;
    leadingText?: string;
    error?: string | null;
    disabled?: boolean;
    autocomplete?: HTMLInputAttributes['autocomplete'];
    inputmode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url';
    spellcheck?: HTMLInputAttributes['spellcheck'];
    autocapitalize?: HTMLInputAttributes['autocapitalize'];
    onkeydown?: (event: KeyboardEvent) => void;
  }

  let {
    id,
    label,
    value = $bindable(''),
    type = 'text',
    placeholder = '',
    leadingText = '',
    error = null,
    disabled = false,
    autocomplete,
    inputmode,
    spellcheck,
    autocapitalize,
    onkeydown,
  }: Props = $props();
</script>

<div class="md-text-field" class:md-text-field--error={Boolean(error)} class:md-text-field--disabled={disabled}>
  <div class="md-text-field__control">
    <label class="md-text-field__label" for={id}>{label}</label>
    {#if leadingText}
      <span class="md-text-field__leading">{leadingText}</span>
    {/if}
    <input
      {id}
      {type}
      {placeholder}
      {disabled}
      {autocomplete}
      {inputmode}
      {spellcheck}
      {autocapitalize}
      bind:value
      onkeydown={onkeydown}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
    />
  </div>
  {#if error}
    <p id={`${id}-error`} class="md-text-field__supporting">{error}</p>
  {/if}
</div>

<style>
  .md-text-field {
    display: grid;
    gap: 0.35rem;
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
  }

  .md-text-field__control {
    position: relative;
    display: flex;
    align-items: center;
    min-block-size: 58px;
    border: 1px solid var(--color-md3-outline);
    border-radius: 4px;
    background:
      linear-gradient(180deg, rgba(31, 41, 55, 0.86), rgba(31, 41, 55, 0.72));
    transition:
      border-color var(--motion-duration-short4) var(--motion-easing-standard),
      box-shadow var(--motion-duration-short4) var(--motion-easing-standard),
      background-color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .md-text-field__control:focus-within {
    border-color: var(--color-md3-primary-emphasis);
    box-shadow:
      0 0 0 1px var(--color-md3-primary-emphasis),
      0 10px 28px rgba(79, 70, 229, 0.14);
  }

  .md-text-field__label {
    position: absolute;
    inset-block-start: -0.68rem;
    inset-inline-start: 0.75rem;
    max-inline-size: calc(100% - 1.5rem);
    padding-inline: 0.35rem;
    overflow: hidden;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-surface-container);
    font-size: 0.78rem;
    font-weight: 650;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .md-text-field__control:focus-within .md-text-field__label {
    color: var(--color-md3-primary-emphasis);
  }

  .md-text-field__leading {
    flex: none;
    padding-inline-start: 1rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 1rem;
    line-height: 1;
    white-space: nowrap;
  }

  input {
    min-inline-size: 0;
    inline-size: 100%;
    flex: 1;
    border: 0;
    background: transparent;
    color: var(--color-md3-on-surface);
    font: 1rem var(--font-md3-sans);
    line-height: 1.3;
    outline: 0;
    padding: 1rem;
  }

  .md-text-field__leading + input {
    padding-inline-start: 0.25rem;
  }

  input::placeholder {
    color: color-mix(in srgb, var(--color-md3-on-surface-variant) 76%, transparent);
  }

  .md-text-field--error .md-text-field__control {
    border-color: var(--color-md3-error);
  }

  .md-text-field--error .md-text-field__control:focus-within {
    border-color: var(--color-md3-error);
    box-shadow: 0 0 0 1px var(--color-md3-error);
  }

  .md-text-field--error .md-text-field__label,
  .md-text-field--error .md-text-field__supporting {
    color: var(--color-md3-error);
  }

  .md-text-field--disabled {
    opacity: 0.58;
  }

  .md-text-field__supporting {
    margin: 0;
    padding-inline: 1rem;
    color: var(--color-md3-error);
    font-size: 0.75rem;
  }
</style>
