<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    blockUser,
    changeGroupPermissions,
    changeUserGroups,
    createGroup,
    createUser,
    deleteGroup,
    deleteUser,
    getGroupInfo,
    getUserInfo,
    listGroups,
    listUserBlocks,
    listUsers,
    renameGroup,
    renameUser,
    resetUserPassword,
    unblockUser,
    viewAuditLogs,
    type AuditLogEntry,
    type ManagedGroup,
    type ManagedUser,
    type UserBlock,
    type UserBlockTarget,
  } from '$lib/api';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { ContextMenuItem } from '$lib/components/context-menu';
  import type { IconName } from '$lib/icons';

  type ManageTabKey = 'accounts' | 'groups' | 'logs';

  interface ManageTab {
    key: ManageTabKey;
    labelKey: string;
    icon: IconName;
  }

  type ManageContextTarget =
    | { kind: 'user'; user: ManagedUser }
    | { kind: 'group'; group: ManagedGroup };

  const tabs: ManageTab[] = [
    { key: 'accounts', labelKey: 'manage.accounts', icon: 'supervisorAccount' },
    { key: 'groups', labelKey: 'manage.groups', icon: 'groups' },
    { key: 'logs', labelKey: 'manage.logs', icon: 'article' },
  ];

  let activeTab = $state<ManageTabKey>('accounts');
  let users = $state<ManagedUser[]>([]);
  let groups = $state<ManagedGroup[]>([]);
  let auditEntries = $state<AuditLogEntry[]>([]);
  let auditTotal = $state(0);
  let auditOffset = $state(0);
  const auditCount = 100;

  let loadingUsers = $state(false);
  let loadingGroups = $state(false);
  let loadingLogs = $state(false);
  let busyKey = $state<string | null>(null);
  let error = $state<string | null>(null);
  let status = $state<string | null>(null);
  let detailTitle = $state<string | null>(null);
  let detailRows = $state<Array<{ label: string; value: string }>>([]);
  let blocksDialog = $state<{ username: string; blocks: UserBlock[] } | null>(null);
  let contextMenu = $state<{
    open: boolean;
    x: number;
    y: number;
    target: ManageContextTarget | null;
  }>({ open: false, x: 0, y: 0, target: null });

  const isAdmin = $derived(
    authStore.permissions.some((p) =>
      [
        'manage_system',
        'view_audit_logs',
        'list_users',
        'list_groups',
        'create_user',
        'create_group',
        'delete_user',
        'delete_group',
      ].includes(p),
    ),
  );
  const canListUsers = $derived(hasAnyPermission('list_users', 'manage_system'));
  const canListGroups = $derived(hasAnyPermission('list_groups', 'manage_system'));
  const canViewLogs = $derived(hasAnyPermission('view_audit_logs', 'manage_system'));
  const canBlock = $derived(hasAnyPermission('block', 'manage_system'));
  const canListBlocks = $derived(hasAnyPermission('list_user_blocks', 'manage_system'));
  const contextMenuItems = $derived.by<ContextMenuItem[]>(() => {
    if (!contextMenu.target) return [];
    if (contextMenu.target.kind === 'user') return getUserContextMenuItems(contextMenu.target.user);
    return getGroupContextMenuItems(contextMenu.target.group);
  });

  $effect(() => {
    if (!status) return;
    notificationStore.success(status);
    status = null;
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(() => {
    if (isAdmin) loadActiveTab();
  });

  function hasAnyPermission(...permissions: string[]) {
    return permissions.some((permission) => authStore.permissions.includes(permission));
  }

  function setActiveTab(tab: ManageTabKey) {
    activeTab = tab;
    loadActiveTab();
  }

  function loadActiveTab() {
    hideContextMenu();
    if (activeTab === 'accounts') loadUserList();
    else if (activeTab === 'groups') loadGroupList();
    else loadAuditLogPage(auditOffset);
  }

  function hideContextMenu() {
    contextMenu = { open: false, x: 0, y: 0, target: null };
  }

  function showUserContextMenu(event: MouseEvent, user: ManagedUser) {
    event.preventDefault();
    contextMenu = {
      open: true,
      x: event.clientX,
      y: event.clientY,
      target: { kind: 'user', user },
    };
  }

  function showGroupContextMenu(event: MouseEvent, group: ManagedGroup) {
    event.preventDefault();
    contextMenu = {
      open: true,
      x: event.clientX,
      y: event.clientY,
      target: { kind: 'group', group },
    };
  }

  function getUserContextMenuItems(user: ManagedUser): ContextMenuItem[] {
    const disabled = busyKey !== null;

    return [
      {
        id: 'view-user',
        label: 'Properties',
        icon: 'info',
        onSelect: () => handleViewUser(user),
        disabled,
      },
      { type: 'divider' },
      {
        id: 'rename-user',
        label: 'Change nickname',
        icon: 'edit',
        onSelect: () => handleRenameUser(user),
        disabled,
      },
      {
        id: 'edit-user-groups',
        label: 'Edit groups',
        icon: 'formatListBulleted',
        onSelect: () => handleEditUserGroups(user),
        disabled,
      },
      {
        id: 'reset-user-password',
        label: 'Reset password',
        icon: 'password',
        onSelect: () => handleResetPassword(user),
        disabled,
      },
      { type: 'divider', hidden: !canBlock && !canListBlocks },
      {
        id: 'block-user',
        label: 'Block user',
        icon: 'block',
        onSelect: () => handleBlockUser(user),
        disabled,
        hidden: !canBlock,
      },
      {
        id: 'view-user-blocks',
        label: 'View/Revoke blocks',
        icon: 'manageAccounts',
        onSelect: () => handleListBlocks(user),
        disabled,
        hidden: !canListBlocks,
      },
      { type: 'divider' },
      {
        id: 'delete-user',
        label: 'Delete',
        icon: 'delete',
        onSelect: () => handleDeleteUser(user),
        disabled,
        danger: true,
      },
    ];
  }

  function getGroupContextMenuItems(group: ManagedGroup): ContextMenuItem[] {
    const disabled = busyKey !== null;

    return [
      {
        id: 'rename-group',
        label: 'Rename',
        icon: 'edit',
        onSelect: () => handleRenameGroup(group),
        disabled,
      },
      {
        id: 'edit-group-permissions',
        label: 'Set permissions',
        icon: 'settings',
        onSelect: () => handleEditGroupPermissions(group),
        disabled,
      },
      { type: 'divider' },
      {
        id: 'delete-group',
        label: 'Delete',
        icon: 'groupRemove',
        onSelect: () => handleDeleteGroup(group),
        disabled,
        danger: true,
      },
    ];
  }

  async function loadUserList() {
    if (!canListUsers) return;
    loadingUsers = true;
    error = null;
    try {
      users = await listUsers();
    } catch (err) {
      error = formatError(err);
      users = [];
    } finally {
      loadingUsers = false;
    }
  }

  async function loadGroupList() {
    if (!canListGroups) return;
    loadingGroups = true;
    error = null;
    try {
      groups = await listGroups();
    } catch (err) {
      error = formatError(err);
      groups = [];
    } finally {
      loadingGroups = false;
    }
  }

  async function loadAuditLogPage(offset: number) {
    if (!canViewLogs) return;
    loadingLogs = true;
    error = null;
    try {
      auditOffset = Math.max(0, offset);
      const data = await viewAuditLogs(auditOffset, auditCount);
      auditEntries = data.entries;
      auditTotal = data.total;
    } catch (err) {
      error = formatError(err);
      auditEntries = [];
      auditTotal = 0;
    } finally {
      loadingLogs = false;
    }
  }

  async function handleCreateUser() {
    const username = window.prompt('Username:')?.trim();
    if (!username) return;
    const nickname = window.prompt('Nickname:', username)?.trim() ?? '';
    const password = window.prompt('Initial password:') ?? '';
    if (!password) return;

    await runBusy('create-user', async () => {
      await createUser(username, password, nickname);
      status = `User ${username} created.`;
      await loadUserList();
    });
  }

  async function handleRenameUser(user: ManagedUser) {
    const nickname = window.prompt('New nickname:', user.nickname ?? user.username);
    if (nickname === null) return;

    await runBusy(`rename-user:${user.username}`, async () => {
      await renameUser(user.username, nickname.trim());
      status = `User ${user.username} updated.`;
      await loadUserList();
    });
  }

  async function handleEditUserGroups(user: ManagedUser) {
    const allGroups = groups.length ? groups : await listGroups();
    if (!groups.length) groups = allGroups;
    const next = window.prompt(
      `Groups for ${user.username} (comma separated):`,
      (user.groups ?? []).join(', '),
    );
    if (next === null) return;

    const selected = splitList(next);
    await runBusy(`groups-user:${user.username}`, async () => {
      await changeUserGroups(user.username, selected);
      status = `Groups for ${user.username} updated.`;
      await loadUserList();
    });
  }

  async function handleResetPassword(user: ManagedUser) {
    const newPassword = window.prompt(`New password for ${user.username}:`) ?? '';
    if (!newPassword) return;
    const bypass = window.confirm('Bypass password requirements?');
    const forceUpdate = window.confirm('Force user to update password after next login?');

    await runBusy(`passwd-user:${user.username}`, async () => {
      await resetUserPassword(user.username, newPassword, bypass, forceUpdate);
      status = `Password for ${user.username} changed.`;
    });
  }

  async function handleViewUser(user: ManagedUser) {
    await runBusy(`view-user:${user.username}`, async () => {
      const info = await getUserInfo(user.username);
      detailTitle = `User Details: ${info.username}`;
      detailRows = [
        { label: 'Username', value: info.username },
        { label: 'Nickname', value: info.nickname || '-' },
        { label: 'Permissions', value: formatList(info.permissions) },
        { label: 'Groups', value: formatList(info.groups) },
        { label: 'Registered', value: formatDate(info.created_time) },
        { label: 'Last login', value: formatDate(info.last_login) },
        { label: 'Password changed', value: formatDate(info.passwd_last_modified) },
      ];
    });
  }

  async function handleDeleteUser(user: ManagedUser) {
    if (!window.confirm(`Delete user ${user.username}?`)) return;
    await runBusy(`delete-user:${user.username}`, async () => {
      await deleteUser(user.username);
      status = `User ${user.username} deleted.`;
      await loadUserList();
    });
  }

  async function handleBlockUser(user: ManagedUser) {
    const typesRaw = window.prompt('Block types (comma separated):', 'read, write, move');
    if (typesRaw === null) return;
    const blockTypes = splitList(typesRaw);
    if (blockTypes.length === 0) {
      error = 'Please select at least one block type.';
      return;
    }

    const targetTypeRaw = (window.prompt('Target type: all, directory, or document', 'all') ?? 'all')
      .trim()
      .toLowerCase();
    const targetType = ['directory', 'document'].includes(targetTypeRaw)
      ? (targetTypeRaw as 'directory' | 'document')
      : 'all';
    const target: UserBlockTarget = { type: targetType };
    if (targetType !== 'all') {
      const targetId = window.prompt(`${targetType} ID:`)?.trim();
      if (!targetId) return;
      target.id = targetId;
    }

    const expiry = window.prompt('Expiry time as local date/time, or blank for permanent:', '');
    const notAfter = expiry?.trim() ? new Date(expiry.trim()).getTime() / 1000 : null;
    if (expiry?.trim() && Number.isNaN(notAfter)) {
      error = 'Invalid expiry time.';
      return;
    }

    await runBusy(`block-user:${user.username}`, async () => {
      await blockUser(user.username, blockTypes, target, notAfter);
      status = `User ${user.username} blocked.`;
    });
  }

  async function handleListBlocks(user: ManagedUser) {
    await runBusy(`blocks-user:${user.username}`, async () => {
      const blocks = await listUserBlocks(user.username);
      blocksDialog = { username: user.username, blocks };
    });
  }

  async function handleUnblock(blockId: string) {
    if (!blocksDialog) return;
    await runBusy(`unblock:${blockId}`, async () => {
      await unblockUser(blockId);
      blocksDialog = {
        username: blocksDialog!.username,
        blocks: await listUserBlocks(blocksDialog!.username),
      };
      status = 'Block revoked.';
    });
  }

  async function handleCreateGroup() {
    const groupName = window.prompt('User group name:')?.trim();
    if (!groupName) return;
    const displayName = window.prompt('Display name:', groupName)?.trim() ?? groupName;

    await runBusy('create-group', async () => {
      await createGroup(groupName, displayName);
      status = `Group ${groupName} created.`;
      await loadGroupList();
    });
  }

  async function handleRenameGroup(group: ManagedGroup) {
    const displayName = window.prompt('New display name:', group.display_name ?? group.name);
    if (displayName === null || !displayName.trim()) return;

    await runBusy(`rename-group:${group.name}`, async () => {
      await renameGroup(group.name, displayName.trim());
      status = `Group ${group.name} updated.`;
      await loadGroupList();
    });
  }

  async function handleEditGroupPermissions(group: ManagedGroup) {
    const info = await getGroupInfo(group.name);
    const next = window.prompt(
      `Permissions for ${group.name} (comma separated):`,
      formatList(info.permissions),
    );
    if (next === null) return;

    await runBusy(`perms-group:${group.name}`, async () => {
      await changeGroupPermissions(group.name, splitList(next));
      status = `Permissions for ${group.name} updated.`;
      await loadGroupList();
    });
  }

  async function handleDeleteGroup(group: ManagedGroup) {
    if (!window.confirm(`Delete group ${group.name}?`)) return;
    await runBusy(`delete-group:${group.name}`, async () => {
      await deleteGroup(group.name);
      status = `Group ${group.name} deleted.`;
      await loadGroupList();
    });
  }

  async function runBusy(key: string, action: () => Promise<void>) {
    busyKey = key;
    error = null;
    try {
      await action();
    } catch (err) {
      error = formatError(err);
    } finally {
      busyKey = null;
    }
  }

  function splitList(value: string) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function formatList(value: string[] | undefined | null) {
    return value?.length ? value.join(', ') : '';
  }

  function formatDate(ts: number | null | undefined) {
    if (!ts || ts < 0) return '-';
    return new Date(ts * 1000).toLocaleString();
  }

  function formatValue(value: unknown) {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  function formatError(err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
</script>

<div class="p-6 space-y-4">
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => goto('/home/more')}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('manage.title')}
    </h1>

    {#if isAdmin}
      <button
        class="p-2 rounded-full text-md3-on-surface-variant
               hover:bg-md3-surface-container-high transition-colors disabled:opacity-50"
        title={$t('common.refresh')}
        onclick={loadActiveTab}
        disabled={loadingUsers || loadingGroups || loadingLogs || busyKey !== null}
      >
        <Icon name="refresh" size="20px" />
      </button>
    {/if}
  </div>

  {#if !isAdmin}
    <div class="bg-md3-error-container/60 border border-md3-error/30
                text-md3-on-error-container text-sm rounded-xl p-4">
      {$t('manage.noPermission')}
    </div>
  {:else}
    <div class="flex gap-1 bg-md3-surface-container-high/50 rounded-xl p-1 w-fit">
      {#each tabs as tab}
        <button
          class="px-4 py-1.5 text-xs rounded-lg font-medium transition-all flex items-center gap-1.5"
          class:bg-md3-primary-container={activeTab === tab.key}
          class:text-md3-on-primary-container={activeTab === tab.key}
          class:text-md3-on-surface-variant={activeTab !== tab.key}
          class:hover:bg-md3-surface-container-highest={activeTab !== tab.key}
          style="font-family: var(--font-md3-sans);"
          onclick={() => setActiveTab(tab.key)}
        >
          <Icon name={tab.icon} size="16px" />
          {$t(tab.labelKey)}
        </button>
      {/each}
    </div>

    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline overflow-hidden">
      {#if activeTab === 'accounts'}
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-md3-outline">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('manage.userAccounts')}
          </h2>
          <button
            class="px-3 py-1.5 text-xs rounded-full font-medium
                   bg-md3-primary-container text-md3-on-primary-container
                   hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
            style="font-family: var(--font-md3-sans);"
            onclick={handleCreateUser}
            disabled={!canListUsers || busyKey !== null}
          >
            <Icon name="groupAdd" size="14px" />
            {$t('manage.addAccount')}
          </button>
        </div>

        {#if !canListUsers}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            Missing permission: list_users
          </p>
        {:else if loadingUsers}
          {@render LoadingRow()}
        {:else if users.length === 0}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            No users found.
          </p>
        {:else}
          {#each users as user (user.username)}
            <div class="grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3
                        border-b border-md3-outline/50 last:border-b-0 items-center
                        hover:bg-md3-primary-container/10 transition-colors"
                 role="listitem"
                 oncontextmenu={(event) => showUserContextMenu(event, user)}>
              <span class="text-md3-primary"><Icon name="accountCircle" size="24px" /></span>
              <div class="min-w-0">
                <p class="text-sm font-medium text-md3-on-surface truncate">
                  {user.nickname || user.username}
                </p>
                <p class="text-xs text-md3-on-surface-variant truncate">
                  {user.username} | Groups: {formatList(user.groups) || '-'} | Last login: {formatDate(user.last_login)}
                </p>
              </div>
              <div class="flex flex-wrap justify-end gap-1">
                {@render ActionButton('info', 'Properties', () => handleViewUser(user), busyKey !== null)}
                {@render ActionButton('edit', 'Change nickname', () => handleRenameUser(user), busyKey !== null)}
                {@render ActionButton('formatListBulleted', 'Edit groups', () => handleEditUserGroups(user), busyKey !== null)}
                {@render ActionButton('password', 'Reset password', () => handleResetPassword(user), busyKey !== null)}
                {@render ActionButton('block', 'Block user', () => handleBlockUser(user), !canBlock || busyKey !== null)}
                {@render ActionButton('manageAccounts', 'View blocks', () => handleListBlocks(user), !canListBlocks || busyKey !== null)}
                {@render ActionButton('delete', 'Delete', () => handleDeleteUser(user), busyKey !== null, true)}
              </div>
            </div>
          {/each}
        {/if}
      {:else if activeTab === 'groups'}
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-md3-outline">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('manage.userGroups')}
          </h2>
          <button
            class="px-3 py-1.5 text-xs rounded-full font-medium
                   bg-md3-primary-container text-md3-on-primary-container
                   hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-1.5"
            style="font-family: var(--font-md3-sans);"
            onclick={handleCreateGroup}
            disabled={!canListGroups || busyKey !== null}
          >
            <Icon name="groupAdd" size="14px" />
            {$t('manage.addGroup')}
          </button>
        </div>

        {#if !canListGroups}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            Missing permission: list_groups
          </p>
        {:else if loadingGroups}
          {@render LoadingRow()}
        {:else if groups.length === 0}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            No groups found.
          </p>
        {:else}
          {#each groups as group (group.name)}
            <div class="grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3
                        border-b border-md3-outline/50 last:border-b-0 items-center
                        hover:bg-md3-primary-container/10 transition-colors"
                 role="listitem"
                 oncontextmenu={(event) => showGroupContextMenu(event, group)}>
              <span class="text-md3-primary"><Icon name="groups" size="24px" /></span>
              <div class="min-w-0">
                <p class="text-sm font-medium text-md3-on-surface truncate">
                  {group.display_name || group.name}
                </p>
                <p class="text-xs text-md3-on-surface-variant truncate">
                  {group.name} | Permissions: {formatList(group.permissions) || '-'} | Members: {formatList(group.members) || '-'}
                </p>
              </div>
              <div class="flex flex-wrap justify-end gap-1">
                {@render ActionButton('edit', 'Rename', () => handleRenameGroup(group), busyKey !== null)}
                {@render ActionButton('settings', 'Set permissions', () => handleEditGroupPermissions(group), busyKey !== null)}
                {@render ActionButton('groupRemove', 'Delete', () => handleDeleteGroup(group), busyKey !== null, true)}
              </div>
            </div>
          {/each}
        {/if}
      {:else}
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-md3-outline">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('manage.auditLogs')}
          </h2>
          <div class="flex items-center gap-2">
            <span class="text-xs text-md3-on-surface-variant">
              {auditTotal === 0 ? '0 of 0' : `${auditOffset + 1} - ${auditOffset + auditEntries.length} of ${auditTotal}`}
            </span>
            <button
              class="p-1.5 rounded-full text-md3-on-surface-variant hover:bg-md3-surface-container-high disabled:opacity-40"
              title="Previous"
              onclick={() => loadAuditLogPage(auditOffset - auditCount)}
              disabled={auditOffset <= 0 || loadingLogs}
            >
              <Icon name="navigateBefore" size="18px" />
            </button>
            <button
              class="p-1.5 rounded-full text-md3-on-surface-variant hover:bg-md3-surface-container-high disabled:opacity-40"
              title="Next"
              onclick={() => loadAuditLogPage(auditOffset + auditCount)}
              disabled={auditOffset + auditCount >= auditTotal || loadingLogs}
            >
              <Icon name="navigateNext" size="18px" />
            </button>
          </div>
        </div>

        {#if !canViewLogs}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            Missing permission: view_audit_logs
          </p>
        {:else if loadingLogs}
          {@render LoadingRow()}
        {:else if auditEntries.length === 0}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            No audit logs found.
          </p>
        {:else}
          <div class="overflow-x-auto">
            <table class="min-w-[920px] w-full text-left text-sm">
              <thead class="bg-md3-surface-container-high/50 text-xs uppercase text-md3-on-surface-variant">
                <tr>
                  <th class="px-3 py-2">ID</th>
                  <th class="px-3 py-2">Action</th>
                  <th class="px-3 py-2">Username</th>
                  <th class="px-3 py-2">Target</th>
                  <th class="px-3 py-2">Result</th>
                  <th class="px-3 py-2">Remote</th>
                  <th class="px-3 py-2 text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {#each auditEntries as entry (entry.id)}
                  <tr class="border-t border-md3-outline/50 text-md3-on-surface">
                    <td class="px-3 py-2 align-top text-xs text-md3-on-surface-variant">{entry.id}</td>
                    <td class="px-3 py-2 align-top">{entry.action}</td>
                    <td class="px-3 py-2 align-top">{entry.username}</td>
                    <td class="px-3 py-2 align-top max-w-52 truncate" title={entry.target}>{entry.target}</td>
                    <td class="px-3 py-2 align-top">{entry.result}</td>
                    <td class="px-3 py-2 align-top">{entry.remote_address}</td>
                    <td class="px-3 py-2 align-top text-right whitespace-nowrap">{formatDate(entry.logged_time)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<ContextMenu
  open={contextMenu.open}
  x={contextMenu.x}
  y={contextMenu.y}
  items={contextMenuItems}
  onClose={hideContextMenu}
/>

{#if detailTitle}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    role="presentation"
    onclick={() => (detailTitle = null)}
  >
    <div
      class="bg-md3-surface-container border border-md3-outline rounded-xl w-full max-w-lg shadow-2xl"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === 'Escape') detailTitle = null;
      }}
    >
      <div class="flex items-center justify-between px-5 py-4 border-b border-md3-outline">
        <h3 class="text-base font-semibold text-md3-on-surface">{detailTitle}</h3>
        <button class="p-1 rounded-full hover:bg-md3-surface-container-high" onclick={() => (detailTitle = null)}>
          <Icon name="close" size="20px" />
        </button>
      </div>
      <div class="p-5 space-y-3">
        {#each detailRows as row}
          <div class="grid grid-cols-[140px_1fr] gap-3 text-sm">
            <span class="text-md3-on-surface-variant">{row.label}</span>
            <span class="text-md3-on-surface break-words">{row.value || '-'}</span>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if blocksDialog}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    role="presentation"
    onclick={() => (blocksDialog = null)}
  >
    <div
      class="bg-md3-surface-container border border-md3-outline rounded-xl w-full max-w-2xl shadow-2xl"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => {
        if (e.key === 'Escape') blocksDialog = null;
      }}
    >
      <div class="flex items-center justify-between px-5 py-4 border-b border-md3-outline">
        <h3 class="text-base font-semibold text-md3-on-surface">Blocks: {blocksDialog.username}</h3>
        <button class="p-1 rounded-full hover:bg-md3-surface-container-high" onclick={() => (blocksDialog = null)}>
          <Icon name="close" size="20px" />
        </button>
      </div>
      <div class="p-5 space-y-3 max-h-[70vh] overflow-auto">
        {#if blocksDialog.blocks.length === 0}
          <p class="text-sm text-md3-on-surface-variant">No active blocks found.</p>
        {:else}
          {#each blocksDialog.blocks as block (block.block_id)}
            <div class="border border-md3-outline rounded-xl p-3 space-y-2">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-md3-on-surface truncate">
                    {formatList(block.block_types)} | {block.target_type ?? 'all'}{block.target_id ? `: ${block.target_id}` : ''}
                  </p>
                  <p class="text-xs text-md3-on-surface-variant break-all">ID: {block.block_id}</p>
                </div>
                <button
                  class="px-3 py-1 text-xs rounded-full bg-md3-error-container
                         text-md3-on-error-container hover:brightness-110 disabled:opacity-50"
                  onclick={() => handleUnblock(block.block_id)}
                  disabled={busyKey !== null}
                >
                  Revoke
                </button>
              </div>
              <p class="text-xs text-md3-on-surface-variant">
                Created: {formatDate(block.timestamp)} | Period: {formatDate(block.not_before)} - {block.not_after === -1 ? 'Permanent' : formatDate(block.not_after)}
              </p>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

{#snippet LoadingRow()}
  <div class="flex items-center gap-2 px-4 py-8 text-sm text-md3-on-surface-variant justify-center">
    <span class="animate-spin"><Icon name="refresh" size="18px" /></span>
    {$t('common.loadingEllipsis')}
  </div>
{/snippet}

{#snippet ActionButton(icon: IconName, title: string, onClick: () => void | Promise<void>, disabled = false, danger = false)}
  <button
    class="p-1.5 rounded-full transition-colors disabled:opacity-40
           {danger
             ? 'text-md3-error hover:bg-md3-error-container/40'
             : 'text-md3-on-surface-variant hover:bg-md3-primary-container/40 hover:text-md3-primary'}"
    {title}
    onclick={onClick}
    {disabled}
  >
    <Icon name={icon} size="18px" />
  </button>
{/snippet}
