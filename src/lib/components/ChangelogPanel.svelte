<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import {
    changelogEntries,
    formatChangelogDate,
    type ChangelogEntry,
  } from '$lib/changelog';
  import Icon from '$lib/components/Icon.svelte';
  import MarkdownView from '$lib/components/MarkdownView.svelte';

  let expanded = $state(false);

  const visibleEntries = $derived(expanded ? changelogEntries : changelogEntries.slice(0, 2));

  function entryDate(entry: ChangelogEntry) {
    return formatChangelogDate(entry.date, $t('common.unknown'));
  }
</script>

<section class="changelog-panel" aria-labelledby="changelog-heading">
  <div class="panel-heading">
    <div>
      <h2 id="changelog-heading">{$t('changelog.title')}</h2>
      <p>{$t('changelog.description')}</p>
    </div>
    {#if changelogEntries.length > 2}
      <button type="button" class="text-action" onclick={() => (expanded = !expanded)}>
        <Icon name={expanded ? 'expandLess' : 'expandMore'} size="18px" />
        {expanded ? $t('changelog.showLess') : $t('changelog.showAll')}
      </button>
    {/if}
  </div>

  <div class="entry-list">
    {#each visibleEntries as entry, index (entry.version)}
      <article class="changelog-entry animate-fade-scale-in" style={`animation-delay: ${index * 45}ms;`}>
        <div class="entry-rail" aria-hidden="true">
          <span></span>
        </div>
        <div class="entry-body">
          <div class="entry-title">
            <div>
              <span class="version">{entry.version}</span>
              <h3>{entry.title}</h3>
            </div>
            <time datetime={entry.date ?? undefined}>{entryDate(entry)}</time>
          </div>
          <MarkdownView content={entry.content} compact font="serif" />
        </div>
      </article>
    {/each}
  </div>
</section>

<style>
  .changelog-panel {
    display: grid;
    gap: 1rem;
    padding-top: 1.25rem;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 72%, transparent);
  }

  .panel-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2,
  h3 {
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-serif);
    font-weight: 800;
    letter-spacing: 0;
  }

  h2 {
    font-size: 1rem;
  }

  h3 {
    margin-top: 0.1rem;
    font-size: 0.95rem;
  }

  p {
    margin-top: 0.3rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.875rem;
  }

  .entry-list {
    display: grid;
    gap: 0.9rem;
  }

  .changelog-entry {
    display: grid;
    grid-template-columns: 1.2rem minmax(0, 1fr);
    gap: 0.85rem;
    min-width: 0;
  }

  .entry-rail {
    position: relative;
    display: flex;
    justify-content: center;
    padding-top: 0.2rem;
  }

  .entry-rail::before {
    content: "";
    position: absolute;
    top: 1rem;
    bottom: -1rem;
    width: 1px;
    background: color-mix(in srgb, var(--color-md3-outline) 70%, transparent);
  }

  .changelog-entry:last-child .entry-rail::before {
    display: none;
  }

  .entry-rail span {
    position: relative;
    z-index: 1;
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 999px;
    background: var(--color-md3-primary-emphasis);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-md3-primary-emphasis) 16%, transparent);
  }

  .entry-body {
    min-width: 0;
    display: grid;
    gap: 0.65rem;
    padding-bottom: 0.15rem;
  }

  .entry-title {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .version {
    display: inline-flex;
    color: var(--color-md3-primary-emphasis);
    font: 700 0.75rem var(--font-md3-serif);
  }

  time {
    flex: none;
    color: var(--color-md3-on-surface-variant);
    font-family: var(--font-md3-serif);
    font-size: 0.75rem;
  }

  .text-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-height: 2.2rem;
    flex: none;
    border-radius: 6px;
    padding: 0 0.65rem;
    color: var(--color-md3-primary-emphasis);
    font: 700 0.8125rem var(--font-md3-serif);
    transition: background-color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .text-action:hover {
    background: color-mix(in srgb, var(--color-md3-primary-emphasis) 10%, transparent);
  }

  @media (max-width: 640px) {
    .panel-heading,
    .entry-title {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
