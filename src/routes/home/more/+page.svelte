<script lang="ts">
  // More page — user account overview and navigation hub.
  //
  // Shows the AccountBadge and menu entries to secondary pages:
  // Settings, About, Trash, and Manage (admin only).
  //
  // Reference: MoreView in reference/src/include/ui/views/more.py

  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { authStore } from '$lib/stores.svelte';
  import { appUpdateState } from '$lib/app-update-state.svelte';
  import AccountBadge from '$lib/components/AccountBadge.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import UserAvatarPicker from '$lib/components/UserAvatarPicker.svelte';
  import type { IconName } from '$lib/icons';

  const isAdmin = $derived(
    authStore.permissions.some((p) =>
      ['manage_system', 'view_audit_logs', 'list_users', 'list_groups'].includes(p)
    )
  );

  let showAvatarPicker = $state(false);

  interface MenuEntry {
    label: string;
    description: string;
    icon: IconName;
    /** Navigate to this route on click. */
    href?: string;
    /** Or run this action on click (takes precedence over href). */
    action?: () => void;
    badge?: boolean;
    hidden?: boolean;
  }

  const menuEntries = $derived<MenuEntry[]>([
    { label: $t('login.changePassword'), description: $t('more.changePasswordDescription'),
      icon: 'password', href: '/home/settings/password' },
    { label: $t('settings.title'), description: $t('more.settingsDescription'),
      icon: 'settings', href: '/home/settings' },
    { label: $t('files.trash'), description: $t('more.trashDescription'),
      icon: 'delete', href: '/home/trash', hidden: !authStore.permissions.includes('list_deleted_items') },
    { label: $t('more.management'), description: $t('more.managementDescription'),
      icon: 'adminPanelSettings', href: '/home/manage', hidden: !isAdmin },
    { label: $t('more.about'), description: $t('more.aboutDescription'),
      icon: 'info', href: '/home/about', badge: appUpdateState.update !== null },
  ]);

  const visibleMenuEntries = $derived(menuEntries.filter((e) => !e.hidden));

  function handleEntry(entry: MenuEntry) {
    if (entry.action) entry.action();
    else if (entry.href) goto(entry.href);
  }

</script>

<div class="workspace-page account-page p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
  <!-- Account badge -->
  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5">
    <AccountBadge
      onAvatarClick={() => (showAvatarPicker = true)}
    />
  </div>

  <!-- Menu entries -->
  <div class="account-menu-grid bg-md3-surface-container/70 backdrop-blur-sm rounded-lg
              border border-md3-outline overflow-hidden">
    {#each visibleMenuEntries as entry, i}
      <button
        class="w-full flex items-center gap-4 px-5 py-3.5 text-left
               hover:bg-md3-surface-container-high/50
               transition-colors
               {i < visibleMenuEntries.length - 1
                 ? 'border-b border-md3-outline/50' : ''}"
        onclick={() => handleEntry(entry)}
      >
        <span class="text-md3-primary-emphasis shrink-0">
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
        <span class="ml-auto flex items-center gap-2 text-md3-on-surface-variant">
          {#if entry.badge}
            <span
              class="h-2.5 w-2.5 rounded-full bg-md3-error shadow-[0_0_0_3px_rgba(248,113,113,0.18)]"
              aria-label={$t('settings.updates.available')}
              title={$t('settings.updates.available')}
            ></span>
          {/if}
          <Icon name="breadcrumbSep" size="20px" />
        </span>
      </button>
    {/each}
  </div>
</div>

<style>
  .account-menu-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .account-menu-grid > button { border-right: 1px solid var(--explorer-border); }

  @media (max-width: 700px) {
    .account-menu-grid { grid-template-columns: minmax(0, 1fr); }
    .account-menu-grid > button { border-right: 0; }
  }
</style>

{#if showAvatarPicker}
  <UserAvatarPicker onClose={() => (showAvatarPicker = false)} />
{/if}
