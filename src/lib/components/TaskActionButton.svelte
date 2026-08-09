<script lang="ts">
  import type { IconName } from '$lib/icons';
  import Icon from './Icon.svelte';

  interface Props {
    icon: IconName;
    label: string;
    presentation?: 'icon' | 'labelled';
    tone?: 'neutral' | 'primary' | 'warning' | 'danger';
    disabled?: boolean;
    onclick?: () => void | Promise<void>;
  }

  let {
    icon,
    label,
    presentation = 'icon',
    tone = 'neutral',
    disabled = false,
    onclick,
  }: Props = $props();
</script>

<button
  type="button"
  class="task-action task-action-{presentation} task-action-{tone}"
  title={presentation === 'icon' ? label : undefined}
  aria-label={presentation === 'icon' ? label : undefined}
  {disabled}
  {onclick}
>
  <Icon name={icon} size={presentation === 'icon' ? '18px' : '16px'} />
  {#if presentation === 'labelled'}<span>{label}</span>{/if}
</button>

<style>
  .task-action {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    color: var(--explorer-text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    transition:
      color 120ms var(--motion-easing-standard),
      background-color 120ms var(--motion-easing-standard),
      transform 120ms var(--motion-easing-standard),
      opacity 120ms var(--motion-easing-standard);
  }

  .task-action-icon {
    width: 36px;
    height: 36px;
    border-radius: 999px;
  }

  .task-action-labelled {
    min-height: 32px;
    gap: 0.3rem;
    border-radius: var(--explorer-radius-small);
    padding: 0.25rem 0.6rem;
  }

  .task-action-primary { color: var(--explorer-accent); }
  .task-action-warning { color: var(--explorer-warning); }
  .task-action-danger { color: var(--explorer-danger); }

  .task-action:hover:not(:disabled) {
    color: var(--explorer-text);
    background: var(--explorer-surface-selected);
  }

  .task-action-primary:hover:not(:disabled) {
    color: var(--explorer-accent);
    background: var(--explorer-accent-soft);
  }

  .task-action-warning:hover:not(:disabled) {
    color: var(--explorer-warning);
    background: color-mix(in srgb, var(--explorer-warning) 12%, transparent);
  }

  .task-action-danger:hover:not(:disabled) {
    color: var(--explorer-danger);
    background: color-mix(in srgb, var(--explorer-danger) 12%, transparent);
  }

  .task-action:focus-visible {
    outline: 2px solid var(--explorer-accent);
    outline-offset: -2px;
  }

  .task-action:active:not(:disabled) { transform: scale(0.94); }
  .task-action:disabled { opacity: 0.5; }

  @media (pointer: coarse) {
    .task-action-icon { width: 44px; height: 44px; }
    .task-action-labelled { min-height: 44px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .task-action { transition: none; }
    .task-action:active:not(:disabled) { transform: none; }
  }
</style>
