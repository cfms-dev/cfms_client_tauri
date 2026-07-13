<script lang="ts">
  // Settings overview page
  //
  // List of settings categories that navigate to sub-pages.
  //
  // Reference: SettingsModel in reference/src/include/ui/models/settings/overview.py

  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { authStore } from '$lib/stores.svelte';
  import { getVisibleSettingsEntries } from '$lib/settings-entries';
  import Icon from '$lib/components/Icon.svelte';

  const visibleEntries = $derived(getVisibleSettingsEntries({ isLoggedIn: authStore.isLoggedIn }));

</script>

<div class="workspace-page p-4 sm:p-6 space-y-4 max-w-4xl mx-auto">
  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    {$t('settings.title')}
  </h1>

  <div class="settings-grid bg-md3-surface-container/70 backdrop-blur-sm rounded-lg
              border border-md3-outline overflow-hidden">
    {#each visibleEntries as entry, i}
      <button
        class="w-full flex items-center gap-4 px-5 py-3.5 text-left
               hover:bg-md3-surface-container-high/50
               transition-colors
               {i < visibleEntries.length - 1 ? 'border-b border-md3-outline/50' : ''}"
        onclick={() => goto(entry.href)}
      >
        <span class="text-md3-primary-emphasis shrink-0">
          <Icon name={entry.icon} size="24px" />
        </span>
        <div class="min-w-0">
          <p class="text-sm font-medium text-md3-on-surface"
             style="font-family: var(--font-md3-sans);">
            {$t(entry.labelKey)}
          </p>
          <p class="text-xs text-md3-on-surface-variant truncate">
            {$t(entry.descriptionKey)}
          </p>
        </div>
        <span class="ml-auto text-md3-on-surface-variant">
          <Icon name="breadcrumbSep" size="20px" />
        </span>
      </button>
    {/each}
  </div>
</div>

<style>
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .settings-grid > button {
    border-right: 1px solid var(--explorer-border);
  }

  @media (max-width: 700px) {
    .settings-grid { grid-template-columns: minmax(0, 1fr); }
    .settings-grid > button { border-right: 0; }
  }
</style>
