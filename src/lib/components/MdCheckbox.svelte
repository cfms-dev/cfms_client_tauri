<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';

  interface Props {
    checked?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
    class?: string;
    onChange?: (checked: boolean) => void;
  }

  let {
    checked = $bindable(false),
    disabled = false,
    ariaLabel = '',
    class: className = '',
    onChange,
  }: Props = $props();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onChange?.(checked);
  }
</script>

<button
  type="button"
  role="checkbox"
  aria-checked={checked}
  aria-label={ariaLabel}
  disabled={disabled}
  class="md-choice-button {checked ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'} {className}"
  onclick={toggle}
>
  <Icon name={checked ? 'checkBox' : 'checkBoxBlank'} size="22px" />
</button>

<style>
  .md-choice-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 28px;
    block-size: 28px;
    padding: 0;
    border: 0;
    border-radius: 9999px;
    background: transparent;
    cursor: pointer;
    transition:
      color var(--motion-duration-short4) var(--motion-easing-standard),
      background var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate);
  }

  .md-choice-button:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 12%, transparent);
  }

  .md-choice-button:active:not(:disabled) {
    transform: scale(0.92);
  }

  .md-choice-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
</style>
