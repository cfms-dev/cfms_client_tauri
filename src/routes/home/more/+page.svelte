<script lang="ts">
  // More page — user account overview and navigation hub.
  //
  // Shows the AccountBadge and menu entries to secondary pages:
  // Change Password, Settings, About, Trash, and Manage (admin only).
  //
  // Reference: MoreView in reference/src/include/ui/views/more.py

  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { authStore } from '$lib/stores.svelte';
  import { changePassword } from '$lib/api';
  import AccountBadge from '$lib/components/AccountBadge.svelte';
  import ChangePasswordDialog from '$lib/components/ChangePasswordDialog.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  const isAdmin = $derived(
    authStore.permissions.some((p) =>
      ['manage_system', 'view_audit_logs', 'list_users', 'list_groups',
       'apply_lockdown', 'bypass_lockdown'].includes(p)
    )
  );

  let showChangePassword = $state(false);
  let successMsg = $state<string | null>(null);

  interface MenuEntry {
    label: string;
    description: string;
    icon: IconName;
    /** Navigate to this route on click. */
    href?: string;
    /** Or run this action on click (takes precedence over href). */
    action?: () => void;
    hidden?: boolean;
  }

  const menuEntries = $derived<MenuEntry[]>([
    { label: $t('login.changePassword'), description: $t('more.changePasswordDescription'),
      icon: 'password', action: () => { successMsg = null; showChangePassword = true; } },
    { label: $t('settings.title'), description: $t('more.settingsDescription'),
      icon: 'settings', href: '/home/settings' },
    { label: $t('more.about'), description: $t('more.aboutDescription'),
      icon: 'info', href: '/home/about' },
    { label: $t('files.trash'), description: $t('more.trashDescription'),
      icon: 'delete', href: '/home/trash' },
    { label: $t('more.management'), description: $t('more.managementDescription'),
      icon: 'adminPanelSettings', href: '/home/manage', hidden: !isAdmin },
  ]);

  function handleEntry(entry: MenuEntry) {
    if (entry.action) entry.action();
    else if (entry.href) goto(entry.href);
  }

  /** Submit handler for the change-password dialog (logged-in self-change). */
  async function handleChangePassword(oldPassword: string, newPassword: string): Promise<void> {
    const username = authStore.username;
    if (!username) throw $t('more.notSignedInError');
    await changePassword(username, oldPassword, newPassword);
    showChangePassword = false;
    successMsg = $t('more.passwordChanged');
  }
</script>

<div class="p-6 space-y-6 max-w-lg mx-auto">
  <!-- Account badge -->
  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5">
    <AccountBadge />
  </div>

  <!-- Success banner (e.g. after a password change). -->
  {#if successMsg}
    <div
      class="bg-md3-primary/15 border border-md3-primary/30
             text-md3-on-surface text-sm rounded-xl p-3 flex items-start gap-2"
    >
      <span class="shrink-0 mt-0.5 text-md3-primary-emphasis"><Icon name="checkCircle" size="16px" /></span>
      <span>{successMsg}</span>
    </div>
  {/if}

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
        <span class="ml-auto text-md3-on-surface-variant">
          <Icon name="breadcrumbSep" size="20px" />
        </span>
      </button>
    {/each}
  </div>
</div>

<!-- Change Password dialog (logged-in self-change). -->
{#if showChangePassword}
  <ChangePasswordDialog
    username={authStore.username ?? ''}
    tip={$t('more.passwordTip')}
    onSubmit={handleChangePassword}
    onCancel={() => (showChangePassword = false)}
  />
{/if}
