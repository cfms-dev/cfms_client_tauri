<script lang="ts">
  import { formatShortcut, type ShortcutSpec } from '$lib/shared/ui/keyboard';

  interface Props {
    shortcuts: readonly ShortcutSpec[];
    compact?: boolean;
    variant?: 'keycap' | 'menu';
    class?: string;
  }

  let {
    shortcuts,
    compact = false,
    variant = 'keycap',
    class: className = '',
  }: Props = $props();

  const formattedShortcuts = $derived(
    (variant === 'menu' ? shortcuts.slice(0, 1) : shortcuts).map((shortcut) => formatShortcut(shortcut)),
  );
</script>

<span
  class="shortcut-keys {className}"
  class:shortcut-keys--compact={compact}
  class:shortcut-keys--menu={variant === 'menu'}
  aria-hidden={compact ? 'true' : undefined}
  aria-label={compact ? undefined : formattedShortcuts.join(', ')}
>
  {#each formattedShortcuts as shortcut}
    <kbd>{shortcut}</kbd>
  {/each}
</span>

<style>
  .shortcut-keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
  }

  kbd {
    min-width: 2rem;
    border: 1px solid var(--color-md3-outline-variant);
    border-radius: 5px;
    padding: 0.18rem 0.42rem;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-surface-container-high);
    box-shadow: 0 1px 0 color-mix(in srgb, var(--color-md3-on-surface) 18%, transparent);
    font: 600 12px/16px var(--font-md3-mono, monospace);
    text-align: center;
  }

  .shortcut-keys--compact kbd {
    min-width: 0;
    border-color: var(--explorer-border-strong, var(--color-md3-outline-variant));
    padding: 0.12rem 0.36rem;
    color: var(--explorer-text-muted, var(--color-md3-on-surface-variant));
    background: var(--explorer-surface-raised, var(--color-md3-surface-container-high));
    box-shadow:
      0 1px 0 color-mix(in srgb, var(--explorer-text, var(--color-md3-on-surface)) 14%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 5%, transparent);
    font-size: 12px;
    line-height: 1.35;
    letter-spacing: -0.015em;
  }

  .shortcut-keys--menu {
    flex-wrap: nowrap;
    white-space: nowrap;
    color: var(--colorNeutralForeground2);
  }

  .shortcut-keys--menu kbd {
    min-width: 0;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: inherit;
    background: none;
    box-shadow: none;
    font: 300 12px/16px var(--fontFamilyBase);
    letter-spacing: normal;
  }

  :global(.context-menu-item:is(:disabled, [aria-disabled='true'])) .shortcut-keys--menu {
    color: inherit;
  }

  @media (forced-colors: active) {
    .shortcut-keys--menu { color: inherit; }
  }
</style>
