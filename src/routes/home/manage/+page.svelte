<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    blockUser,
    changeGroupPermissions,
    changeUserGroups,
    changeUserPermissions,
    createGroup,
    createUser,
    deleteGroup,
    deleteUser,
    disableManagedTwoFactor,
    getGroupInfo,
    getManagedTwoFactorStatus,
    getUserInfo,
    listGroups,
    listUserBlocks,
    listUsers,
    manageUserStatus,
    renameGroup,
    renameUser,
    resetUserPassword,
    serverErrorMessage,
    unblockUser,
    viewAuditLogs,
    type AuditLogEntry,
    type ManagedGroup,
    type ManagedUser,
    type ManagedUserInfo,
    type ManagedUserStatus,
    type TwoFactorStatus,
    type UserBlock,
    type UserBlockTarget,
  } from '$lib/api';
  import { dialogStore } from '$lib/dialogs.svelte';
  import { authStore, notificationStore } from '$lib/stores.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import CreateUserAccountDialog from '$lib/components/CreateUserAccountDialog.svelte';
  import CreateUserGroupDialog from '$lib/components/CreateUserGroupDialog.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import BlockUserDialog from '$lib/components/BlockUserDialog.svelte';
  import ManageListEditorDialog from '$lib/components/ManageListEditorDialog.svelte';
  import ResetUserPasswordDialog from '$lib/components/ResetUserPasswordDialog.svelte';
  import SecurityManagement from '$lib/components/SecurityManagement.svelte';
  import type { ContextMenuItem } from '$lib/components/context-menu';
  import type { IconName } from '$lib/icons';
  import { focusRovingItem, keyboardMenuAnchor, registerKeyboardCommands } from '$lib/keyboard';

  type ManageTabKey = 'accounts' | 'groups' | 'security' | 'logs';

  interface ManageTab {
    key: ManageTabKey;
    labelKey: string;
    icon: IconName;
  }

  type ManageContextTarget =
    | { kind: 'user'; user: ManagedUser }
    | { kind: 'group'; group: ManagedGroup };

  type ManageDialogState =
    | { kind: 'create-user' }
    | { kind: 'create-group' }
    | { kind: 'user-groups'; user: ManagedUser }
    | { kind: 'user-permissions'; user: ManagedUser }
    | { kind: 'reset-password'; user: ManagedUser }
    | {
        kind: 'account-management';
        user: ManagedUser;
        info: ManagedUserInfo | null;
        twoFactor: TwoFactorStatus | null;
      }
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

  const IDENTITY_COLUMN_MIN_WIDTH = 128;
  const IDENTITY_COLUMN_MAX_WIDTH = 240;
  const METADATA_MIN_READABLE_WIDTH = 240;

  const tabs: ManageTab[] = [
    { key: 'accounts', labelKey: 'manage.accounts', icon: 'supervisorAccount' },
    { key: 'groups', labelKey: 'manage.groups', icon: 'groups' },
    { key: 'security', labelKey: 'manage.security.title', icon: 'security' },
    { key: 'logs', labelKey: 'manage.logs', icon: 'article' },
  ];

  let activeTab = $state<ManageTabKey>('accounts');
  let users = $state<ManagedUser[]>([]);
  let groups = $state<ManagedGroup[]>([]);
  let auditEntries = $state<AuditLogEntry[]>([]);
  let auditNextCursor = $state<string | null>(null);
  let auditCursorStack = $state<Array<string | null>>([]);
  let auditPageIndex = $state(0);
  const auditPageSize = 128;

  let loadingUsers = $state(false);
  let loadingGroups = $state(false);
  let loadingLogs = $state(false);
  let securityRefreshKey = $state(0);
  let busyKey = $state<string | null>(null);
  let error = $state<string | null>(null);
  let status = $state<string | null>(null);
  let detailTitle = $state<string | null>(null);
  let detailRows = $state<Array<{ label: string; value: string }>>([]);
  let blocksDialog = $state<{ username: string; blocks: UserBlock[] } | null>(null);
  let activeDialog = $state<ManageDialogState>(null);
  let accountDisableReason = $state('');
  let expandedActionRow = $state<string | null>(null);
  let identityMeasureHost = $state<HTMLDivElement | null>(null);
  let accountListElement = $state<HTMLDivElement | null>(null);
  let groupListElement = $state<HTMLDivElement | null>(null);
  let accountIdentityColumnWidth = $state(IDENTITY_COLUMN_MIN_WIDTH);
  let groupIdentityColumnWidth = $state(IDENTITY_COLUMN_MIN_WIDTH);
  let hideAccountMetadata = $state(false);
  let hideGroupMetadata = $state(false);
  let expandedAuditIds = $state<Set<string>>(new Set());
  let auditIdLongPressTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressAuditIdClick: string | null = null;
  let contextMenu = $state<{
    open: boolean;
    x: number;
    y: number;
    target: ManageContextTarget | null;
    sourceElement: HTMLElement | null;
  }>({ open: false, x: 0, y: 0, target: null, sourceElement: null });

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
        'manage_2fa',
        'list_banned_subnets',
        'manage_banned_subnets',
        'list_auth_lockouts',
        'unlock_auth_lockouts',
      ].includes(p),
    ),
  );
  const canListUsers = $derived(hasAnyPermission('list_users', 'manage_system'));
  const canListGroups = $derived(hasAnyPermission('list_groups', 'manage_system'));
  const canViewLogs = $derived(hasAnyPermission('view_audit_logs', 'manage_system'));
  const canBlock = $derived(hasAnyPermission('block', 'manage_system'));
  const canListBlocks = $derived(hasAnyPermission('list_user_blocks', 'manage_system'));
  const canSetUserPermissions = $derived(hasAnyPermission('set_user_permissions'));
  const canManageUserStatus = $derived(hasAnyPermission('manage_user_status', 'manage_system'));
  const canManage2fa = $derived(hasAnyPermission('manage_2fa'));
  const canListBannedSubnets = $derived(hasAnyPermission('list_banned_subnets'));
  const canManageBannedSubnets = $derived(hasAnyPermission('manage_banned_subnets'));
  const canListAuthLockouts = $derived(hasAnyPermission('list_auth_lockouts'));
  const canUnlockAuthLockouts = $derived(hasAnyPermission('unlock_auth_lockouts'));
  const auditDisplayRange = $derived.by(() => {
    if (auditEntries.length === 0) return null;
    const start = auditPageIndex * auditPageSize + 1;
    return {
      start,
      end: start + auditEntries.length - 1,
    };
  });
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

  $effect(() => {
    users;
    groups;
    void updateIdentityColumnWidths();
  });

  $effect(() => {
    accountListElement;
    groupListElement;
    accountIdentityColumnWidth;
    groupIdentityColumnWidth;
    void updateMetadataVisibility();
  });

  $effect(() => {
    const elements = [accountListElement, groupListElement].filter(
      (element): element is HTMLDivElement => element !== null,
    );
    if (elements.length === 0 || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      void updateMetadataVisibility();
    });
    for (const element of elements) observer.observe(element);

    return () => observer.disconnect();
  });

  onMount(() => {
    if (isAdmin) loadActiveTab();
    void document.fonts?.ready.then(() => updateIdentityColumnWidths());
  });

  onMount(() => registerKeyboardCommands({
    id: 'manage.refresh',
    label: () => $t('common.refresh'),
    group: () => $t('manage.title'),
    shortcuts: [{ key: 'F5' }, { key: 'r', primary: true }],
    scope: 'page',
    enabled: () => isAdmin && busyKey === null,
    handler: loadActiveTab,
  }));

  function hasAnyPermission(...permissions: string[]) {
    return permissions.some((permission) => authStore.permissions.includes(permission));
  }

  async function updateIdentityColumnWidths() {
    await tick();
    accountIdentityColumnWidth = measureIdentityColumn(
      users.map((user) => ({
        primary: user.nickname || user.username,
        secondary: user.username,
      })),
    );
    groupIdentityColumnWidth = measureIdentityColumn(
      groups.map((group) => ({
        primary: group.display_name || group.name,
        secondary: group.name,
      })),
    );
  }

  async function updateMetadataVisibility() {
    await tick();
    hideAccountMetadata = shouldHideMetadata(accountListElement, accountIdentityColumnWidth);
    hideGroupMetadata = shouldHideMetadata(groupListElement, groupIdentityColumnWidth);
  }

  function shouldHideMetadata(listElement: HTMLDivElement | null, identityColumnWidth: number) {
    const row = listElement?.querySelector<HTMLElement>('.manage-list-row');
    if (!listElement || !row) return false;

    const rowStyle = getComputedStyle(row);
    const columnGap = parseFloat(rowStyle.columnGap) || 0;
    const paddingLeft = parseFloat(rowStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(rowStyle.paddingRight) || 0;
    const iconWidth =
      row.querySelector<HTMLElement>('.manage-list-icon')?.getBoundingClientRect().width ?? 0;
    const actionsWidth =
      row.querySelector<HTMLElement>('.manage-list-actions')?.scrollWidth
      || row.querySelector<HTMLElement>('.manage-action-toggle')?.scrollWidth
      || 0;
    const metadataWidth =
      listElement.getBoundingClientRect().width
      - paddingLeft
      - paddingRight
      - iconWidth
      - identityColumnWidth
      - actionsWidth
      - columnGap * 3;

    return metadataWidth < METADATA_MIN_READABLE_WIDTH;
  }

  function measureIdentityColumn(rows: Array<{ primary: string; secondary: string }>) {
    if (!identityMeasureHost || rows.length === 0) return IDENTITY_COLUMN_MIN_WIDTH;

    const primaryProbe = document.createElement('span');
    const secondaryProbe = document.createElement('span');
    primaryProbe.className = 'text-sm font-medium leading-snug';
    secondaryProbe.className = 'text-xs leading-relaxed';
    identityMeasureHost.append(primaryProbe, secondaryProbe);

    let width = IDENTITY_COLUMN_MIN_WIDTH;
    for (const row of rows) {
      primaryProbe.textContent = row.primary || '';
      secondaryProbe.textContent = row.secondary || '';
      width = Math.max(
        width,
        primaryProbe.getBoundingClientRect().width,
        secondaryProbe.getBoundingClientRect().width,
      );
    }

    primaryProbe.remove();
    secondaryProbe.remove();
    return Math.min(Math.ceil(width), IDENTITY_COLUMN_MAX_WIDTH);
  }

  function setActiveTab(tab: ManageTabKey) {
    activeTab = tab;
    loadActiveTab();
  }

  function handleManageTabKeydown(event: KeyboardEvent) {
    const next = focusRovingItem(event, event.currentTarget as HTMLElement, {
      selector: '[data-tab-item]',
      orientation: 'horizontal',
    });
    next?.click();
  }

  function loadActiveTab() {
    hideContextMenu();
    expandedActionRow = null;
    expandedAuditIds = new Set();
    if (activeTab === 'accounts') loadUserList();
    else if (activeTab === 'groups') loadGroupList();
    else if (activeTab === 'security') securityRefreshKey += 1;
    else loadAuditLogPage(null, 'reset');
  }

  function toggleActionRow(key: string) {
    expandedActionRow = expandedActionRow === key ? null : key;
  }

  function hideContextMenu() {
    contextMenu = { open: false, x: 0, y: 0, target: null, sourceElement: null };
  }

  function showUserContextMenu(event: MouseEvent | KeyboardEvent, user: ManagedUser) {
    event.preventDefault();
    contextMenu = {
      open: true,
      ...keyboardMenuAnchor(event),
      target: { kind: 'user', user },
    };
  }

  function showGroupContextMenu(event: MouseEvent | KeyboardEvent, group: ManagedGroup) {
    event.preventDefault();
    contextMenu = {
      open: true,
      ...keyboardMenuAnchor(event),
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
        id: 'edit-user-permissions',
        label: $t('manage.editPermissions'),
        icon: 'adminPanelSettings',
        onSelect: () => handleEditUserPermissions(user),
        disabled,
        hidden: !canSetUserPermissions,
      },
      {
        id: 'reset-user-password',
        label: $t('manage.resetPassword'),
        icon: 'password',
        onSelect: () => handleResetPassword(user),
        disabled,
      },
      {
        id: 'manage-account',
        label: $t('manage.accountManagement'),
        icon: 'manageAccounts',
        onSelect: () => handleManageAccount(user),
        disabled,
        hidden: !canManageUserStatus && !canManage2fa,
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

  async function loadAuditLogPage(cursor: string | null, direction: 'reset' | 'next' | 'previous' = 'reset') {
    if (!canViewLogs) return;
    loadingLogs = true;
    error = null;
    try {
      const data = await viewAuditLogs(cursor, auditPageSize);
      auditEntries = data.entries;
      auditNextCursor = data.next_cursor;
      if (direction === 'reset') {
        auditCursorStack = [cursor];
        auditPageIndex = 0;
      } else if (direction === 'next') {
        auditCursorStack = [...auditCursorStack.slice(0, auditPageIndex + 1), cursor];
        auditPageIndex += 1;
      } else {
        auditPageIndex = Math.max(0, auditPageIndex - 1);
      }
      expandedAuditIds = new Set();
    } catch (err) {
      error = formatError(err);
      auditEntries = [];
      auditNextCursor = null;
      expandedAuditIds = new Set();
    } finally {
      loadingLogs = false;
    }
  }

  async function handleCreateUser() {
    activeDialog = { kind: 'create-user' };
  }

  async function saveCreatedUser(username: string, password: string, nickname: string) {
    await runBusy('create-user', async () => {
      await createUser(username, password, nickname);
      status = $t('manage.userCreated', { values: { username } });
      activeDialog = null;
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

  async function handleEditUserPermissions(user: ManagedUser) {
    activeDialog = { kind: 'user-permissions', user };
  }

  async function handleResetPassword(user: ManagedUser) {
    activeDialog = { kind: 'reset-password', user };
  }

  async function handleManageAccount(user: ManagedUser) {
    await runBusy(`account-management:${user.username}`, async () => {
      const [info, twoFactor] = await Promise.all([
        canManageUserStatus ? getUserInfo(user.username) : Promise.resolve(null),
        canManage2fa ? getManagedTwoFactorStatus(user.username) : Promise.resolve(null),
      ]);
      accountDisableReason = '';
      activeDialog = { kind: 'account-management', user, info, twoFactor };
    });
  }

  async function disableActiveUserTwoFactor() {
    if (activeDialog?.kind !== 'account-management' || !activeDialog.twoFactor?.enabled) return;
    const user = activeDialog.user;
    const confirmed = await dialogStore.confirm({
      title: $t('manage.disableUserTwoFactorTitle'),
      message: $t('manage.disableUserTwoFactorConfirm', { values: { username: user.username } }),
      confirmLabel: $t('manage.disableUserTwoFactor'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    });
    if (!confirmed) return;

    await runBusy(`twofa:${user.username}`, async () => {
      await disableManagedTwoFactor(user.username);
      if (activeDialog?.kind === 'account-management' && activeDialog.user.username === user.username) {
        activeDialog = {
          ...activeDialog,
          twoFactor: { enabled: false, method: null, backup_codes_count: 0 },
        };
      }
      status = $t('manage.userTwoFactorDisabled', { values: { username: user.username } });
    });
  }

  async function handleViewUser(user: ManagedUser) {
    await runBusy(`view-user:${user.username}`, async () => {
      const info = await getUserInfo(user.username);
      detailTitle = $t('manage.userDetailsFor', { values: { username: info.username } });
      detailRows = [
        { label: $t('manage.username'), value: info.username },
        { label: $t('manage.nickname'), value: info.nickname || '-' },
        {
          label: $t('manage.accountStatus'),
          value: info.status === 'active' ? $t('manage.statusActive') : $t('manage.statusDisabled'),
        },
        { label: $t('manage.effectivePermissions'), value: formatList(info.permissions) },
        { label: $t('manage.ownPermissions'), value: formatList(info.own_permissions) },
        { label: $t('manage.inheritedPermissions'), value: formatList(info.inherited_permissions) },
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
    activeDialog = { kind: 'create-group' };
  }

  async function saveCreatedGroup(groupName: string, displayName: string) {
    await runBusy('create-group', async () => {
      await createGroup(groupName, displayName);
      status = $t('manage.groupCreated', { values: { group: groupName } });
      activeDialog = null;
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

  async function loadUserPermissionEditorData(user: ManagedUser): Promise<ListEditorData> {
    const [allUsers, allGroups, userInfo] = await Promise.all([
      listUsers(),
      listGroups().catch(() => [] as ManagedGroup[]),
      getUserInfo(user.username),
    ]);
    users = allUsers;
    if (allGroups.length > 0) groups = allGroups;

    const permissionSet = new Set<string>();
    const ownPermissions = userInfo.own_permissions ?? [];
    const inheritedPermissions = userInfo.inherited_permissions ?? [];

    for (const permission of userInfo.permissions ?? []) permissionSet.add(permission);
    for (const permission of ownPermissions) permissionSet.add(permission);
    for (const permission of inheritedPermissions) permissionSet.add(permission);
    for (const account of allUsers) {
      for (const permission of account.permissions ?? []) permissionSet.add(permission);
    }
    for (const group of allGroups) {
      for (const permission of group.permissions ?? []) permissionSet.add(permission);
    }

    return {
      items: [...permissionSet].sort().map((permission) => ({
        id: permission,
        label: permission,
        meta: inheritedPermissions.includes(permission) && !ownPermissions.includes(permission)
          ? $t('manage.inheritedPermission')
          : undefined,
      })),
      selected: ownPermissions,
    };
  }

  async function saveUserGroups(user: ManagedUser, selected: string[]) {
    await changeUserGroups(user.username, selected);
    status = $t('manage.userGroupsUpdated', { values: { username: user.username } });
    activeDialog = null;
    await loadUserList();
  }

  async function saveUserPermissions(user: ManagedUser, selected: string[]) {
    await changeUserPermissions(user.username, selected);
    status = $t('manage.userPermissionsUpdated', { values: { username: user.username } });
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

  async function refreshActiveUserPermissions() {
    if (activeDialog?.kind !== 'user-permissions') return { items: [], selected: [] };
    return loadUserPermissionEditorData(activeDialog.user);
  }

  async function saveActiveUserPermissions(selected: string[]) {
    if (activeDialog?.kind !== 'user-permissions') return;
    await saveUserPermissions(activeDialog.user, selected);
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

  async function saveActiveUserStatus(statusValue: ManagedUserStatus) {
    if (activeDialog?.kind !== 'account-management' || !activeDialog.info) return;
    const user = activeDialog.user;
    await runBusy(`status-user:${user.username}`, async () => {
      const reason = statusValue === 'disabled'
        ? accountDisableReason.trim() || undefined
        : undefined;
      await manageUserStatus(user.username, statusValue, reason);
      status = $t('manage.userStatusUpdated', {
        values: { username: user.username },
      });
      if (activeDialog?.kind === 'account-management' && activeDialog.user.username === user.username) {
        activeDialog = {
          ...activeDialog,
          info: activeDialog.info ? { ...activeDialog.info, status: statusValue } : null,
        };
        accountDisableReason = '';
      }
      await loadUserList();
    });
  }

  function toggleActiveUserStatus() {
    if (activeDialog?.kind !== 'account-management' || !activeDialog.info) return;
    void saveActiveUserStatus(activeDialog.info.status === 'disabled' ? 'active' : 'disabled');
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

  function isAuditIdExpanded(id: string) {
    return expandedAuditIds.has(id);
  }

  function displayAuditId(id: string) {
    return isAuditIdExpanded(id) || id.length <= 7 ? id : id.slice(0, 7);
  }

  function toggleAuditId(id: string) {
    const next = new Set(expandedAuditIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedAuditIds = next;
  }

  async function copyAuditId(id: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(id);
      } else {
        copyTextWithFallback(id);
      }
      notificationStore.success($t('manage.auditIdCopied'), 1600);
    } catch (err) {
      notificationStore.error($t('manage.auditIdCopyFailed'));
    }
  }

  function copyTextWithFallback(text: string) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  function handleAuditIdClick(event: MouseEvent, id: string) {
    if (suppressAuditIdClick === id) {
      event.preventDefault();
      suppressAuditIdClick = null;
      return;
    }

    toggleAuditId(id);
  }

  function handleAuditIdContextMenu(event: MouseEvent, id: string) {
    event.preventDefault();
    event.stopPropagation();
    clearAuditIdLongPress();
    void copyAuditId(id);
  }

  function startAuditIdLongPress(id: string) {
    clearAuditIdLongPress();
    auditIdLongPressTimer = setTimeout(() => {
      suppressAuditIdClick = id;
      auditIdLongPressTimer = null;
      void copyAuditId(id);
    }, 550);
  }

  function clearAuditIdLongPress() {
    if (!auditIdLongPressTimer) return;
    clearTimeout(auditIdLongPressTimer);
    auditIdLongPressTimer = null;
  }

  function formatBlockTarget(block: UserBlock) {
    const targetType = block.target_type ?? 'all';
    if (targetType === 'all') return $t('tasks.all');
    if (block.target_id) return `${targetType}: ${block.target_id}`;
    return targetType;
  }

  function formatError(err: unknown) {
    return serverErrorMessage(err);
  }
</script>

<div class="workspace-page space-y-4 p-[clamp(1rem,3.75vw,1.5rem)]">
  <div bind:this={identityMeasureHost} class="identity-measure-host" aria-hidden="true"></div>

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
    <div class="flex gap-1 bg-md3-surface-container-high/50 rounded-xl p-1 w-fit" role="tablist" tabindex="-1" aria-label={$t('manage.title')} onkeydown={handleManageTabKeydown}>
      {#each tabs as tab}
        <button
          data-tab-item
          role="tab"
          aria-selected={activeTab === tab.key}
          tabindex={activeTab === tab.key ? 0 : -1}
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

    <div
      class="management-content"
      class:management-content--contained={activeTab !== 'security'}
    >
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
          <div
            class="manage-list manage-list--accounts"
            class:manage-list--metadata-hidden={hideAccountMetadata}
            bind:this={accountListElement}
            style={`--manage-identity-width: ${accountIdentityColumnWidth}px;`}
            role="list"
          >
            {#each users as user (user.username)}
              {@const actionKey = `user:${user.username}`}
              <div
                class="manage-list-row"
                role="listitem"
                oncontextmenu={(event) => showUserContextMenu(event, user)}
              >
                <span class="manage-list-icon text-md3-primary-emphasis">
                  <Icon name="accountCircle" size="24px" />
                </span>
                <div class="manage-identity min-w-0">
                  <p class="truncate text-sm font-medium leading-snug text-md3-on-surface">
                    {user.nickname || user.username}
                  </p>
                  {@render PrimaryMetadataValue(user.username)}
                </div>
                <div class="metadata-stack">
                  {@render MetadataLine($t('manage.lastLogin'), formatDate(user.last_login))}
                  {@render MetadataLine($t('manage.groups'), formatList(user.groups))}
                </div>
                <button
                  class="manage-action-toggle rounded-full p-1.5 text-md3-on-surface-variant transition-colors hover:bg-md3-primary-container/40 hover:text-md3-primary-emphasis"
                  title={$t('tasks.moreActions')}
                  aria-label={$t('tasks.moreActions')}
                  onclick={() => toggleActionRow(actionKey)}
                  onkeydown={(event) => {
                    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                      event.preventDefault();
                      showUserContextMenu(event, user);
                    }
                  }}
                >
                  <Icon name={expandedActionRow === actionKey ? 'expandLess' : 'moreVert'} size="20px" />
                </button>
                <div class="manage-list-actions">
                  {@render ActionButton('info', $t('manage.properties'), () => handleViewUser(user), busyKey !== null)}
                  {@render ActionButton('edit', $t('manage.changeNickname'), () => handleRenameUser(user), busyKey !== null)}
                  {@render ActionButton('formatListBulleted', $t('manage.editGroups'), () => handleEditUserGroups(user), busyKey !== null)}
                  {@render ActionButton('adminPanelSettings', $t('manage.editPermissions'), () => handleEditUserPermissions(user), !canSetUserPermissions || busyKey !== null)}
                  {@render ActionButton('password', $t('manage.resetPassword'), () => handleResetPassword(user), busyKey !== null)}
                  {@render ActionButton('manageAccounts', $t('manage.accountManagement'), () => handleManageAccount(user), (!canManageUserStatus && !canManage2fa) || busyKey !== null)}
                  {@render ActionButton('block', $t('manage.blockUser'), () => handleBlockUser(user), !canBlock || busyKey !== null)}
                  {@render ActionButton('manageAccounts', $t('manage.viewBlocks'), () => handleListBlocks(user), !canListBlocks || busyKey !== null)}
                  {@render ActionButton('delete', $t('common.delete'), () => handleDeleteUser(user), busyKey !== null, true)}
                </div>
                {#if expandedActionRow === actionKey}
                  <div class="manage-list-expanded rounded-lg border border-md3-outline/50 bg-md3-surface-container-high/40 px-2 py-2 animate-fade-scale-in">
                    <div class="flex flex-wrap justify-end gap-1">
                      {@render ActionButton('info', $t('manage.properties'), () => handleViewUser(user), busyKey !== null)}
                      {@render ActionButton('edit', $t('manage.changeNickname'), () => handleRenameUser(user), busyKey !== null)}
                      {@render ActionButton('formatListBulleted', $t('manage.editGroups'), () => handleEditUserGroups(user), busyKey !== null)}
                      {@render ActionButton('adminPanelSettings', $t('manage.editPermissions'), () => handleEditUserPermissions(user), !canSetUserPermissions || busyKey !== null)}
                      {@render ActionButton('password', $t('manage.resetPassword'), () => handleResetPassword(user), busyKey !== null)}
                      {@render ActionButton('manageAccounts', $t('manage.accountManagement'), () => handleManageAccount(user), (!canManageUserStatus && !canManage2fa) || busyKey !== null)}
                      {@render ActionButton('block', $t('manage.blockUser'), () => handleBlockUser(user), !canBlock || busyKey !== null)}
                      {@render ActionButton('manageAccounts', $t('manage.viewBlocks'), () => handleListBlocks(user), !canListBlocks || busyKey !== null)}
                      {@render ActionButton('delete', $t('common.delete'), () => handleDeleteUser(user), busyKey !== null, true)}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
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
          <div
            class="manage-list manage-list--groups"
            class:manage-list--metadata-hidden={hideGroupMetadata}
            bind:this={groupListElement}
            style={`--manage-identity-width: ${groupIdentityColumnWidth}px;`}
            role="list"
          >
            {#each groups as group (group.name)}
              {@const actionKey = `group:${group.name}`}
              <div
                class="manage-list-row"
                role="listitem"
                oncontextmenu={(event) => showGroupContextMenu(event, group)}
              >
                <span class="manage-list-icon text-md3-primary-emphasis">
                  <Icon name="groups" size="24px" />
                </span>
                <div class="manage-identity min-w-0">
                  <p class="truncate text-sm font-medium leading-snug text-md3-on-surface">
                    {group.display_name || group.name}
                  </p>
                  {@render PrimaryMetadataValue(group.name)}
                </div>
                <div class="metadata-stack">
                  {@render MetadataLine($t('manage.permissions'), formatList(group.permissions))}
                  {@render MetadataLine($t('manage.members'), formatList(group.members))}
                </div>
                <button
                  class="manage-action-toggle rounded-full p-1.5 text-md3-on-surface-variant transition-colors hover:bg-md3-primary-container/40 hover:text-md3-primary-emphasis"
                  title={$t('tasks.moreActions')}
                  aria-label={$t('tasks.moreActions')}
                  onclick={() => toggleActionRow(actionKey)}
                  onkeydown={(event) => {
                    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                      event.preventDefault();
                      showGroupContextMenu(event, group);
                    }
                  }}
                >
                  <Icon name={expandedActionRow === actionKey ? 'expandLess' : 'moreVert'} size="20px" />
                </button>
                <div class="manage-list-actions">
                  {@render ActionButton('edit', $t('manage.rename'), () => handleRenameGroup(group), busyKey !== null)}
                  {@render ActionButton('settings', $t('manage.setPermissions'), () => handleEditGroupPermissions(group), busyKey !== null)}
                  {@render ActionButton('groupRemove', $t('common.delete'), () => handleDeleteGroup(group), busyKey !== null, true)}
                </div>
                {#if expandedActionRow === actionKey}
                  <div class="manage-list-expanded rounded-lg border border-md3-outline/50 bg-md3-surface-container-high/40 px-2 py-2 animate-fade-scale-in">
                    <div class="flex flex-wrap justify-end gap-1">
                      {@render ActionButton('edit', $t('manage.rename'), () => handleRenameGroup(group), busyKey !== null)}
                      {@render ActionButton('settings', $t('manage.setPermissions'), () => handleEditGroupPermissions(group), busyKey !== null)}
                      {@render ActionButton('groupRemove', $t('common.delete'), () => handleDeleteGroup(group), busyKey !== null, true)}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {:else if activeTab === 'security'}
        <SecurityManagement
          canListSubnets={canListBannedSubnets}
          canManageSubnets={canManageBannedSubnets}
          canListLockouts={canListAuthLockouts}
          canUnlockLockouts={canUnlockAuthLockouts}
          refreshKey={securityRefreshKey}
        />
      {:else}
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-md3-outline">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('manage.auditLogs')}
          </h2>
          <div class="flex items-center gap-2">
            <span class="text-xs text-md3-on-surface-variant">
              {auditDisplayRange === null
                ? $t('manage.auditRangeEmpty')
                : $t('manage.auditPageRange', {
                    values: {
                      start: auditDisplayRange.start,
                      end: auditDisplayRange.end,
                    },
                  })}
            </span>
            <button
              class="p-1.5 rounded-full text-md3-on-surface-variant hover:bg-md3-surface-container-high disabled:opacity-40"
              title={$t('common.previous')}
              onclick={() => loadAuditLogPage(auditCursorStack[Math.max(0, auditPageIndex - 1)] ?? null, 'previous')}
              disabled={auditPageIndex <= 0 || loadingLogs}
            >
              <Icon name="navigateBefore" size="18px" />
            </button>
            <button
              class="p-1.5 rounded-full text-md3-on-surface-variant hover:bg-md3-surface-container-high disabled:opacity-40"
              title={$t('common.next')}
              onclick={() => loadAuditLogPage(auditNextCursor, 'next')}
              disabled={!auditNextCursor || loadingLogs}
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
                    <td class="px-3 py-2 align-top text-md3-on-surface-variant">
                      <button
                        class="max-w-36 rounded-md px-1 py-0.5 text-left leading-relaxed transition-colors
                               hover:bg-md3-primary-container/30 hover:text-md3-primary-emphasis
                               sm:max-w-64 {isAuditIdExpanded(entry.id) ? 'break-all text-md3-on-surface' : 'truncate'}"
                        title={entry.id}
                        aria-label={isAuditIdExpanded(entry.id)
                          ? $t('manage.collapseAuditId')
                          : $t('manage.expandAuditId')}
                        aria-expanded={isAuditIdExpanded(entry.id)}
                        onclick={(event) => handleAuditIdClick(event, entry.id)}
                        oncontextmenu={(event) => handleAuditIdContextMenu(event, entry.id)}
                        onpointerdown={(event) => {
                          if (event.pointerType === 'mouse' && event.button !== 0) return;
                          startAuditIdLongPress(entry.id);
                        }}
                        onpointerup={clearAuditIdLongPress}
                        onpointercancel={clearAuditIdLongPress}
                        onpointerleave={clearAuditIdLongPress}
                      >
                        {displayAuditId(entry.id)}
                      </button>
                    </td>
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
  sourceElement={contextMenu.sourceElement}
  onClose={hideContextMenu}
/>

{#if activeDialog?.kind === 'create-user'}
  <CreateUserAccountDialog
    onSave={saveCreatedUser}
    onClose={() => (activeDialog = null)}
  />
{:else if activeDialog?.kind === 'create-group'}
  <CreateUserGroupDialog
    onSave={saveCreatedGroup}
    onClose={() => (activeDialog = null)}
  />
{:else if activeDialog?.kind === 'user-groups'}
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
{:else if activeDialog?.kind === 'user-permissions'}
  <ManageListEditorDialog
    title={$t('manage.editUserPermissionsTitle', { values: { username: activeDialog.user.username } })}
    description={$t('manage.editUserPermissionsDescription')}
    icon="adminPanelSettings"
    items={(activeDialog.user.permissions ?? []).map((permission) => ({ id: permission, label: permission }))}
    selected={activeDialog.user.own_permissions ?? []}
    allowAdd={true}
    addPlaceholder={$t('manage.addPermissionPlaceholder')}
    emptyMessage={$t('manage.noPermissions')}
    onRefresh={refreshActiveUserPermissions}
    onSave={saveActiveUserPermissions}
    onClose={() => (activeDialog = null)}
  />
{:else if activeDialog?.kind === 'reset-password'}
  <ResetUserPasswordDialog
    username={activeDialog.user.username}
    onSave={saveActiveResetPassword}
    onClose={() => (activeDialog = null)}
  />
{:else if activeDialog?.kind === 'account-management'}
  <ModalFrame
    title={$t('manage.accountManagementTitle', { values: { username: activeDialog.user.username } })}
    maxWidth="max-w-lg"
    closeLabel={$t('common.cancel')}
    onClose={() => (activeDialog = null)}
  >
    <div class="divide-y divide-md3-outline/60">
      {#if activeDialog.info}
        <section class="space-y-4 p-5" aria-labelledby="managed-account-status-title">
          <div>
            <h3 id="managed-account-status-title" class="text-sm font-semibold text-md3-on-surface">{$t('manage.accountStatus')}</h3>
            <p class="mt-1 text-xs leading-5 text-md3-on-surface-variant">{$t('manage.setAccountStatusDescription')}</p>
          </div>
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-md3-on-surface-variant">{$t('manage.currentAccountStatus')}</span>
            <span class={`rounded-full px-3 py-1 text-xs font-semibold ${activeDialog.info.status === 'active' ? 'bg-md3-primary-container text-md3-on-primary-container' : 'bg-md3-error-container text-md3-on-error-container'}`}>
              {activeDialog.info.status === 'active' ? $t('manage.statusActive') : $t('manage.statusDisabled')}
            </span>
          </div>
          {#if activeDialog.info.status === 'active'}
            <label class="grid gap-2 text-sm text-md3-on-surface">
              <span class="font-medium">{$t('manage.disableReasonLabel')}</span>
              <textarea bind:value={accountDisableReason} maxlength="1024" rows="3" placeholder={$t('manage.disableReasonPlaceholder')} class="w-full resize-y rounded-lg border border-md3-outline bg-md3-field px-3 py-2.5 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/25"></textarea>
              <span class="text-xs text-md3-on-surface-variant">{$t('manage.reasonOptional')}</span>
            </label>
          {/if}
          <button type="button" class="flex items-center gap-2 rounded-full bg-md3-surface-container-high px-4 py-2 text-sm font-medium text-md3-on-surface transition-colors hover:bg-md3-surface-container-highest disabled:opacity-50" disabled={busyKey !== null} onclick={toggleActiveUserStatus}>
            <Icon name={activeDialog.info.status === 'disabled' ? 'verifiedUser' : 'block'} size="18px" />
            {activeDialog.info.status === 'disabled' ? $t('manage.enableAccountAction') : $t('manage.disableAccountAction')}
          </button>
        </section>
      {/if}

      {#if activeDialog.twoFactor}
        <section class="space-y-4 p-5" aria-labelledby="managed-twofa-title">
          <div>
            <h3 id="managed-twofa-title" class="text-sm font-semibold text-md3-on-surface">{$t('manage.twoFactorManagement')}</h3>
            <p class="mt-1 text-xs leading-5 text-md3-on-surface-variant">{$t('manage.twoFactorManagementDescription')}</p>
          </div>
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-md3-on-surface-variant">{$t('manage.twoFactorStatus')}</span>
            <span class={`rounded-full px-3 py-1 text-xs font-semibold ${activeDialog.twoFactor.enabled ? 'bg-md3-primary-container text-md3-on-primary-container' : 'bg-md3-surface-container-high text-md3-on-surface-variant'}`}>
              {activeDialog.twoFactor.enabled ? $t('common.enabled') : $t('common.disabled')}
            </span>
          </div>
          {#if activeDialog.twoFactor.enabled}
            <dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
              <dt class="text-md3-on-surface-variant">{$t('manage.twoFactorMethod')}</dt>
              <dd class="uppercase text-md3-on-surface">{activeDialog.twoFactor.method ?? '-'}</dd>
              <dt class="text-md3-on-surface-variant">{$t('manage.backupCodesRemaining')}</dt>
              <dd class="text-md3-on-surface">{activeDialog.twoFactor.backup_codes_count}</dd>
            </dl>
            <button type="button" class="flex items-center gap-2 rounded-full bg-md3-error-container px-4 py-2 text-sm font-medium text-md3-on-error-container transition-all hover:brightness-110 disabled:opacity-50" disabled={busyKey !== null} onclick={disableActiveUserTwoFactor}>
              <Icon name="lockOpen" size="18px" />
              {$t('manage.disableUserTwoFactor')}
            </button>
          {:else}
            <p class="text-sm text-md3-on-surface-variant">{$t('manage.twoFactorNotEnabled', { values: { username: activeDialog.user.username } })}</p>
          {/if}
        </section>
      {/if}
    </div>
  </ModalFrame>
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
  <ModalFrame
    title={detailTitle}
    maxWidth="max-w-lg"
    closeLabel={$t('common.close')}
    onClose={() => (detailTitle = null)}
  >
    <div class="p-5 space-y-3">
      {#each detailRows as row}
        <div class="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[140px_1fr] sm:gap-3">
          <span class="min-w-0 text-md3-on-surface-variant">{row.label}</span>
          <span class="text-md3-on-surface break-words">{row.value || '-'}</span>
        </div>
      {/each}
    </div>
  </ModalFrame>
{/if}

{#if blocksDialog}
  <ModalFrame
    title={$t('manage.blocksFor', { values: { username: blocksDialog.username } })}
    maxWidth="max-w-2xl"
    closeLabel={$t('common.close')}
    onClose={() => (blocksDialog = null)}
  >
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
  </ModalFrame>
{/if}

{#snippet LoadingRow()}
  <div class="flex items-center gap-2 px-4 py-8 text-sm text-md3-on-surface-variant justify-center">
    <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
    {$t('common.loadingEllipsis')}
  </div>
{/snippet}

{#snippet PrimaryMetadataValue(value: string)}
  <p class="min-w-0 truncate text-xs leading-relaxed text-md3-on-surface-variant" title={value}>
    {value}
  </p>
{/snippet}

{#snippet MetadataLine(label: string, value: string)}
  <div class="grid min-w-0 grid-cols-[6.5rem_1fr] gap-2 text-xs leading-relaxed sm:grid-cols-[7.5rem_1fr]">
    <span class="text-md3-on-surface-variant/80">{label}</span>
    <span class="metadata-clamp min-w-0 text-md3-on-surface-variant" title={value}>{value}</span>
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

<style>
  .management-content--contained {
    overflow: hidden;
    border: 1px solid var(--color-md3-outline);
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--color-md3-surface-container) 70%, transparent);
    -webkit-backdrop-filter: blur(4px);
    backdrop-filter: blur(4px);
  }

  .identity-measure-host {
    position: absolute;
    width: max-content;
    height: 0;
    overflow: visible;
    visibility: hidden;
    pointer-events: none;
    white-space: nowrap;
  }

  .manage-list {
    container-type: inline-size;
  }

  .manage-list-row {
    display: grid;
    grid-template-columns:
      auto
      minmax(0, var(--manage-identity-width))
      minmax(0, 1fr)
      auto;
    align-items: center;
    column-gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 50%, transparent);
    transition: background-color 160ms ease;
  }

  .manage-list-row:last-child {
    border-bottom: 0;
  }

  .manage-list-row:hover {
    background: color-mix(in srgb, var(--color-md3-primary-container) 10%, transparent);
  }

  .manage-list-icon {
    display: inline-flex;
    grid-column: 1;
    width: 1.5rem;
    align-items: center;
    justify-content: center;
  }

  .manage-identity {
    grid-column: 2;
  }

  .metadata-stack {
    display: grid;
    grid-column: 3;
    min-width: 0;
    row-gap: 0.125rem;
  }

  .manage-list-actions {
    display: flex;
    grid-column: 4;
    min-width: max-content;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.25rem;
  }

  .manage-action-toggle {
    display: none;
    grid-column: 4;
  }

  .manage-list-expanded {
    display: none;
    grid-column: 1 / -1;
    margin-top: 0.25rem;
  }

  .metadata-clamp {
    display: -webkit-box;
    max-height: 2.75rem;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }

  .manage-list--metadata-hidden .manage-list-row {
    grid-template-columns:
      auto
      minmax(0, var(--manage-identity-width))
      minmax(0, 1fr)
      auto;
  }

  .manage-list--metadata-hidden .metadata-stack {
    display: none;
  }

  .manage-list--metadata-hidden .manage-list-actions,
  .manage-list--metadata-hidden .manage-action-toggle {
    grid-column: 4;
  }

  @container (max-width: 36rem) {
    .manage-list-row {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }

    .metadata-stack {
      display: none;
    }

    .manage-list-actions,
    .manage-action-toggle {
      grid-column: 3;
    }
  }

  @container (max-width: 35rem) {
    .manage-list--accounts .manage-list-actions {
      display: none;
    }

    .manage-list--accounts .manage-action-toggle {
      display: inline-flex;
    }

    .manage-list--accounts .manage-list-expanded {
      display: block;
    }
  }

  @container (max-width: 25rem) {
    .manage-list--groups .manage-list-actions {
      display: none;
    }

    .manage-list--groups .manage-action-toggle {
      display: inline-flex;
    }

    .manage-list--groups .manage-list-expanded {
      display: block;
    }
  }
</style>
