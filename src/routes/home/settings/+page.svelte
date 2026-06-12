<script lang="ts">
  // Settings overview page
  //
  // List of settings categories that navigate to sub-pages.
  //
  // Reference: SettingsModel in reference/src/include/ui/models/settings/overview.py

  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { _ as t } from 'svelte-i18n';
  import { authStore } from '$lib/stores.svelte';
  import { navigateUp } from '$lib/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  interface SettingsEntry {
    labelKey: string;
    descriptionKey: string;
    icon: IconName;
    href: string;
    requiresAuth?: boolean;
  }

  const entries: SettingsEntry[] = [
    { labelKey: 'settings.language.title', descriptionKey: 'settings.language.description',
      icon: 'language', href: '/home/settings/language' },
    { labelKey: 'settings.connection.title', descriptionKey: 'settings.connection.description',
      icon: 'connect', href: '/home/settings/connection' },
    { labelKey: 'settings.storage.title', descriptionKey: 'settings.storage.description',
      icon: 'storage', href: '/home/settings/storage', requiresAuth: true },
    { labelKey: 'settings.security.title', descriptionKey: 'settings.security.description',
      icon: 'security', href: '/home/settings/security' },
    { labelKey: 'settings.updates.title', descriptionKey: 'settings.updates.description',
      icon: 'browserUpdated', href: '/home/settings/updates' },
    { labelKey: 'settings.twofa.title', descriptionKey: 'settings.twofa.description',
      icon: 'verifiedUser', href: '/home/settings/twofa', requiresAuth: true },
  ];

  const visibleEntries = $derived(entries.filter((entry) => !entry.requiresAuth || authStore.isLoggedIn));

  function goBack() {
    void navigateUp(page.url.pathname);
  }
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <!-- Back button -->
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={goBack}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    {$t('settings.title')}
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
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
