<script lang="ts">
  import type { Snippet } from 'svelte';
  import IconButton from '$lib/components/IconButton.svelte';

  interface Props {
    title: string;
    subtitle?: string;
    backLabel?: string;
    onBack?: () => void;
    maxWidth?: string;
    actions?: Snippet;
  }

  let {
    title,
    subtitle,
    backLabel = 'Back',
    onBack,
    maxWidth = 'max-w-5xl',
    actions,
  }: Props = $props();
</script>

<header class="top-app-bar">
  <div class="top-app-bar__inner {maxWidth}">
    <div class="top-app-bar__nav">
      {#if onBack}
        <IconButton icon="arrowBack" label={backLabel} onclick={onBack} />
      {/if}
    </div>

    <div class="top-app-bar__title">
      <h1>{title}</h1>
      {#if subtitle}
        <p>{subtitle}</p>
      {/if}
    </div>

    <div class="top-app-bar__actions">
      {#if actions}
        {@render actions()}
      {/if}
    </div>
  </div>
</header>

<style>
  .top-app-bar {
    position: sticky;
    inset-block-start: 0;
    z-index: 20;
    min-block-size: 64px;
    border-block-end: 1px solid color-mix(in srgb, var(--color-md3-outline) 66%, transparent);
    background:
      linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.78));
    backdrop-filter: blur(20px);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.03) inset;
  }

  .top-app-bar__inner {
    margin-inline: auto;
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) minmax(48px, auto);
    align-items: center;
    gap: 0.5rem;
    min-block-size: 64px;
    padding: 0.5rem 1rem;
  }

  .top-app-bar__nav,
  .top-app-bar__actions {
    display: flex;
    align-items: center;
    min-inline-size: 0;
  }

  .top-app-bar__actions {
    justify-content: flex-end;
    gap: 0.35rem;
  }

  .top-app-bar__title {
    min-inline-size: 0;
    padding-inline: 0.25rem;
  }

  .top-app-bar__title h1 {
    margin: 0;
    overflow: hidden;
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-sans);
    font-size: 1.45rem;
    font-weight: 650;
    letter-spacing: 0;
    line-height: 1.15;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .top-app-bar__title p {
    margin: 0.2rem 0 0;
    overflow: hidden;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.82rem;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    .top-app-bar__inner {
      padding-inline: 0.75rem;
    }

    .top-app-bar__title h1 {
      font-size: 1.25rem;
    }
  }
</style>
