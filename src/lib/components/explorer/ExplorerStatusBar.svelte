<script lang="ts">
  let {
    primary,
    secondary = '',
    tone = 'default',
  }: {
    primary: string;
    secondary?: string;
    tone?: 'default' | 'success' | 'danger';
  } = $props();
</script>

<footer class="explorer-status-bar" data-tone={tone} aria-live="polite">
  <span>{primary}</span>
  {#if secondary}
    <span class="explorer-status-separator" aria-hidden="true"></span>
    <span class="explorer-status-secondary">{secondary}</span>
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
</style>
