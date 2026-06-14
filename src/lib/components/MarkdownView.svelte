<script lang="ts">
  import { renderMarkdown } from '$lib/markdown';

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
    gap: 0.7rem;
    color: var(--color-md3-on-surface-variant);
    font-family: var(--font-md3-sans);
    font-size: 0.875rem;
    line-height: 1.65;
  }

  .markdown-view.compact {
    gap: 0.45rem;
    font-size: 0.8125rem;
    line-height: 1.55;
  }

  .markdown-view.serif {
    font-family: var(--font-md3-serif);
  }

  .markdown-view :global(:where(h1, h2, h3, h4, h5, h6, p, ul, ol, pre, blockquote, table, hr)) {
    margin: 0;
  }

  .markdown-view :global(:where(h1, h2, h3, h4, h5, h6)) {
    color: var(--color-md3-on-surface);
    font-family: inherit;
    font-weight: 800;
    letter-spacing: 0;
  }

  .markdown-view :global(:where(h1, h2, h3)) {
    font-size: 1rem;
  }

  .markdown-view :global(:where(h4, h5, h6)) {
    font-size: 0.9rem;
  }

  .markdown-view :global(:where(p, li, blockquote)) {
    overflow-wrap: anywhere;
  }

  .markdown-view :global(:where(ul, ol)) {
    display: grid;
    gap: 0.35rem;
    padding-left: 1.25rem;
  }

  .markdown-view :global(li::marker) {
    color: var(--color-md3-primary-emphasis);
  }

  .markdown-view :global(a) {
    color: var(--color-md3-primary-emphasis);
    font-weight: 700;
    text-decoration: none;
    transition: filter var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .markdown-view :global(a:hover) {
    filter: brightness(1.18);
    text-decoration: underline;
  }

  .markdown-view :global(:where(code, kbd)) {
    border-radius: 4px;
    padding: 0.1rem 0.28rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 82%, transparent);
    color: var(--color-md3-on-surface);
    font: 0.8rem/1.45 var(--font-md3-mono);
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
