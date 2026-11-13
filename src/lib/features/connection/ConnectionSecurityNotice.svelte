<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';

  let {
    title,
    tone = 'warning',
    checked = false,
    children,
  }: {
    title: string;
    tone?: 'neutral' | 'warning' | 'danger';
    checked?: boolean;
    children?: Snippet;
  } = $props();
</script>

<div class="connection-security-notice" class:warning={tone === 'warning'} class:danger={tone === 'danger'} role="status" aria-live="polite">
  <span class="cfms-icon-text__icon">
    <Icon name={checked ? 'checkCircle' : 'warning'} size="16px" tone={tone === 'warning' ? 'warning' : 'default'} />
  </span>
  <div class="notice-copy">
    <p class="notice-title">{title}</p>
    {#if children}
      <div class="notice-details">{@render children()}</div>
    {/if}
  </div>
</div>

<style>
  .connection-security-notice {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-inline-size: 0;
    padding: 12px;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: 8px;
    color: var(--colorNeutralForeground1);
    background: var(--colorNeutralBackground1);
    font: var(--fontSizeBase200)/var(--lineHeightBase200) var(--fontFamilyBase);
    overflow-wrap: anywhere;
  }

  .warning { color: var(--colorStatusWarningForeground2); background: var(--colorStatusWarningBackground1); }
  .danger { color: var(--colorStatusDangerForeground1); background: var(--colorStatusDangerBackground1); }
  .notice-copy { min-inline-size: 0; }
  .notice-title { margin: 0; font-weight: var(--fontWeightSemibold); }
  .notice-details { display: grid; gap: 4px; margin-block-start: 4px; }
  .notice-details:empty { display: none; }
  .notice-details :global(p) { margin: 0; }

  @media (forced-colors: active) {
    .connection-security-notice { background: Canvas; color: CanvasText; border-color: CanvasText; }
  }
</style>
