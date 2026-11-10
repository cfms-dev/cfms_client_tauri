<script lang="ts">
  interface Props {
    title: string;
    description?: string;
  }

  let { title, description }: Props = $props();
</script>

<div class="cfms-heading-copy">
  <h1>{title}</h1>
  {#if description}
    <p>{description}</p>
  {/if}
</div>

<style>
  h1 {
    color: var(--color-md3-on-surface);
    font: 600 28px/36px var(--font-md3-sans);
    letter-spacing: -0.018em;
    text-wrap: balance;
    overflow-wrap: anywhere;
  }

  p {
    max-width: 68ch;
    color: var(--color-md3-on-surface-variant);
    font: 400 14px/20px var(--font-md3-sans);
    overflow-wrap: anywhere;
  }
</style>
