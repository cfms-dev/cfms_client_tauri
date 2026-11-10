<script lang="ts">
  import type { Snippet } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import IconButton from '$lib/shared/ui/IconButton.svelte';

  interface Props {
    address: Snippet;
    search?: Snippet;
    canGoBack: boolean;
    canGoForward: boolean;
    canGoToParent: boolean;
    busy: boolean;
    onBack: () => void;
    onForward: () => void;
    onParent: () => void;
    onRefresh: () => void;
  }
  let { address, search, canGoBack, canGoForward, canGoToParent, busy, onBack, onForward, onParent, onRefresh }: Props = $props();
</script>

<div class="explorer-navigation-bar" class:explorer-navigation-bar--without-search={!search}>
  <IconButton icon="arrowBack" label={$t('files.goBack')} disabled={!canGoBack || busy} onclick={onBack} />
  <IconButton icon="arrowForward" label={$t('files.goForward')} disabled={!canGoForward || busy} onclick={onForward} />
  <IconButton icon="arrowUpward" label={$t('files.parentDirectory')} disabled={!canGoToParent || busy} onclick={onParent} />
  <div class="explorer-navigation-address">{@render address()}</div>
  {#if search}<div class="explorer-navigation-search">{@render search()}</div>{/if}
  <div class="explorer-navigation-refresh"><IconButton icon="refresh" label={$t('common.refresh')} disabled={busy} onclick={onRefresh} /></div>
</div>

<style>
  .explorer-navigation-bar {
    --files-field-height: 32px;
    --breadcrumb-target-height: calc(var(--files-field-height) - 2px);
    position: relative;
    z-index: 24;
    display: grid;
    grid-template-columns: repeat(3, var(--files-field-height)) minmax(0, 1fr) clamp(200px, 25%, 360px) var(--files-field-height);
    min-block-size: 48px;
    flex: none;
    align-items: start;
    gap: 8px;
    border-block-end: 1px solid var(--explorer-border);
    padding: 8px 12px 7px;
  }
  .explorer-navigation-bar--without-search { grid-template-columns: repeat(3, var(--files-field-height)) minmax(0, 1fr) var(--files-field-height); }
  .explorer-navigation-address, .explorer-navigation-search { min-inline-size: 0; }
  .explorer-navigation-refresh { display: flex; }
  .explorer-navigation-bar :global(.cfms-icon-button),
  .explorer-navigation-bar :global(.cfms-icon-button > .cfms-button) {
    inline-size: var(--files-field-height);
    block-size: var(--files-field-height);
    min-inline-size: 0;
    min-block-size: 0;
    padding: 0;
    border-radius: var(--borderRadiusMedium);
  }
  @media (max-width: 720px) {
    .explorer-navigation-bar { grid-template-columns: repeat(3, var(--files-field-height)) minmax(0, 1fr); padding-inline: 8px; }
    .explorer-navigation-search { grid-column: 1 / 5; grid-row: 2; margin-inline-end: calc(var(--files-field-height) + 8px); }
    .explorer-navigation-refresh { grid-column: 4; grid-row: 2; justify-self: end; }
    .explorer-navigation-bar--without-search { grid-template-columns: repeat(3, var(--files-field-height)) minmax(0, 1fr) var(--files-field-height); }
    .explorer-navigation-bar--without-search .explorer-navigation-refresh { grid-column: 5; grid-row: 1; }
  }
  @media (pointer: coarse) {
    .explorer-navigation-bar { --files-field-height: 44px; }
  }
</style>
