<script lang="ts">
  // More page — user account overview and navigation hub.
  //
  // Shows the AccountBadge and menu entries to secondary pages:
  // Change Password, Settings, About, Trash, and Manage (admin only).
  //
  // Reference: MoreView in reference/src/include/ui/views/more.py

  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores.svelte';
  import AccountBadge from '$lib/components/AccountBadge.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  const isAdmin = $derived(
    authStore.permissions.some((p) =>
      ['manage_system', 'view_audit_logs', 'list_users', 'list_groups',
       'apply_lockdown', 'bypass_lockdown'].includes(p)
    )
  );

  interface MenuEntry {
    label: string;
    description: string;
    icon: IconName;
    href: string;
    hidden?: boolean;
  }

  const menuEntries = $derived<MenuEntry[]>([
    { label: 'Change Password', description: 'Update your account password',
      icon: 'password', href: '/home/more' }, // TODO: open dialog
    { label: 'Settings', description: 'Application preferences and configuration',
      icon: 'settings', href: '/home/settings' },
    { label: 'About', description: 'Version info and software updates',
      icon: 'info', href: '/home/about' },
    { label: 'Trash', description: 'Recycle bin for deleted files',
      icon: 'delete', href: '/home/trash' },
    { label: 'Management', description: 'User and group administration',
      icon: 'adminPanelSettings', href: '/home/manage', hidden: !isAdmin },
  ]);
</script>

<div class="p-6 space-y-6 max-w-lg mx-auto">
  <!-- Account badge -->
  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5">
    <AccountBadge />
  </div>

  <!-- Menu entries -->
  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline overflow-hidden">
    {#each menuEntries.filter((e) => !e.hidden) as entry, i}
      <button
        class="w-full flex items-center gap-4 px-5 py-3.5 text-left
               hover:bg-md3-surface-container-high/50
               transition-colors
               {i < menuEntries.filter((e) => !e.hidden).length - 1
                 ? 'border-b border-md3-outline/50' : ''}"
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
