<script lang="ts">
  import { formatShortcut, type ShortcutSpec } from '$lib/keyboard';

  interface Props {
    shortcuts: readonly ShortcutSpec[];
    compact?: boolean;
    class?: string;
  }

  let {
    shortcuts,
    compact = false,
    class: className = '',
  }: Props = $props();

  const formattedShortcuts = $derived(shortcuts.map((shortcut) => formatShortcut(shortcut)));
</script>

<span
  class="shortcut-keys {className}"
  class:shortcut-keys--compact={compact}
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
    gap: 0.35rem;
  }

  kbd {
    min-width: 2rem;
    border: 1px solid var(--color-md3-outline-variant);
    border-radius: 5px;
    padding: 0.18rem 0.42rem;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-surface-container-high);
    box-shadow: 0 1px 0 color-mix(in srgb, var(--color-md3-on-surface) 18%, transparent);
    font: 600 0.72rem/1.4 var(--font-md3-mono, monospace);
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
    font-size: 0.625rem;
    line-height: 1.35;
    letter-spacing: -0.015em;
  }
</style>
