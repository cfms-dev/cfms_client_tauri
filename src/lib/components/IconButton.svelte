<script lang="ts">
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  interface Props {
    icon: IconName;
    label: string;
    active?: boolean;
    disabled?: boolean;
    badge?: number;
    tone?: 'default' | 'danger';
    size?: number | string;
    class?: string;
    onclick?: (event: MouseEvent) => void;
  }

  let {
    icon,
    label,
    active = false,
    disabled = false,
    badge = 0,
    tone = 'default',
    size = 20,
    class: className = '',
    onclick,
  }: Props = $props();
</script>

<button
  type="button"
  class="md-icon-button {active ? 'md-icon-button--active' : ''} {className}"
  class:md-icon-button--danger={tone === 'danger'}
  title={label}
  aria-label={label}
  aria-pressed={active ? 'true' : undefined}
  disabled={disabled}
  {onclick}
>
  <Icon name={icon} size={size} />
  {#if badge > 0}
    <span class="md-icon-button__badge">{badge > 99 ? '99+' : badge}</span>
  {/if}
</button>

<style>
  .md-icon-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    inline-size: 36px;
    block-size: 36px;
    padding: 0;
    border: 0;
    border-radius: 9999px;
    color: var(--color-md3-on-surface-variant);
    background: transparent;
    cursor: pointer;
    transition:
      color var(--motion-duration-short4) var(--motion-easing-standard),
      background var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate),
      box-shadow var(--motion-duration-medium1) var(--motion-easing-standard);
  }

  .md-icon-button:hover:not(:disabled) {
    color: var(--color-md3-on-surface);
    background: color-mix(in srgb, var(--color-md3-on-surface) 10%, transparent);
  }

  .md-icon-button:active:not(:disabled) {
    transform: scale(0.92);
  }

  .md-icon-button--active {
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  .md-icon-button--active:hover:not(:disabled) {
    color: var(--color-md3-on-primary-container);
    background: color-mix(in srgb, var(--color-md3-primary-container) 86%, white 14%);
  }

  .md-icon-button--danger {
    color: var(--color-md3-error);
  }

  .md-icon-button--danger:hover:not(:disabled) {
    color: var(--color-md3-on-error-container);
    background: var(--color-md3-error-container);
  }

  .md-icon-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .md-icon-button__badge {
    position: absolute;
    inset-block-start: -2px;
    inset-inline-end: -2px;
    min-inline-size: 16px;
    block-size: 16px;
    padding: 0 4px;
    border-radius: 9999px;
    background: var(--color-md3-primary);
    color: var(--color-md3-on-primary);
    font-family: var(--font-md3-sans);
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    box-shadow: 0 0 0 2px var(--color-md3-surface-container);
  }
</style>
