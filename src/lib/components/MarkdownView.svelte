<script lang="ts">
  import { parseMarkdownBlocks } from '$lib/markdown';

  let {
    content,
    compact = false,
  }: {
    content: string | null | undefined;
    compact?: boolean;
  } = $props();

  const blocks = $derived(parseMarkdownBlocks(content));
</script>

<div class="markdown-view" class:compact>
  {#each blocks as block}
    {#if block.type === 'heading'}
      <svelte:element this={block.depth <= 2 ? 'h3' : 'h4'}>{block.text}</svelte:element>
    {:else if block.type === 'paragraph'}
      <p>{block.text}</p>
    {:else if block.type === 'list'}
      {#if block.ordered}
        <ol>
          {#each block.items as item}
            <li>{item}</li>
          {/each}
        </ol>
      {:else}
        <ul>
          {#each block.items as item}
            <li>{item}</li>
          {/each}
        </ul>
      {/if}
    {:else if block.type === 'code'}
      <pre><code>{block.code}</code></pre>
    {/if}
  {/each}
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

  h3,
  h4,
  p,
  ul,
  ol,
  pre {
    margin: 0;
  }

  h3,
  h4 {
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
    font-weight: 800;
    letter-spacing: 0;
  }

  h3 {
    font-size: 1rem;
  }

  h4 {
    font-size: 0.9rem;
  }

  ul,
  ol {
    display: grid;
    gap: 0.35rem;
    padding-left: 1.25rem;
  }

  li::marker {
    color: var(--color-md3-primary-emphasis);
  }

  pre {
    max-width: 100%;
    overflow: auto;
    border-left: 2px solid color-mix(in srgb, var(--color-md3-primary-emphasis) 58%, transparent);
    padding: 0.5rem 0 0.5rem 0.75rem;
    color: var(--color-md3-on-surface);
    font: 0.8rem/1.55 var(--font-md3-mono);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
