<script lang="ts">
  import '@fluentui/web-components/text-input.js';
  import type { TextInput } from '@fluentui/web-components';
  import { tick, type Snippet } from 'svelte';
  import { disabledAttribute } from '$lib/shared/fluent/control';
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';

  // Only non-sensitive types: this component reflects its value into attributes.
  interface Props {
    id: string;
    label: string;
    value?: string;
    name?: string;
    disabled?: boolean;
    invalid?: boolean;
    describedBy?: string;
    validationMessage?: string;
    placeholder?: string;
    autocomplete?: string;
    type?: 'text' | 'email' | 'search' | 'url' | 'tel';
    controlSize?: 'small' | 'medium' | 'large';
    start?: Snippet;
    end?: Snippet;
    oninput?: (value: string) => void;
    onkeydown?: (event: KeyboardEvent) => void;
  }
  let {
    id, label, value = $bindable(''), name, disabled = false, invalid = false,
    describedBy, validationMessage, placeholder, autocomplete = 'off', type = 'text', controlSize = 'medium', start, end,
    oninput, onkeydown,
  }: Props = $props();
  let element: TextInput | undefined = $state();
  let control: HTMLInputElement | undefined = $state();
  let description: HTMLSpanElement | undefined = $state();
  $effect(() => {
    if (element && element.value !== value) element.value = value;
  });
  $effect(() => {
    const input = control;
    const message = description;
    const invalidNow = invalid;
    const errorText = validationMessage;
    const descriptionIds = describedBy;
    if (!input || !message) return;
    let cancelled = false;
    // ARIA ID references cannot cross a shadow boundary. Keep the focused
    // native control's description in its own root, using plain text only.
    void tick().then(() => {
      if (cancelled) return;
      input.setAttribute('aria-invalid', String(invalidNow));
      const text = errorText || descriptionIds?.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ') || '';
      message.textContent = text;
      if (text) input.setAttribute('aria-describedby', message.id);
      else input.removeAttribute('aria-describedby');
    });
    return () => { cancelled = true; };
  });
  export function focus(options?: FocusOptions) { element?.focus(options); }
  export function select() { element?.select(); }
  function forwardKeydown(node: TextInput) {
    // The pinned component publishes "control" as a CSS part. All integration
    // with that part stays here; business pages use this adapter's public API.
    control = node.shadowRoot?.querySelector<HTMLInputElement>('[part~="control"]') ?? undefined;
    const message = document.createElement('span');
    message.id = 'cfms-input-description';
    message.hidden = true;
    node.shadowRoot?.append(message);
    description = message;
    const handle = (event: KeyboardEvent) => {
      onkeydown?.(event);
      // Fluent performs implicit submission in its bubbling handler. Let the
      // route's Enter-to-next-field behavior cancel that before it runs.
      if (event.defaultPrevented) event.stopImmediatePropagation();
    };
    node.addEventListener('keydown', handle, true);
    return { destroy() { node.removeEventListener('keydown', handle, true); message.remove(); } };
  }
</script>

<MdOutlinedField inputId={id} {label} error={invalid} {disabled} {controlSize}>
  <fluent-text-input
    bind:this={element}
    use:forwardKeydown
    use:disabledAttribute={disabled}
    {id} {name} {type} {disabled} {autocomplete} {placeholder}
    spellcheck="false"
    aria-label={label}
    aria-invalid={invalid}
    aria-describedby={describedBy}
    class="cfms-text-input"
    appearance="outline"
    control-size={controlSize}
    oninput={() => {
      if (!element || disabled) return;
      value = element.value;
      oninput?.(value);
    }}
  >
    {label}
    {#if start}<span slot="start">{@render start()}</span>{/if}
    {#if end}<span slot="end">{@render end()}</span>{/if}
  </fluent-text-input>
</MdOutlinedField>

<style>
  .cfms-text-input { display: block; inline-size: 100%; max-inline-size: none; }
  .cfms-text-input::part(label) { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); padding: 0; }
  .cfms-text-input::part(control) { font-size: var(--fontSizeBase300); }
  .cfms-text-input::part(root) {
    height: calc(var(--cfms-control-height) - 2px);
    background: transparent;
    border: 0;
    outline: none;
    box-shadow: none;
  }
  .cfms-text-input::part(root)::after { display: none; }
  .cfms-text-input[aria-invalid="true"] { --colorNeutralStroke1: var(--colorStatusDangerBorder1); --colorCompoundBrandStroke: var(--colorStatusDangerBorder1); }
  .cfms-text-input :global([slot]) { display: inline-flex; align-items: center; color: var(--colorNeutralForeground3); }
  @media (pointer: coarse) {
    .cfms-text-input::part(control) { font-size: 16px; }
  }
</style>
