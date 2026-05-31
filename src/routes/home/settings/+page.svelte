<script lang="ts">
  // Settings overview page
  //
  // List of settings categories that navigate to sub-pages.
  //
  // Reference: SettingsModel in reference/src/include/ui/models/settings/overview.py

  import { goto } from '$app/navigation';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  interface SettingsEntry {
    label: string;
    description: string;
    icon: IconName;
    href: string;
  }

  const entries: SettingsEntry[] = [
    { label: 'Language', description: 'Application display language',
      icon: 'language', href: '/home/settings' },
    { label: 'Connection', description: 'Proxy, TLS and timeout settings',
      icon: 'connect', href: '/home/settings' },
    { label: 'Storage', description: 'Cache path and storage management',
      icon: 'storage', href: '/home/settings' },
    { label: 'Security', description: 'Encryption parameters and CA certificates',
      icon: 'security', href: '/home/settings' },
    { label: 'Updates', description: 'Software update channel and checking',
      icon: 'browserUpdated', href: '/home/settings' },
    { label: 'Two-Factor Auth', description: '2FA setup and backup codes',
      icon: 'verifiedUser', href: '/home/settings' },
  ];
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <!-- Back button -->
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => goto('/home/more')}
  >
    <Icon name="arrowBack" size="18px" />
    Back
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    Settings
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline overflow-hidden">
    {#each entries as entry, i}
      <button
        class="w-full flex items-center gap-4 px-5 py-3.5 text-left
               hover:bg-md3-surface-container-high/50
               transition-colors
               {i < entries.length - 1 ? 'border-b border-md3-outline/50' : ''}"
        onclick={() => goto(entry.href)}
      >
        <span class="text-md3-primary shrink-0">
          <Icon name={entry.icon} size="24px" />
        </span>
        <div class="min-w-0">
          <p class="text-sm font-medium text-md3-on-surface"
             style="font-family: var(--font-md3-sans);">
            {entry.label}
          </p>
          <p class="text-xs text-md3-on-surface-variant truncate">
            {entry.description}
          </p>
        </div>
        <span class="ml-auto text-md3-on-surface-variant">
          <Icon name="breadcrumbSep" size="20px" />
        </span>
      </button>
    {/each}
  </div>
</div>
