<script lang="ts">
  import type { IconName } from '$lib/icons';
  import Icon from './Icon.svelte';
  import FluentButton from './FluentButton.svelte';

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

<FluentButton data-fluent-owner="lib-components-task-action-button"
  appearance="subtle"
  iconOnly={presentation === 'icon'}
  {tone}
  type="button"
  class="task-action task-action-{presentation} task-action-{tone}"
  title={presentation === 'icon' ? label : undefined}
  aria-label={presentation === 'icon' ? label : undefined}
  {disabled}
  {onclick}
>
  <Icon name={icon} size={presentation === 'icon' ? '18px' : '16px'} />
  {#if presentation === 'labelled'}<span>{label}</span>{/if}
</FluentButton>

<style>
  :global(.task-action[data-fluent-owner="lib-components-task-action-button"]) {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    color: var(--explorer-text-muted);
    font-size: 12px;
    font-weight: 600;
    transition:
      color 120ms var(--motion-easing-standard),
      background-color 120ms var(--motion-easing-standard),
      transform 120ms var(--motion-easing-standard),
      opacity 120ms var(--motion-easing-standard);
  }

  :global(.task-action-icon[data-fluent-owner="lib-components-task-action-button"][icon-only]) {
    inline-size: 36px;
    block-size: 36px;
    border-radius: var(--borderRadiusMedium);
  }

  :global(.task-action-labelled[data-fluent-owner="lib-components-task-action-button"]) {
    min-height: 32px;
    gap: 4px;
    border-radius: var(--borderRadiusMedium);
    padding: 0.25rem 0.6rem;
  }

  :global(.task-action-primary[data-fluent-owner="lib-components-task-action-button"]) { color: var(--explorer-accent); }
  :global(.task-action-warning[data-fluent-owner="lib-components-task-action-button"]) { color: var(--explorer-warning); }
  :global(.task-action-danger[data-fluent-owner="lib-components-task-action-button"]) { color: var(--explorer-danger); }

  :global(.task-action[data-fluent-owner="lib-components-task-action-button"]:hover:not([disabled])) {
    color: var(--explorer-text);
    background: var(--explorer-surface-selected);
  }

  :global(.task-action-primary[data-fluent-owner="lib-components-task-action-button"]:hover:not([disabled])) {
    color: var(--explorer-accent);
    background: var(--explorer-accent-soft);
  }

  :global(.task-action-warning[data-fluent-owner="lib-components-task-action-button"]:hover:not([disabled])) {
    color: var(--explorer-warning);
    background: color-mix(in srgb, var(--explorer-warning) 12%, transparent);
  }

  :global(.task-action-danger[data-fluent-owner="lib-components-task-action-button"]:hover:not([disabled])) {
    color: var(--explorer-danger);
    background: color-mix(in srgb, var(--explorer-danger) 12%, transparent);
  }

  :global(.task-action[data-fluent-owner="lib-components-task-action-button"][disabled]) { color: var(--colorNeutralForegroundDisabled); }

  @media (pointer: coarse) {
    :global(.task-action-icon[data-fluent-owner="lib-components-task-action-button"][icon-only]) { inline-size: 44px; block-size: 44px; }
    :global(.task-action-labelled[data-fluent-owner="lib-components-task-action-button"]) { min-height: 44px; }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.task-action[data-fluent-owner="lib-components-task-action-button"]) { transition: none; }
  }
</style>
