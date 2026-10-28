<script lang="ts">
  import '@fluentui/web-components/checkbox.js';
  import type { Checkbox } from '@fluentui/web-components';
  import { disabledAttribute } from '$lib/fluent/control';
  interface Props {
    checked?: boolean; indeterminate?: boolean; disabled?: boolean; ariaLabel?: string; class?: string;
    onChange?: (checked: boolean) => void;
  }
  let { checked = $bindable(false), indeterminate = false, disabled = false, ariaLabel = '', class: className = '', onChange }: Props = $props();
  const controlId = $props.id();
  let element: Checkbox | undefined = $state();
  $effect(() => { if (element) { element.checked = checked; element.indeterminate = indeterminate; } });
</script>
<label class="cfms-choice-target" for={controlId}><fluent-checkbox bind:this={element} id={controlId} role="checkbox" use:disabledAttribute={disabled} aria-label={ariaLabel}
  aria-checked={indeterminate ? 'mixed' : checked} aria-disabled={disabled || undefined} data-focus-ring="fluent"
  size="large" class="cfms-checkbox {className}"
  onchange={() => { if (element && !disabled) { checked = element.checked; onChange?.(checked); } }}
></fluent-checkbox></label>
<style>
  .cfms-checkbox { vertical-align: middle; flex-shrink: 0; }
  .cfms-choice-target { display: inline-flex; align-items: center; justify-content: center; min-inline-size: 28px; min-block-size: 28px; position: relative; }
  @media (pointer: coarse) { .cfms-choice-target { min-block-size: 44px; min-inline-size: 44px; } }
</style>
