<script lang="ts">
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
  <span>{primary}</span>
  {#if secondary}
    <span class="explorer-status-separator" aria-hidden="true"></span>
    <span class="explorer-status-secondary">{secondary}</span>
  {/if}
  {#if actionLabel && onAction}
    <button type="button" class="explorer-status-action" disabled={actionBusy} onclick={onAction}>
      {actionLabel}
    </button>
  {/if}
</footer>

<style>
  .explorer-status-bar {
    display: flex;
    min-height: 30px;
    align-items: center;
    gap: 0.65rem;
    border-top: 1px solid var(--explorer-border);
    padding: 0.3rem 0.75rem;
    color: var(--explorer-text-muted);
    background: var(--explorer-surface);
    font-size: 0.75rem;
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

  .explorer-status-action {
    margin-left: auto;
    border: 0;
    border-radius: 999px;
    padding: 0.2rem 0.65rem;
    color: currentColor;
    background: color-mix(in srgb, currentColor 12%, transparent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .explorer-status-action:hover:not(:disabled) {
    background: color-mix(in srgb, currentColor 20%, transparent);
  }

  .explorer-status-action:disabled {
    opacity: 0.55;
    cursor: default;
  }
</style>
