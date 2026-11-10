<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  let {
    primary,
    secondary = '',
    tone = 'default',
    actionLabel = '',
    actionBusy = false,
    onAction,
  }: {
    primary: string;
    secondary?: string;
    tone?: 'default' | 'success' | 'danger';
    actionLabel?: string;
    actionBusy?: boolean;
    onAction?: () => void;
  } = $props();
</script>

<footer class="explorer-status-bar" data-tone={tone} aria-live="polite">
  <span class="explorer-status-primary">{primary}</span>
  {#if secondary}
    <span class="explorer-status-separator" aria-hidden="true"></span>
    <span class="explorer-status-secondary">{secondary}</span>
  {/if}
  {#if actionLabel && onAction}
    <FluentButton data-fluent-owner="lib-components-explorer-explorer-status-bar"
      type="button"
      disabled={actionBusy}
      onclick={onAction}
      appearance="subtle"
      class="explorer-status-action"
    >
      {actionLabel}
    </FluentButton>
  {/if}
</footer>

<style>
  .explorer-status-bar {
    display: flex;
    min-height: 30px;
    align-items: center;
    gap: 12px;
    border-top: 1px solid var(--explorer-border);
    padding-block-start: 0.3rem;
    padding-block-end: max(0.3rem, var(--safe-area-bottom, 0px));
    padding-inline: 0.75rem;
    color: var(--explorer-text-muted);
    font-size: 12px;
  }

  .explorer-status-primary {
    flex: none;
    white-space: nowrap;
  }

  .explorer-status-bar[data-tone="success"] {
    color: var(--explorer-success);
  }

  .explorer-status-bar[data-tone="danger"] {
    color: var(--explorer-danger);
  }

  .explorer-status-separator {
    width: 1px;
    height: 14px;
    background: var(--explorer-border-strong);
  }

  .explorer-status-secondary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.explorer-status-action[data-fluent-owner="lib-components-explorer-explorer-status-bar"]) {
    flex: none;
    margin-left: auto;
    border: 0;
    border-radius: var(--borderRadiusMedium);
    padding: 0.2rem 0.65rem;
    color: currentColor;
    background: color-mix(in srgb, currentColor 12%, transparent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  :global(.explorer-status-action[data-fluent-owner="lib-components-explorer-explorer-status-bar"]:hover:not(:is(:disabled, [disabled]))) {
    background: color-mix(in srgb, currentColor 20%, transparent);
  }

  :global(.explorer-status-action[data-fluent-owner="lib-components-explorer-explorer-status-bar"]:is(:disabled, [disabled])) {
    opacity: 0.55;
    cursor: default;
  }
</style>
