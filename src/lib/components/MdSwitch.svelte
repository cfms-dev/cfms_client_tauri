<script lang="ts">
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
  role="switch"
  aria-checked={checked}
  aria-label={ariaLabel}
  disabled={disabled}
  class="md-switch {checked ? 'md-switch--checked' : ''} {className}"
  onclick={toggle}
>
  <span class="md-switch__track">
    <span class="md-switch__handle"></span>
  </span>
</button>

<style>
  .md-switch {
    inline-size: 52px;
    block-size: 32px;
    padding: 0;
    border: 0;
    border-radius: 9999px;
    background: transparent;
    cursor: pointer;
    transition: opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .md-switch:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .md-switch__track {
    position: relative;
    display: block;
    inline-size: 52px;
    block-size: 32px;
    border: 2px solid var(--color-md3-outline-variant);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 76%, transparent);
    transition:
      background var(--motion-duration-medium1) var(--motion-easing-emphasized-decelerate),
      border-color var(--motion-duration-medium1) var(--motion-easing-emphasized-decelerate),
      box-shadow var(--motion-duration-medium1) var(--motion-easing-standard);
  }

  .md-switch__handle {
    position: absolute;
    inset-block-start: 50%;
    inset-inline-start: 6px;
    inline-size: 16px;
    block-size: 16px;
    border-radius: 9999px;
    background: var(--color-md3-on-surface-variant);
    transform: translate3d(0, -50%, 0);
    transition:
      inline-size var(--motion-duration-medium1) var(--motion-easing-emphasized-decelerate),
      block-size var(--motion-duration-medium1) var(--motion-easing-emphasized-decelerate),
      inset-inline-start var(--motion-duration-medium1) var(--motion-easing-emphasized-decelerate),
      background var(--motion-duration-medium1) var(--motion-easing-standard),
      box-shadow var(--motion-duration-medium1) var(--motion-easing-standard);
  }

  .md-switch:hover:not(:disabled) .md-switch__track {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-md3-primary) 10%, transparent);
  }

  .md-switch:hover:not(:disabled) .md-switch__handle {
    inline-size: 20px;
    block-size: 20px;
    inset-inline-start: 4px;
  }

  .md-switch--checked .md-switch__track {
    border-color: var(--color-md3-primary);
    background: var(--color-md3-primary);
  }

  .md-switch--checked .md-switch__handle {
    inline-size: 24px;
    block-size: 24px;
    inset-inline-start: 22px;
    background: var(--color-md3-on-primary);
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.18);
  }

  .md-switch--checked:hover:not(:disabled) .md-switch__handle {
    inline-size: 26px;
    block-size: 26px;
    inset-inline-start: 20px;
  }
</style>
