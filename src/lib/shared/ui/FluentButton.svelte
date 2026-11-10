<script lang="ts">
  import '@fluentui/web-components/button.js';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Button } from '@fluentui/web-components';
  import { disabledAttribute } from '$lib/shared/fluent/control';

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'class' | 'children'> {
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    form?: string;
    name?: string;
    value?: string;
    appearance?: 'primary' | 'outline' | 'subtle' | 'transparent';
    shape?: 'circular' | 'rounded' | 'square';
    iconOnly?: boolean;
    tone?: 'neutral' | 'primary' | 'warning' | 'danger';
    class?: string;
    children?: Snippet;
    start?: Snippet;
    end?: Snippet;
  }
  let {
    appearance = 'outline', shape = 'rounded', iconOnly = false, tone = 'neutral',
    class: className = '', children, start, end, type = 'button',
    onclick, disabled = false, ...attributes
  }: Props = $props();
  let element: Button | undefined = $state();
  export function focus(options?: FocusOptions) { element?.focus(options); }
</script>

<fluent-button
  {...attributes}
  bind:this={element}
  use:disabledAttribute={disabled}
  role="button"
  {appearance}
  {shape}
  type={type ?? 'button'}
  disabled={Boolean(disabled)}
  aria-disabled={disabled || undefined}
  data-focus-ring="fluent"
  icon-only={iconOnly || undefined}
  data-tone={tone}
  class="cfms-button {className}"
  onclickcapture={(event) => {
    if (disabled) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    onclick?.(event);
    if (event.defaultPrevented) event.stopImmediatePropagation();
  }}
>
  {#if start}<span slot="start">{@render start()}</span>{/if}
  {@render children?.()}
  {#if end}<span slot="end">{@render end()}</span>{/if}
</fluent-button>

<style>
  .cfms-button {
    box-sizing: border-box;
    min-block-size: var(--cfms-control-height-medium);
    max-inline-size: 100%;
    gap: 8px;
    vertical-align: middle;
  }
  .cfms-button::part(content) { display: inline-flex; align-items: center; justify-content: center; gap: inherit; white-space: nowrap; }
  .cfms-button[icon-only] { inline-size: var(--cfms-control-height-medium); padding: 0; }
  .cfms-button :global([slot]) { display: inline-flex; align-items: center; justify-content: center; }
</style>
