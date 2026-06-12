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
  import { dialogStore } from '$lib/dialogs.svelte';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import BlockUserDialog from '$lib/components/BlockUserDialog.svelte';
  import ManageListEditorDialog from '$lib/components/ManageListEditorDialog.svelte';
  import ResetUserPasswordDialog from '$lib/components/ResetUserPasswordDialog.svelte';
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

  type ManageDialogState =
    | { kind: 'user-groups'; user: ManagedUser }
    | { kind: 'reset-password'; user: ManagedUser }
    | { kind: 'block-user'; user: ManagedUser }
    | { kind: 'group-permissions'; group: ManagedGroup }
    | null;

  interface ListEditorItem {
    id: string;
    label?: string;
    meta?: string;
  }

  interface ListEditorData {
    items: ListEditorItem[];
    selected: string[];
  }

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
  let activeDialog = $state<ManageDialogState>(null);
  let expandedActionRow = $state<string | null>(null);
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
    expandedActionRow = null;
    if (activeTab === 'accounts') loadUserList();
    else if (activeTab === 'groups') loadGroupList();
    else loadAuditLogPage(auditOffset);
  }

  function toggleActionRow(key: string) {
    expandedActionRow = expandedActionRow === key ? null : key;
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
        label: $t('manage.properties'),
        icon: 'info',
        onSelect: () => handleViewUser(user),
        disabled,
      },
      { type: 'divider' },
      {
        id: 'rename-user',
        label: $t('manage.changeNickname'),
        icon: 'edit',
        onSelect: () => handleRenameUser(user),
        disabled,
      },
      {
        id: 'edit-user-groups',
        label: $t('manage.editGroups'),
        icon: 'formatListBulleted',
        onSelect: () => handleEditUserGroups(user),
        disabled,
      },
      {
        id: 'reset-user-password',
        label: $t('manage.resetPassword'),
        icon: 'password',
        onSelect: () => handleResetPassword(user),
        disabled,
      },
      { type: 'divider', hidden: !canBlock && !canListBlocks },
      {
        id: 'block-user',
        label: $t('manage.blockUser'),
        icon: 'block',
        onSelect: () => handleBlockUser(user),
        disabled,
        hidden: !canBlock,
      },
      {
        id: 'view-user-blocks',
        label: $t('manage.viewBlocks'),
        icon: 'manageAccounts',
        onSelect: () => handleListBlocks(user),
        disabled,
        hidden: !canListBlocks,
      },
      { type: 'divider' },
      {
        id: 'delete-user',
        label: $t('common.delete'),
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
        label: $t('manage.rename'),
        icon: 'edit',
        onSelect: () => handleRenameGroup(group),
        disabled,
      },
      {
        id: 'edit-group-permissions',
        label: $t('manage.setPermissions'),
        icon: 'settings',
        onSelect: () => handleEditGroupPermissions(group),
        disabled,
      },
      { type: 'divider' },
      {
        id: 'delete-group',
        label: $t('common.delete'),
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
    const username = (await dialogStore.prompt($t('manage.usernamePrompt')))?.trim();
    if (!username) return;
    const nickname = (await dialogStore.prompt($t('manage.nicknamePrompt'), username))?.trim() ?? '';
    const password = await dialogStore.prompt({
      message: $t('manage.initialPasswordPrompt'),
      inputType: 'password',
    }) ?? '';
    if (!password) return;

    await runBusy('create-user', async () => {
      await createUser(username, password, nickname);
      status = $t('manage.userCreated', { values: { username } });
      await loadUserList();
    });
  }

  async function handleRenameUser(user: ManagedUser) {
    const nickname = await dialogStore.prompt($t('manage.newNicknamePrompt'), user.nickname ?? user.username);
    if (nickname === null) return;

    await runBusy(`rename-user:${user.username}`, async () => {
      await renameUser(user.username, nickname.trim());
      status = $t('manage.userUpdated', { values: { username: user.username } });
      await loadUserList();
    });
  }

  async function handleEditUserGroups(user: ManagedUser) {
    activeDialog = { kind: 'user-groups', user };
  }

  async function handleResetPassword(user: ManagedUser) {
    activeDialog = { kind: 'reset-password', user };
  }

  async function handleViewUser(user: ManagedUser) {
    await runBusy(`view-user:${user.username}`, async () => {
      const info = await getUserInfo(user.username);
      detailTitle = $t('manage.userDetailsFor', { values: { username: info.username } });
      detailRows = [
        { label: $t('manage.username'), value: info.username },
        { label: $t('manage.nickname'), value: info.nickname || '-' },
        { label: $t('manage.permissions'), value: formatList(info.permissions) },
        { label: $t('manage.groups'), value: formatList(info.groups) },
        { label: $t('manage.registered'), value: formatDate(info.created_time) },
        { label: $t('manage.lastLogin'), value: formatDate(info.last_login) },
        { label: $t('manage.passwordChangedAt'), value: formatDate(info.passwd_last_modified) },
      ];
    });
  }

  async function handleDeleteUser(user: ManagedUser) {
    if (!(await dialogStore.confirm({
      title: $t('common.delete'),
      message: $t('manage.deleteUserConfirm', { values: { username: user.username } }),
      confirmLabel: $t('common.delete'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    }))) return;
    await runBusy(`delete-user:${user.username}`, async () => {
      await deleteUser(user.username);
      status = $t('manage.userDeleted', { values: { username: user.username } });
      await loadUserList();
    });
  }

  async function handleBlockUser(user: ManagedUser) {
    activeDialog = { kind: 'block-user', user };
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
      status = $t('manage.blockRevoked');
    });
  }

  async function handleCreateGroup() {
    const groupName = (await dialogStore.prompt($t('manage.groupNamePrompt')))?.trim();
    if (!groupName) return;
    const displayName = (await dialogStore.prompt($t('manage.displayNamePrompt'), groupName))?.trim() ?? groupName;

    await runBusy('create-group', async () => {
      await createGroup(groupName, displayName);
      status = $t('manage.groupCreated', { values: { group: groupName } });
      await loadGroupList();
    });
  }

  async function handleRenameGroup(group: ManagedGroup) {
    const displayName = await dialogStore.prompt($t('manage.newDisplayNamePrompt'), group.display_name ?? group.name);
    if (displayName === null || !displayName.trim()) return;

    await runBusy(`rename-group:${group.name}`, async () => {
      await renameGroup(group.name, displayName.trim());
      status = $t('manage.groupUpdated', { values: { group: group.name } });
      await loadGroupList();
    });
  }

  async function handleEditGroupPermissions(group: ManagedGroup) {
    activeDialog = { kind: 'group-permissions', group };
  }

  async function loadUserGroupEditorData(user: ManagedUser): Promise<ListEditorData> {
    const [allGroups, userInfo] = await Promise.all([
      listGroups(),
      getUserInfo(user.username),
    ]);
    groups = allGroups;

    return {
      items: allGroups.map((group) => ({
        id: group.name,
        label: group.display_name || group.name,
        meta: group.display_name && group.display_name !== group.name ? group.name : undefined,
      })),
      selected: userInfo.groups ?? [],
    };
  }

  async function saveUserGroups(user: ManagedUser, selected: string[]) {
    await changeUserGroups(user.username, selected);
    status = $t('manage.userGroupsUpdated', { values: { username: user.username } });
    activeDialog = null;
    await loadUserList();
  }

  async function saveResetPassword(
    user: ManagedUser,
    password: string,
    bypassRequirements: boolean,
    forceUpdateAfterLogin: boolean,
  ) {
    await resetUserPassword(user.username, password, bypassRequirements, forceUpdateAfterLogin);
    status = $t('manage.passwordChanged', { values: { username: user.username } });
    activeDialog = null;
  }

  async function saveBlockUser(
    user: ManagedUser,
    blockTypes: string[],
    target: UserBlockTarget,
    notAfter: number | null,
  ) {
    await blockUser(user.username, blockTypes, target, notAfter);
    status = $t('manage.userBlocked', { values: { username: user.username } });
    activeDialog = null;
  }

  async function loadGroupPermissionEditorData(group: ManagedGroup): Promise<ListEditorData> {
    const info = await getGroupInfo(group.name);
    return {
      items: (info.permissions ?? []).map((permission) => ({
        id: permission,
        label: permission,
      })),
      selected: info.permissions ?? [],
    };
  }

  async function saveGroupPermissions(group: ManagedGroup, selected: string[]) {
    await changeGroupPermissions(group.name, selected);
    status = $t('manage.groupPermissionsUpdated', { values: { group: group.name } });
    activeDialog = null;
    await loadGroupList();
  }

  async function refreshActiveUserGroups() {
    if (activeDialog?.kind !== 'user-groups') return { items: [], selected: [] };
    return loadUserGroupEditorData(activeDialog.user);
  }

  async function saveActiveUserGroups(selected: string[]) {
    if (activeDialog?.kind !== 'user-groups') return;
    await saveUserGroups(activeDialog.user, selected);
  }

  async function saveActiveResetPassword(
    password: string,
    bypassRequirements: boolean,
    forceUpdateAfterLogin: boolean,
  ) {
    if (activeDialog?.kind !== 'reset-password') return;
    await saveResetPassword(
      activeDialog.user,
      password,
      bypassRequirements,
      forceUpdateAfterLogin,
    );
  }

  async function saveActiveBlockUser(
    blockTypes: string[],
    target: UserBlockTarget,
    notAfter: number | null,
  ) {
    if (activeDialog?.kind !== 'block-user') return;
    await saveBlockUser(activeDialog.user, blockTypes, target, notAfter);
  }

  async function refreshActiveGroupPermissions() {
    if (activeDialog?.kind !== 'group-permissions') return { items: [], selected: [] };
    return loadGroupPermissionEditorData(activeDialog.group);
  }

  async function saveActiveGroupPermissions(selected: string[]) {
    if (activeDialog?.kind !== 'group-permissions') return;
    await saveGroupPermissions(activeDialog.group, selected);
  }

  async function handleDeleteGroup(group: ManagedGroup) {
    if (!(await dialogStore.confirm({
      title: $t('common.delete'),
      message: $t('manage.deleteGroupConfirm', { values: { group: group.name } }),
      confirmLabel: $t('common.delete'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    }))) return;
    await runBusy(`delete-group:${group.name}`, async () => {
      await deleteGroup(group.name);
      status = $t('manage.groupDeleted', { values: { group: group.name } });
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

  function formatList(value: string[] | undefined | null) {
    return value?.length ? value.join(', ') : $t('common.none');
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

  function formatBlockTarget(block: UserBlock) {
    const targetType = block.target_type ?? 'all';
    if (targetType === 'all') return $t('tasks.all');
    if (block.target_id) return `${targetType}: ${block.target_id}`;
    return targetType;
  }

  function formatError(err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
</script>

<div class="space-y-4 p-4 sm:p-6">
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
            {$t('manage.missingPermission', { values: { permission: 'list_users' } })}
          </p>
        {:else if loadingUsers}
          {@render LoadingRow()}
        {:else if users.length === 0}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            {$t('manage.noUsers')}
          </p>
        {:else}
          {#each users as user (user.username)}
            {@const actionKey = `user:${user.username}`}
            <div class="grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3
                        border-b border-md3-outline/50 last:border-b-0 items-center
                        hover:bg-md3-primary-container/10 transition-colors"
                 role="listitem"
                 oncontextmenu={(event) => showUserContextMenu(event, user)}>
              <span class="text-md3-primary-emphasis"><Icon name="accountCircle" size="24px" /></span>
              <div class="min-w-0">
                <p class="text-sm font-medium text-md3-on-surface truncate">
                  {user.nickname || user.username}
                </p>
                <p class="text-xs text-md3-on-surface-variant truncate">
                  {$t('manage.userSummary', {
                    values: {
                      username: user.username,
                      groups: formatList(user.groups),
                      lastLogin: formatDate(user.last_login),
                    },
                  })}
                </p>
              </div>
              <button
                class="rounded-full p-1.5 text-md3-on-surface-variant transition-colors hover:bg-md3-primary-container/40 hover:text-md3-primary-emphasis sm:hidden"
                title={$t('tasks.moreActions')}
                aria-label={$t('tasks.moreActions')}
                onclick={() => toggleActionRow(actionKey)}
              >
                <Icon name={expandedActionRow === actionKey ? 'expandLess' : 'moreVert'} size="20px" />
              </button>
              <div class="hidden flex-wrap justify-end gap-1 sm:flex">
                {@render ActionButton('info', $t('manage.properties'), () => handleViewUser(user), busyKey !== null)}
                {@render ActionButton('edit', $t('manage.changeNickname'), () => handleRenameUser(user), busyKey !== null)}
                {@render ActionButton('formatListBulleted', $t('manage.editGroups'), () => handleEditUserGroups(user), busyKey !== null)}
                {@render ActionButton('password', $t('manage.resetPassword'), () => handleResetPassword(user), busyKey !== null)}
                {@render ActionButton('block', $t('manage.blockUser'), () => handleBlockUser(user), !canBlock || busyKey !== null)}
                {@render ActionButton('manageAccounts', $t('manage.viewBlocks'), () => handleListBlocks(user), !canListBlocks || busyKey !== null)}
                {@render ActionButton('delete', $t('common.delete'), () => handleDeleteUser(user), busyKey !== null, true)}
              </div>
              {#if expandedActionRow === actionKey}
                <div class="col-span-3 -mx-1 mt-1 rounded-lg border border-md3-outline/50 bg-md3-surface-container-high/40 px-2 py-2 sm:hidden animate-fade-scale-in">
                  <div class="flex flex-wrap justify-end gap-1">
                    {@render ActionButton('info', $t('manage.properties'), () => handleViewUser(user), busyKey !== null)}
                    {@render ActionButton('edit', $t('manage.changeNickname'), () => handleRenameUser(user), busyKey !== null)}
                    {@render ActionButton('formatListBulleted', $t('manage.editGroups'), () => handleEditUserGroups(user), busyKey !== null)}
                    {@render ActionButton('password', $t('manage.resetPassword'), () => handleResetPassword(user), busyKey !== null)}
                    {@render ActionButton('block', $t('manage.blockUser'), () => handleBlockUser(user), !canBlock || busyKey !== null)}
                    {@render ActionButton('manageAccounts', $t('manage.viewBlocks'), () => handleListBlocks(user), !canListBlocks || busyKey !== null)}
                    {@render ActionButton('delete', $t('common.delete'), () => handleDeleteUser(user), busyKey !== null, true)}
                  </div>
                </div>
              {/if}
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
            {$t('manage.missingPermission', { values: { permission: 'list_groups' } })}
          </p>
        {:else if loadingGroups}
          {@render LoadingRow()}
        {:else if groups.length === 0}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            {$t('manage.noGroups')}
          </p>
        {:else}
          {#each groups as group (group.name)}
            {@const actionKey = `group:${group.name}`}
            <div class="grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-3
                        border-b border-md3-outline/50 last:border-b-0 items-center
                        hover:bg-md3-primary-container/10 transition-colors"
                 role="listitem"
                 oncontextmenu={(event) => showGroupContextMenu(event, group)}>
              <span class="text-md3-primary-emphasis"><Icon name="groups" size="24px" /></span>
              <div class="min-w-0">
                <p class="text-sm font-medium text-md3-on-surface truncate">
                  {group.display_name || group.name}
                </p>
                <p class="text-xs text-md3-on-surface-variant truncate">
                  {$t('manage.groupSummary', {
                    values: {
                      name: group.name,
                      permissions: formatList(group.permissions),
                      members: formatList(group.members),
                    },
                  })}
                </p>
              </div>
              <button
                class="rounded-full p-1.5 text-md3-on-surface-variant transition-colors hover:bg-md3-primary-container/40 hover:text-md3-primary-emphasis sm:hidden"
                title={$t('tasks.moreActions')}
                aria-label={$t('tasks.moreActions')}
                onclick={() => toggleActionRow(actionKey)}
              >
                <Icon name={expandedActionRow === actionKey ? 'expandLess' : 'moreVert'} size="20px" />
              </button>
              <div class="hidden flex-wrap justify-end gap-1 sm:flex">
                {@render ActionButton('edit', $t('manage.rename'), () => handleRenameGroup(group), busyKey !== null)}
                {@render ActionButton('settings', $t('manage.setPermissions'), () => handleEditGroupPermissions(group), busyKey !== null)}
                {@render ActionButton('groupRemove', $t('common.delete'), () => handleDeleteGroup(group), busyKey !== null, true)}
              </div>
              {#if expandedActionRow === actionKey}
                <div class="col-span-3 -mx-1 mt-1 rounded-lg border border-md3-outline/50 bg-md3-surface-container-high/40 px-2 py-2 sm:hidden animate-fade-scale-in">
                  <div class="flex flex-wrap justify-end gap-1">
                    {@render ActionButton('edit', $t('manage.rename'), () => handleRenameGroup(group), busyKey !== null)}
                    {@render ActionButton('settings', $t('manage.setPermissions'), () => handleEditGroupPermissions(group), busyKey !== null)}
                    {@render ActionButton('groupRemove', $t('common.delete'), () => handleDeleteGroup(group), busyKey !== null, true)}
                  </div>
                </div>
              {/if}
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
              {auditTotal === 0
                ? $t('manage.auditRangeEmpty')
                : $t('manage.auditRange', {
                    values: {
                      start: auditOffset + 1,
                      end: auditOffset + auditEntries.length,
                      total: auditTotal,
                    },
                  })}
            </span>
            <button
              class="p-1.5 rounded-full text-md3-on-surface-variant hover:bg-md3-surface-container-high disabled:opacity-40"
              title={$t('common.previous')}
              onclick={() => loadAuditLogPage(auditOffset - auditCount)}
              disabled={auditOffset <= 0 || loadingLogs}
            >
              <Icon name="navigateBefore" size="18px" />
            </button>
            <button
              class="p-1.5 rounded-full text-md3-on-surface-variant hover:bg-md3-surface-container-high disabled:opacity-40"
              title={$t('common.next')}
              onclick={() => loadAuditLogPage(auditOffset + auditCount)}
              disabled={auditOffset + auditCount >= auditTotal || loadingLogs}
            >
              <Icon name="navigateNext" size="18px" />
            </button>
          </div>
        </div>

        {#if !canViewLogs}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            {$t('manage.missingPermission', { values: { permission: 'view_audit_logs' } })}
          </p>
        {:else if loadingLogs}
          {@render LoadingRow()}
        {:else if auditEntries.length === 0}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            {$t('manage.noAuditLogs')}
          </p>
        {:else}
          <div class="overflow-x-auto">
            <table class="min-w-[920px] w-full text-left text-sm">
              <thead class="bg-md3-surface-container-high/50 text-xs uppercase text-md3-on-surface-variant">
                <tr>
                  <th class="px-3 py-2">{$t('manage.id')}</th>
                  <th class="px-3 py-2">{$t('manage.action')}</th>
                  <th class="px-3 py-2">{$t('manage.username')}</th>
                  <th class="px-3 py-2">{$t('manage.target')}</th>
                  <th class="px-3 py-2">{$t('manage.result')}</th>
                  <th class="px-3 py-2">{$t('manage.remote')}</th>
                  <th class="px-3 py-2 text-right">{$t('manage.time')}</th>
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

{#if activeDialog?.kind === 'user-groups'}
  <ManageListEditorDialog
    title={$t('manage.editUserGroupsTitle', { values: { username: activeDialog.user.username } })}
    description={$t('manage.editUserGroupsDescription')}
    icon="formatListBulleted"
    items={(activeDialog.user.groups ?? []).map((group) => ({ id: group, label: group }))}
    selected={activeDialog.user.groups ?? []}
    emptyMessage={$t('manage.noGroups')}
    onRefresh={refreshActiveUserGroups}
    onSave={saveActiveUserGroups}
    onClose={() => (activeDialog = null)}
  />
{:else if activeDialog?.kind === 'reset-password'}
  <ResetUserPasswordDialog
    username={activeDialog.user.username}
    onSave={saveActiveResetPassword}
    onClose={() => (activeDialog = null)}
  />
{:else if activeDialog?.kind === 'block-user'}
  <BlockUserDialog
    username={activeDialog.user.username}
    onSave={saveActiveBlockUser}
    onClose={() => (activeDialog = null)}
  />
{:else if activeDialog?.kind === 'group-permissions'}
  <ManageListEditorDialog
    title={$t('manage.editGroupPermissionsTitle', { values: { group: activeDialog.group.name } })}
    description={$t('manage.editGroupPermissionsDescription')}
    icon="adminPanelSettings"
    items={(activeDialog.group.permissions ?? []).map((permission) => ({ id: permission, label: permission }))}
    selected={activeDialog.group.permissions ?? []}
    allowAdd={true}
    addPlaceholder={$t('manage.addPermissionPlaceholder')}
    emptyMessage={$t('manage.noPermissions')}
    onRefresh={refreshActiveGroupPermissions}
    onSave={saveActiveGroupPermissions}
    onClose={() => (activeDialog = null)}
  />
{/if}

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
        <button
          class="p-1 rounded-full hover:bg-md3-surface-container-high"
          aria-label={$t('common.close')}
          onclick={() => (detailTitle = null)}
        >
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
        <h3 class="text-base font-semibold text-md3-on-surface">
          {$t('manage.blocksFor', { values: { username: blocksDialog.username } })}
        </h3>
        <button
          class="p-1 rounded-full hover:bg-md3-surface-container-high"
          aria-label={$t('common.close')}
          onclick={() => (blocksDialog = null)}
        >
          <Icon name="close" size="20px" />
        </button>
      </div>
      <div class="p-5 space-y-3 max-h-[70vh] overflow-auto">
        {#if blocksDialog.blocks.length === 0}
          <p class="text-sm text-md3-on-surface-variant">{$t('manage.noActiveBlocks')}</p>
        {:else}
          {#each blocksDialog.blocks as block (block.block_id)}
            <div class="border border-md3-outline rounded-xl p-3 space-y-2">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-md3-on-surface truncate">
                    {$t('manage.blockRecordTitle', {
                      values: {
                        types: formatList(block.block_types),
                        target: formatBlockTarget(block),
                      },
                    })}
                  </p>
                  <p class="text-xs text-md3-on-surface-variant break-all">
                    {$t('manage.idWithValue', { values: { id: block.block_id } })}
                  </p>
                </div>
                <button
                  class="px-3 py-1 text-xs rounded-full bg-md3-error-container
                         text-md3-on-error-container hover:brightness-110 disabled:opacity-50"
                  onclick={() => handleUnblock(block.block_id)}
                  disabled={busyKey !== null}
                >
                  {$t('files.revoke')}
                </button>
              </div>
              <p class="text-xs text-md3-on-surface-variant">
                {$t('manage.blockRecordPeriod', {
                  values: {
                    created: formatDate(block.timestamp),
                    start: formatDate(block.not_before),
                    end: block.not_after === -1 ? $t('manage.permanent') : formatDate(block.not_after),
                  },
                })}
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
    <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
    {$t('common.loadingEllipsis')}
  </div>
{/snippet}

{#snippet ActionButton(icon: IconName, title: string, onClick: () => void | Promise<void>, disabled = false, danger = false)}
  <button
    class="p-1.5 rounded-full transition-colors disabled:opacity-40
           {danger
             ? 'text-md3-error hover:bg-md3-error-container/40'
             : 'text-md3-on-surface-variant hover:bg-md3-primary-container/40 hover:text-md3-primary-emphasis'}"
    {title}
    onclick={onClick}
    {disabled}
  >
    <Icon name={icon} size="18px" />
  </button>
{/snippet}
