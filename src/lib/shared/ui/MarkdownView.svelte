<script lang="ts">
  import { renderMarkdown } from '#lib/shared/format/markdown.ts';

  let {
    content,
    compact = false,
    font = 'sans',
  }: {
    content: string | null | undefined;
    compact?: boolean;
    font?: 'sans' | 'serif';
  } = $props();

  const renderedContent = $derived(renderMarkdown(content));
</script>

<div class="markdown-view" class:compact class:serif={font === 'serif'}>
  {@html renderedContent}
</div>

<style>
  .markdown-view {
    display: grid;
    gap: 10px;
    color: var(--colorNeutralForeground2);
    font-family: var(--fontFamilyBase);
    font-size: 14px;
    line-height: 20px;
  }

  .markdown-view.compact {
    gap: 8px;
    font-size: 13px;
    line-height: 20px;
  }

  .markdown-view.serif {
    font-family: var(--font-md3-serif);
  }

  .markdown-view :global(:where(h1, h2, h3, h4, h5, h6, p, ul, ol, pre, blockquote, table, hr)) {
    margin: 0;
  }

  .markdown-view :global(:where(h1, h2, h3, h4, h5, h6)) {
    color: var(--colorNeutralForeground1);
    font-family: inherit;
    font-weight: 600;
    letter-spacing: 0;
  }

  .markdown-view :global(:where(h1, h2, h3, h4, h5, h6):not(:first-child)) {
    margin-top: 8px;
  }

  .markdown-view.compact :global(:where(h1, h2, h3, h4, h5, h6):not(:first-child)) {
    margin-top: 6px;
  }

  .markdown-view :global(h1) {
    font-size: 18px;
    line-height: 24px;
  }

  .markdown-view :global(h2) {
    font-size: 16px;
    line-height: 22px;
  }

  .markdown-view :global(h3) {
    font-size: 14px;
    line-height: 20px;
  }

  .markdown-view :global(:where(h4, h5, h6)) {
    font-size: 13px;
    line-height: 18px;
  }

  .markdown-view.compact :global(h1) {
    font-size: 15px;
    line-height: 20px;
  }

  .markdown-view.compact :global(h2) {
    font-size: 14px;
    line-height: 20px;
  }

  .markdown-view.compact :global(h3) {
    font-size: 13px;
    line-height: 18px;
  }

  .markdown-view.compact :global(:where(h4, h5, h6)) {
    font-size: 12px;
    line-height: 16px;
  }

  .markdown-view :global(:where(p, li, blockquote)) {
    overflow-wrap: anywhere;
  }

  .markdown-view :global(ul) {
    list-style-type: disc;
  }

  .markdown-view :global(ul ul) {
    list-style-type: circle;
  }

  .markdown-view :global(ol) {
    list-style-type: decimal;
  }

  .markdown-view :global(:where(ul, ol)) {
    display: grid;
    gap: 6px;
    padding-left: 1.15rem;
  }

  .markdown-view :global(li) {
    padding-left: 2px;
  }

  .markdown-view :global(li::marker) {
    color: var(--colorNeutralForeground4);
  }

  .markdown-view :global(a) {
    color: var(--colorBrandForegroundLink);
    font-weight: 500;
    text-decoration: none;
    text-underline-offset: 2px;
    transition: color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .markdown-view :global(a:hover) {
    color: var(--colorBrandForegroundLinkHover);
    text-decoration: underline;
  }

  .markdown-view :global(:where(code, kbd)) {
    border-radius: 4px;
    padding: 1px 5px;
    background: color-mix(in srgb, var(--colorNeutralForeground1) 8%, transparent);
    color: var(--colorNeutralForeground1);
    font-family: var(--fontFamilyMonospace);
    font-size: 0.85em;
    line-height: 1.4;
  }

  .markdown-view :global(pre) {
    max-width: 100%;
    overflow: auto;
    border-left: 2px solid color-mix(in srgb, var(--color-md3-primary-emphasis) 58%, transparent);
    padding: 0.5rem 0 0.5rem 0.75rem;
    color: var(--color-md3-on-surface);
    font: 0.8rem/1.55 var(--font-md3-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }

  .markdown-view :global(pre code) {
    display: block;
    padding: 0;
    border-radius: 0;
    background: transparent;
    font: inherit;
  }

  .markdown-view :global(blockquote) {
    border-left: 2px solid color-mix(in srgb, var(--color-md3-outline) 80%, transparent);
    padding-left: 0.75rem;
    color: var(--color-md3-on-surface-variant);
  }

  .markdown-view :global(hr) {
    border: 0;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 70%, transparent);
  }

  .markdown-view :global(table) {
    display: block;
    max-width: 100%;
    overflow: auto;
    border-collapse: collapse;
  }

  .markdown-view :global(:where(th, td)) {
    border: 1px solid color-mix(in srgb, var(--color-md3-outline) 62%, transparent);
    padding: 0.35rem 0.5rem;
  }

  .markdown-view :global(img) {
    max-width: 100%;
    border-radius: 6px;
  }
</style>
