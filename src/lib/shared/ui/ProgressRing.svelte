<script lang="ts">
  import '@fluentui/web-components/spinner.js';
  interface Props { size?: number | string; strokeWidth?: number; class?: string; label?: string; tone?: 'primary' | 'inherit'; }
  let { size = 24, strokeWidth = 3, class: className = '', label = 'Loading', tone = 'primary' }: Props = $props();
  const normalizedSize = $derived(typeof size === 'number' ? size + 'px' : size);
</script>
<fluent-spinner class="md-progress-ring cfms-spinner {className}" role="status" aria-label={label}
  style:width={normalizedSize} style:height={normalizedSize} style:--indicatorSize={strokeWidth + 'px'}
  style:--colorBrandStroke1={tone === 'inherit' ? 'currentColor' : undefined}
  style:--colorBrandStroke2={tone === 'inherit' ? 'color-mix(in srgb, currentColor 18%, transparent)' : undefined}
></fluent-spinner>
<style>
  .cfms-spinner { flex-shrink: 0; vertical-align: middle; }
  :global(html[data-reduce-motion="true"]) .cfms-spinner { --duration: 2.4s; }
</style>
