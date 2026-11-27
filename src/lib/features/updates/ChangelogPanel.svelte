<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    changelogEntries,
    formatChangelogDate,
    type ChangelogEntry,
  } from '$lib/features/updates/changelog';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MarkdownView from '$lib/shared/ui/MarkdownView.svelte';

  let expanded = $state(false);

  const visibleEntries = $derived(expanded ? changelogEntries : changelogEntries.slice(0, 1));

  function entryDate(entry: ChangelogEntry) {
    return formatChangelogDate(entry.date, $t('common.unknown'));
  }
</script>

<section class="changelog-panel" aria-labelledby="changelog-heading">
  <div class="panel-heading">
    <div class="panel-heading__copy">
      <h2 id="changelog-heading">{$t('changelog.title')}</h2>
      <p>{$t('changelog.description')}</p>
    </div>
    {#if changelogEntries.length > 1}
      <FluentButton
        data-fluent-owner="lib-components-changelog-panel"
        type="button"
        aria-expanded={expanded}
        aria-controls="changelog-entries"
        onclick={() => (expanded = !expanded)}
        appearance="subtle"
        class="text-action"
      >
        <Icon name={expanded ? 'expandLess' : 'expandMore'} size="18px" />
        {expanded ? $t('changelog.showLess') : $t('changelog.showAll')}
      </FluentButton>
    {/if}
  </div>

  <div id="changelog-entries" class="entry-list">
    {#each visibleEntries as entry, index (entry.version)}
      <article
        class="changelog-entry"
        class:changelog-entry--latest={index === 0}
        class:entry-revealed={expanded && index > 0}
        style:animation-delay={expanded && index > 0 ? `${Math.min(index * 35, 175)}ms` : undefined}
      >
        <header class="entry-header">
          <div class="entry-identity">
            <span class="version" class:version--latest={index === 0}>{entry.version}</span>
            <h3>{entry.title}</h3>
          </div>
          <time datetime={entry.date ?? undefined}>{entryDate(entry)}</time>
        </header>

        <div class="entry-body">
          {#if entry.lead}
            <div class="entry-lead" class:entry-lead--warning={entry.leadIsWarning}>
              <MarkdownView content={entry.lead} />
            </div>
          {/if}

          {#if entry.groups.length > 0}
            <div class="change-groups">
              {#each entry.groups as group (`${entry.version}:${group.category}`)}
                <section class="change-group">
                  <h4 class="group-heading" data-category={group.kind}>
                    <span class="group-dot" aria-hidden="true"></span>
                    <span>{group.category}</span>
                  </h4>
                  <MarkdownView content={group.content} />
                </section>
              {/each}
            </div>
          {:else if entry.content}
            <MarkdownView content={entry.content} />
          {/if}
        </div>
      </article>
    {/each}
  </div>
</section>

<style>
  .changelog-panel {
    display: grid;
    gap: 20px;
    padding-top: 24px;
    border-top: 1px solid color-mix(in srgb, var(--colorNeutralStroke2) 72%, transparent);
  }

  .panel-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .panel-heading__copy {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  h2,
  h3,
  h4,
  p {
    margin: 0;
  }

  h2,
  h3 {
    color: var(--colorNeutralForeground1);
    font-family: var(--fontFamilyBase);
    font-size: 16px;
    font-weight: 600;
    line-height: 22px;
    letter-spacing: -0.01em;
  }

  .panel-heading__copy p {
    color: var(--colorNeutralForeground3);
    font-family: var(--fontFamilyBase);
    font-size: 14px;
    font-weight: 400;
    line-height: 20px;
  }

  .entry-list {
    display: grid;
    gap: 32px;
  }

  .changelog-entry {
    display: grid;
    gap: 14px;
    min-width: 0;
  }

  .entry-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px 16px;
  }

  .entry-identity {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-width: 0;
  }

  .entry-identity h3 {
    overflow-wrap: anywhere;
  }

  .version {
    display: inline-flex;
    flex: none;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--borderRadiusMedium);
    background: color-mix(in srgb, var(--colorNeutralForeground1) 8%, transparent);
    color: var(--colorNeutralForeground2);
    font-family: var(--fontFamilyMonospace);
    font-size: 12px;
    font-weight: 600;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
  }

  .version--latest {
    background: var(--colorBrandBackground2);
    color: var(--colorBrandForeground1);
  }

  time {
    flex: none;
    color: var(--colorNeutralForeground3);
    font-family: var(--fontFamilyBase);
    font-size: 12px;
    line-height: 16px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .entry-body {
    display: grid;
    gap: 16px;
    min-width: 0;
    padding: 0;
  }

  .entry-lead--warning {
    padding: 10px 14px;
    border-radius: var(--borderRadiusLarge);
    background: var(--colorStatusWarningBackground1);
  }

  .entry-lead--warning :global(.markdown-view),
  .entry-lead--warning :global(.markdown-view strong) {
    color: var(--colorStatusWarningForeground2);
  }

  .change-groups {
    display: grid;
    gap: 16px;
    min-width: 0;
  }

  .change-group {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .group-heading {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--fontFamilyBase);
    font-size: 12px;
    font-weight: 600;
    line-height: 16px;
    letter-spacing: 0.02em;
    color: var(--colorNeutralForeground3);
  }

  .group-dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: 50%;
    background: var(--colorNeutralForeground4);
  }

  .group-heading[data-category='added'],
  .group-heading[data-category='improved'] {
    color: var(--colorBrandForeground1);
  }

  .group-heading[data-category='added'] .group-dot,
  .group-heading[data-category='improved'] .group-dot {
    background: var(--colorCompoundBrandForeground1);
  }

  .group-heading[data-category='fixed'] {
    color: var(--colorStatusSuccessForeground1);
  }

  .group-heading[data-category='fixed'] .group-dot {
    background: var(--colorStatusSuccessForeground1);
  }

  .group-heading[data-category='changed'] {
    color: var(--colorStatusWarningForeground2);
  }

  .group-heading[data-category='changed'] .group-dot {
    background: var(--colorStatusWarningForeground1);
  }

  :global(.text-action[data-fluent-owner="lib-components-changelog-panel"]) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 32px;
    flex: none;
    border-radius: var(--borderRadiusMedium);
    padding: 0 10px;
    color: var(--colorBrandForeground1);
    font-family: var(--fontFamilyBase);
    font-size: 13px;
    font-weight: 600;
    line-height: 18px;
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate);
  }

  :global(.text-action[data-fluent-owner="lib-components-changelog-panel"]:hover) {
    background: color-mix(in srgb, var(--colorBrandForeground1) 10%, transparent);
  }

  :global(.text-action[data-fluent-owner="lib-components-changelog-panel"]:active) {
    transform: none;
  }

  .entry-revealed {
    animation: changelog-entry-reveal 180ms var(--motion-easing-emphasized-decelerate) both;
  }

  @keyframes changelog-entry-reveal {
    from {
      opacity: 0.65;
      transform: translateY(-4px);
    }
  }

  @media (max-width: 640px) {
    .panel-heading,
    .entry-header {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  @media (pointer: coarse) {
    :global(.text-action[data-fluent-owner="lib-components-changelog-panel"]) {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .entry-revealed {
      animation: none;
    }
  }

  @media (forced-colors: active) {
    .version,
    .entry-lead--warning {
      border: 1px solid CanvasText;
      background: Canvas;
      color: CanvasText;
    }

    .version--latest {
      border-color: Highlight;
      color: Highlight;
    }

    .group-heading,
    .entry-lead--warning :global(.markdown-view),
    .entry-lead--warning :global(.markdown-view strong) {
      color: CanvasText;
    }

    .group-dot {
      background: CanvasText;
    }

    .group-heading[data-category='added'] .group-dot,
    .group-heading[data-category='improved'] .group-dot {
      background: Highlight;
    }
  }
</style>
