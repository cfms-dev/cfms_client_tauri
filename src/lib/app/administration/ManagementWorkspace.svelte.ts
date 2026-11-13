import { canAccessAdministration } from '$lib/features/administration/permissions';
import { _ as t } from 'svelte-i18n';
import { onDestroy, onMount, tick, untrack } from 'svelte';
import { ensureEscalation } from '$lib/features/authentication/escalation.svelte.ts';
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
  setUserNickname,
  resetUserPassword,
  unblockUser,
  updateUserBlock,
  viewAuditLogs,
  type AuditLogEntry,
  type ManagedGroup,
  type ManagedUser,
  type ManagedUserInfo,
  type ManagedUserStatus,
  type PermissionEntry,
  type TwoFactorStatus,
  type UserBlock,
  type UserBlockTarget,
} from '$lib/api';
import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';
import { copyText } from '$lib/shared/platform/clipboard';
import { canSetAccountName, canReadAuthentication, canConfigureAuthentication } from '$lib/features/authentication/auth-permissions';
import { canSetOtherUserAvatar } from '$lib/features/authentication/avatar-permissions';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
import { createAuditUserPreviewCache } from '$lib/features/authentication/audit-user-preview';
import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';
import type { ContextMenuItem } from '$lib/shared/ui/context-menu';
import type { IconName } from '$lib/shared/ui/icons';
import type { PermissionEntriesEditorData } from '$lib/features/access/permission-entries';
import { focusRovingItem, keyboardMenuAnchor, registerKeyboardCommands } from '$lib/shared/ui/keyboard';
import { fromStore } from 'svelte/store';

export type ManageTabKey = 'accounts' | 'groups' | 'security' | 'logs' | 'settings';

export interface ManageTab {
  key: ManageTabKey;
  labelKey: string;
  icon: IconName;
}

export type ManageContextTarget =
  | { kind: 'user'; user: ManagedUser }
  | { kind: 'group'; group: ManagedGroup };

export type ManageDialogState =
  | { kind: 'username'; user: ManagedUser }
  | { kind: 'create-user' }
  | { kind: 'create-group' }
  | { kind: 'user-groups'; user: ManagedUser }
  | { kind: 'user-permissions'; user: ManagedUser }
  | { kind: 'user-avatar'; user: ManagedUser }
  | { kind: 'user-authentication'; user: ManagedUser }
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

export interface ListEditorItem {
  id: string;
  label?: string;
  meta?: string;
}

export interface ListEditorData {
  items: ListEditorItem[];
  selected: string[];
}

/** Per-view workflow; reusable business rules live in features. */
export function createManagementWorkspace() {
  const translator = fromStore(t);

  const IDENTITY_COLUMN_MIN_WIDTH = 128;

  const IDENTITY_COLUMN_MAX_WIDTH = 240;

  const METADATA_MIN_READABLE_WIDTH = 240;

  const tabs: ManageTab[] = [
    { key: 'settings', labelKey: 'serverSettings.title', icon: 'appsSettings' },
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

  let auditFilters = $state<string[]>([]);

  let auditKnownActions = $state<string[]>([]);

  const auditPageSize = 128;

  const userPreviewCache = createAuditUserPreviewCache();

  let activeUserPreviewKey = $state<string | null>(null);

  let userPreviewRevision = $state(0);

  function resetUserPreviews() {
    userPreviewCache.clear();
    activeUserPreviewKey = null;
    userPreviewRevision += 1;
  }

  $effect(() => {
    authStore.userId;
    authStore.username;
    authStore.hasToken;
    authStore.permissionSnapshotRevision;
    authStore.permissions.join(',');
    serverStateStore.remoteAddress;
    serverStateStore.connected;
    activeTab;
    untrack(resetUserPreviews);
  });

  let loadingUsers = $state(false);

  let loadingGroups = $state(false);

  let loadingLogs = $state(false);

  let securityRefreshKey = $state(0);

  let busyKey = $state<string | null>(null);

  let error = $state<string | null>(null);

  let status = $state<string | null>(null);

  let detailTitle = $state<string | null>(null);

  let detailRows = $state<Array<{ label: string; value: string }>>([]);

  let blocksDialog = $state<{ userId: string; username: string; blocks: UserBlock[] } | null>(null);

  let activeDialog = $state<ManageDialogState>(null);

  let serverSettings = $state<{
    canLeave: () => Promise<boolean>;
    refresh: () => Promise<void>;
    readonly refreshState: { readonly disabled: boolean; readonly busy: boolean };
  }>();

  let authenticationManagement = $state<{ canLeave: () => Promise<boolean> }>();

  let accountDisableReason = $state('');

  let expandedActionRow = $state<string | null>(null);

  let identityMeasureHost = $state<HTMLDivElement | null>(null);

  let accountListElement = $state<HTMLDivElement | null>(null);

  let groupListElement = $state<HTMLDivElement | null>(null);

  let accountIdentityColumnWidth = $state(IDENTITY_COLUMN_MIN_WIDTH);

  let groupIdentityColumnWidth = $state(IDENTITY_COLUMN_MIN_WIDTH);

  let hideAccountMetadata = $state(false);

  let hideGroupMetadata = $state(false);

  let contextMenu = $state<{
    open: boolean;
    x: number;
    y: number;
    target: ManageContextTarget | null;
    sourceElement: HTMLElement | null;
  }>({ open: false, x: 0, y: 0, target: null, sourceElement: null });

  const isAdmin = $derived(canAccessAdministration(authStore.permissions));

  const canListUsers = $derived(hasAnyPermission('list_users'));

  const canListGroups = $derived(hasAnyPermission('list_groups'));

  const canViewLogs = $derived(hasAnyPermission('view_audit_logs'));

  const canBlock = $derived(hasAnyPermission('block'));

  const canListBlocks = $derived(hasAnyPermission('list_user_blocks'));

  const canSetUserPermissions = $derived(hasAnyPermission('set_user_permissions'));

  const canManageUserAvatars = $derived(canSetOtherUserAvatar(authStore.permissions));

  const canManageUserStatus = $derived(hasAnyPermission('manage_user_status'));

  const canManage2fa = $derived(hasAnyPermission('super_configure_auth_methods'));

  let now = $state(Date.now());

  let disposed = false;

  let resetPending = false;

  onDestroy(() => { disposed = true; });

  const elevated = $derived((authStore.escalationExp ?? 0) * 1000 > now);

  onMount(() => { const timer = window.setInterval(() => { now = Date.now(); }, 1000); return () => window.clearInterval(timer); });

  function canReadUserAuthentication(user: ManagedUser) {
    return canReadAuthentication(authStore.permissions, user.user_id !== authStore.userId);
  }

  function canResetPassword(user: ManagedUser) {
    return elevated && (authStore.escalationExp ?? 0) * 1000 > Date.now()
      && canConfigureAuthentication(authStore.permissions, user.user_id !== authStore.userId);
  }

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
    if (isAdmin) { if (authStore.permissions.includes('view_settings')) activeTab = 'settings'; loadActiveTab(); }
    void document.fonts?.ready.then(() => updateIdentityColumnWidths());
  });

  onMount(() => registerKeyboardCommands({
    id: 'manage.refresh',
    label: () => translator.current('common.refresh'),
    group: () => translator.current('manage.title'),
    shortcuts: [{ key: 'F5' }, { key: 'r', primary: true }],
    scope: 'page',
    enabled: () => isAdmin && !refreshDisabled(),
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

  async function setActiveTab(tab: ManageTabKey) {
    if (activeTab === tab) return;
    if (activeTab === 'settings' && !(await serverSettings?.canLeave() ?? true)) return;
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

  function refreshDisabled() {
    return activeTab === 'settings'
      ? serverSettings?.refreshState.disabled ?? true
      : loadingUsers || loadingGroups || loadingLogs || busyKey !== null;
  }

  function loadActiveTab() {
    hideContextMenu();
    expandedActionRow = null;
    if (activeTab === 'accounts') loadUserList();
    else if (activeTab === 'groups') loadGroupList();
    else if (activeTab === 'security') securityRefreshKey += 1;
    else if (activeTab === 'settings') void serverSettings?.refresh();
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
        label: translator.current('manage.properties'),
        icon: 'info',
        onSelect: () => handleViewUser(user),
        disabled,
      },
      {
        id: 'copy-user-id',
        label: translator.current('manage.copyUserId'),
        icon: 'contentCopy',
        onSelect: () => handleCopyUserId(user),
      },
      { type: 'divider' },
      {
        id: 'set-username',
        label: translator.current('protocol30.changeUsername'),
        icon: 'edit',
        onSelect: () => handleSetUsername(user),
        disabled: disabled || !canChangeUsername(user),
        requiresElevation: !elevated,
      },
      {
        id: 'set-nickname',
        label: translator.current('manage.changeNickname'),
        icon: 'edit',
        onSelect: () => handleRenameUser(user),
        disabled: disabled || !canChangeNickname(user),
      },
      {
        id: 'edit-user-groups',
        label: translator.current('manage.editGroups'),
        icon: 'formatListBulleted',
        onSelect: () => handleEditUserGroups(user),
        disabled,
      },
      {
        id: 'edit-user-permissions',
        label: translator.current('manage.editPermissions'),
        icon: 'adminPanelSettings',
        onSelect: () => handleEditUserPermissions(user),
        disabled,
        hidden: !canSetUserPermissions,
      },
      {
        id: 'reset-user-password',
        label: translator.current('manage.resetPassword'),
        icon: 'passwordReset',
        onSelect: () => handleResetPassword(user),
        disabled: disabled || !canConfigureAuthentication(authStore.permissions, user.user_id !== authStore.userId),
        requiresElevation: !elevated,
      },
      {
        id: 'change-user-avatar',
        label: translator.current('manage.changeUserAvatar'),
        icon: 'accountCircle',
        onSelect: () => handleChangeUserAvatar(user),
        disabled,
        hidden: !canManageUserAvatars,
      },
      {
        id: 'manage-account',
        label: translator.current('manage.accountManagement'),
        icon: 'manageAccounts',
        onSelect: () => handleManageAccount(user),
        disabled,
        hidden: !canManageUserStatus && !canManage2fa && !canReadUserAuthentication(user),
      },
      {
        id: 'user-authentication',
        label: translator.current('authManagement.title'),
        icon: 'passkey',
        onSelect: () => { activeDialog = { kind: 'user-authentication', user }; },
        disabled,
        hidden: !canReadUserAuthentication(user),
      },
      { type: 'divider', hidden: !canBlock && !canListBlocks },
      {
        id: 'block-user',
        label: translator.current('manage.blockUser'),
        icon: 'block',
        onSelect: () => handleBlockUser(user),
        disabled,
        hidden: !canBlock,
      },
      {
        id: 'view-user-blocks',
        label: translator.current('manage.viewBlocks'),
        icon: 'manageAccounts',
        onSelect: () => handleListBlocks(user),
        disabled,
        hidden: !canListBlocks,
      },
      { type: 'divider' },
      {
        id: 'delete-user',
        label: translator.current('common.delete'),
        icon: 'delete',
        onSelect: () => handleDeleteUser(user),
        disabled,
        danger: true,
      },
    ];
  }

  async function handleCopyUserId(user: ManagedUser) {
    try {
      await copyText(user.user_id);
    } catch {
      notificationStore.error(translator.current('manage.userIdCopyFailed'));
    }
  }

  function getGroupContextMenuItems(group: ManagedGroup): ContextMenuItem[] {
    const disabled = busyKey !== null;

    return [
      {
        id: 'rename-group',
        label: translator.current('manage.rename'),
        icon: 'edit',
        onSelect: () => handleRenameGroup(group),
        disabled,
      },
      {
        id: 'edit-group-permissions',
        label: translator.current('manage.setPermissions'),
        icon: 'adminPanelSettings',
        onSelect: () => handleEditGroupPermissions(group),
        disabled,
      },
      { type: 'divider' },
      {
        id: 'delete-group',
        label: translator.current('common.delete'),
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

  function normalizeAuditActions(actions: readonly string[]) {
    return [...new Set(actions.map((action) => action.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
  }

  async function applyAuditFilters(filters: string[]) {
    const nextFilters = normalizeAuditActions(filters);
    if (JSON.stringify(nextFilters) === JSON.stringify(auditFilters)) return;

    auditFilters = nextFilters;
    auditKnownActions = normalizeAuditActions([...auditKnownActions, ...nextFilters]);
    await loadAuditLogPage(null, 'reset', nextFilters);
  }

  async function removeAuditFilter(action: string) {
    await applyAuditFilters(auditFilters.filter((candidate) => candidate !== action));
  }

  async function loadAuditLogPage(
    cursor: string | null,
    direction: 'reset' | 'next' | 'previous' = 'reset',
    filters: readonly string[] = auditFilters,
  ) {
    if (!canViewLogs) return;
    resetUserPreviews();
    const requestFilters = normalizeAuditActions(filters);
    if (direction === 'reset') {
      auditCursorStack = [cursor];
      auditPageIndex = 0;
      auditNextCursor = null;
    }
    loadingLogs = true;
    error = null;
    try {
      const data = await viewAuditLogs(cursor, auditPageSize, requestFilters);
      auditEntries = data.entries;
      auditNextCursor = data.next_cursor;
      auditKnownActions = normalizeAuditActions([
        ...auditKnownActions,
        ...requestFilters,
        ...data.entries.map((entry) => entry.action),
      ]);
      if (direction === 'next') {
        auditCursorStack = [...auditCursorStack.slice(0, auditPageIndex + 1), cursor];
        auditPageIndex += 1;
      } else {
        if (direction === 'previous') auditPageIndex = Math.max(0, auditPageIndex - 1);
      }
    } catch (err) {
      error = formatError(err);
      auditEntries = [];
      auditNextCursor = null;
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
      status = translator.current('manage.userCreated', { values: { username } });
      activeDialog = null;
      await loadUserList();
    });
  }

  function canChangeUsername(user: ManagedUser) { return canSetAccountName(authStore.permissions, 'username', user.user_id === authStore.userId); }
  function canChangeNickname(user: ManagedUser) { return canSetAccountName(authStore.permissions, 'nickname', user.user_id === authStore.userId); }
  function handleSetUsername(user: ManagedUser) {
    if (!canChangeUsername(user) || busyKey !== null) return;
    activeDialog = { kind: 'username', user };
  }
  async function handleRenameUser(user: ManagedUser) {
    if (!canChangeNickname(user) || busyKey !== null) return;
    const nickname = await dialogStore.prompt(translator.current('manage.newNicknamePrompt'), user.nickname ?? user.username);
    if (nickname === null || !canChangeNickname(user)) return;

    await runBusy(`rename-user:${user.user_id}`, async () => {
      await setUserNickname(user.user_id, nickname.trim());
      status = translator.current('manage.userUpdated', { values: { username: user.username } });
      await loadUserList();
    });
  }

  async function handleEditUserGroups(user: ManagedUser) {
    activeDialog = { kind: 'user-groups', user };
  }

  async function handleEditUserPermissions(user: ManagedUser) {
    activeDialog = { kind: 'user-permissions', user };
  }

  function handleChangeUserAvatar(user: ManagedUser) {
    if (!canManageUserAvatars || busyKey !== null) return;
    activeDialog = { kind: 'user-avatar', user };
  }

  async function handleResetPassword(user: ManagedUser) {
    if (resetPending || busyKey !== null
      || !canConfigureAuthentication(authStore.permissions, user.user_id !== authStore.userId)) return;
    const actorId = authStore.userId;
    resetPending = true;
    try {
      if (!(await ensureEscalation()) || disposed || authStore.userId !== actorId
        || busyKey !== null || !canResetPassword(user)) return;
      if (user.user_id === authStore.userId) { activeDialog = { kind: 'user-authentication', user }; return; }
      activeDialog = { kind: 'reset-password', user };
    } finally {
      resetPending = false;
    }
  }

  async function handleManageAccount(user: ManagedUser) {
    await runBusy(`account-management:${user.username}`, async () => {
      const [info, twoFactor] = await Promise.all([
        canManageUserStatus ? getUserInfo({ userId: user.user_id }) : Promise.resolve(null),
        canReadUserAuthentication(user) ? getManagedTwoFactorStatus(user.user_id) : Promise.resolve(null),
      ]);
      accountDisableReason = '';
      activeDialog = { kind: 'account-management', user, info, twoFactor };
    });
  }

  async function disableActiveUserTwoFactor() {
    if (activeDialog?.kind !== 'account-management' || (activeDialog.twoFactor && !activeDialog.twoFactor.enabled) || !canManage2fa || activeDialog.user.user_id === authStore.userId) return;
    const user = activeDialog.user;
    const confirmed = await dialogStore.confirm({
      title: translator.current('manage.disableUserTwoFactorTitle'),
      message: translator.current('manage.disableUserTwoFactorConfirm', { values: { username: user.username } }),
      confirmLabel: translator.current('manage.disableUserTwoFactor'),
      cancelLabel: translator.current('common.cancel'),
      danger: true,
    });
    if (!confirmed) return;

    await runBusy(`twofa:${user.username}`, async () => {
      await disableManagedTwoFactor(user.user_id);
      if (activeDialog?.kind === 'account-management' && activeDialog.user.user_id === user.user_id) {
        activeDialog = {
          ...activeDialog,
          twoFactor: { configured: false, enabled: false, backup_codes_count: 0 },
        };
      }
      status = translator.current('manage.userTwoFactorDisabled', { values: { username: user.username } });
    });
  }

  async function handleViewUser(user: Pick<ManagedUser, 'user_id'>, knownInfo?: ManagedUserInfo) {
    if (busyKey !== null) return;
    if (knownInfo) {
      showUserDetails(knownInfo);
      return;
    }
    const revision = userPreviewRevision;
    await runBusy(`view-user:${user.user_id}`, async () => {
      const info = activeTab === 'logs'
        ? await userPreviewCache.info(user.user_id)
        : await getUserInfo({ userId: user.user_id });
      if (revision !== userPreviewRevision) return;
      showUserDetails(info);
    });
  }

  function showUserDetails(info: ManagedUserInfo) {
    detailTitle = translator.current('manage.userDetailsFor', { values: { username: info.username } });
    detailRows = [
      { label: translator.current('manage.userId'), value: info.user_id },
      { label: translator.current('manage.username'), value: info.username },
      { label: translator.current('manage.nickname'), value: info.nickname || '-' },
      {
        label: translator.current('manage.accountStatus'),
        value: info.status === 'active' ? translator.current('manage.statusActive') : translator.current('manage.statusDisabled'),
      },
      { label: translator.current('manage.effectivePermissions'), value: formatList(info.effective_permissions) },
      { label: translator.current('manage.ownPermissions'), value: formatList(info.effective_own_permissions) },
      { label: translator.current('manage.inheritedPermissions'), value: formatList(info.effective_inherited_permissions) },
      { label: translator.current('manage.groups'), value: formatList(info.groups) },
      { label: translator.current('manage.registered'), value: formatDate(info.created_time) },
      { label: translator.current('manage.lastLogin'), value: formatDate(info.last_login) },
      { label: translator.current('manage.passwordChangedAt'), value: formatDate(info.passwd_last_modified) },
    ];
  }

  async function handleDeleteUser(user: ManagedUser) {
    if (!(await dialogStore.confirm({
      title: translator.current('common.delete'),
      message: translator.current('manage.deleteUserConfirm', { values: { username: user.username } }),
      confirmLabel: translator.current('common.delete'),
      cancelLabel: translator.current('common.cancel'),
      danger: true,
    }))) return;
    await runBusy(`delete-user:${user.user_id}`, async () => {
      await deleteUser(user.user_id);
      status = translator.current('manage.userDeleted', { values: { username: user.username } });
      await loadUserList();
    });
  }

  async function handleBlockUser(user: ManagedUser) {
    activeDialog = { kind: 'block-user', user };
  }

  async function handleListBlocks(user: ManagedUser) {
    await runBusy(`blocks-user:${user.user_id}`, async () => {
      const blocks = await listUserBlocks(user.user_id);
      blocksDialog = { userId: user.user_id, username: user.username, blocks };
    });
  }

  async function handleUnblock(blockId: string) {
    if (!blocksDialog) return;
    await runBusy(`unblock:${blockId}`, async () => {
      await unblockUser(blockId);
      blocksDialog = {
        userId: blocksDialog!.userId,
        username: blocksDialog!.username,
        blocks: await listUserBlocks(blocksDialog!.userId),
      };
      status = translator.current('manage.blockRevoked');
    });
  }

  async function handleEditBlockReason(block: UserBlock) {
    if (!blocksDialog) return;
    const reasonValue = await dialogStore.prompt({
      title: translator.current('manage.editBlockReasonTitle'),
      message: translator.current('manage.editBlockReasonHelp'),
      defaultValue: block.reason ?? '',
      placeholder: translator.current('manage.blockReasonPlaceholder'),
      confirmLabel: translator.current('common.save'),
      cancelLabel: translator.current('common.cancel'),
      multiline: true,
      maxLength: 1024,
    });
    if (reasonValue === null) return;

    await runBusy(`block-reason:${block.block_id}`, async () => {
      const updated = await updateUserBlock(block.block_id, reasonValue || null);
      blocksDialog = {
        userId: blocksDialog!.userId,
        username: blocksDialog!.username,
        blocks: blocksDialog!.blocks.map((entry) =>
          entry.block_id === block.block_id ? updated : entry,
        ),
      };
      status = translator.current('manage.blockReasonUpdated');
    });
  }

  async function handleCreateGroup() {
    activeDialog = { kind: 'create-group' };
  }

  async function saveCreatedGroup(groupName: string, displayName: string) {
    await runBusy('create-group', async () => {
      await createGroup(groupName, displayName);
      status = translator.current('manage.groupCreated', { values: { group: groupName } });
      activeDialog = null;
      await loadGroupList();
    });
  }

  async function handleRenameGroup(group: ManagedGroup) {
    const displayName = await dialogStore.prompt(translator.current('manage.newDisplayNamePrompt'), group.display_name ?? group.name);
    if (displayName === null || !displayName.trim()) return;

    await runBusy(`rename-group:${group.name}`, async () => {
      await renameGroup(group.name, displayName.trim());
      status = translator.current('manage.groupUpdated', { values: { group: group.name } });
      await loadGroupList();
    });
  }

  async function handleEditGroupPermissions(group: ManagedGroup) {
    activeDialog = { kind: 'group-permissions', group };
  }

  async function loadUserGroupEditorData(user: ManagedUser): Promise<ListEditorData> {
    const [allGroups, userInfo] = await Promise.all([
      listGroups(),
      getUserInfo({ userId: user.user_id }),
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

  async function loadUserPermissionEditorData(user: ManagedUser): Promise<PermissionEntriesEditorData> {
    const userInfo = await getUserInfo({ userId: user.user_id });
    return {
      entries: userInfo.permissions,
      effectivePermissions: userInfo.effective_permissions,
      inheritedPermissions: userInfo.effective_inherited_permissions,
    };
  }

  async function saveUserGroups(user: ManagedUser, selected: string[]) {
    await changeUserGroups(user.user_id, selected);
    status = translator.current('manage.userGroupsUpdated', { values: { username: user.username } });
    activeDialog = null;
    await loadUserList();
  }

  async function saveUserPermissions(user: ManagedUser, entries: PermissionEntry[]) {
    await changeUserPermissions(user.user_id, entries);
    status = translator.current('manage.userPermissionsUpdated', { values: { username: user.username } });
    activeDialog = null;
    await loadUserList();
  }

  async function saveResetPassword(
    user: ManagedUser,
    password: string,
    bypassRequirements: boolean,
    forceUpdateAfterLogin: boolean,
    disableTwoFactorAfterReset: boolean,
  ) {
    if (!canResetPassword(user)) throw new Error(translator.current('authManagement.elevationRequired'));
    await resetUserPassword(user.user_id, password, bypassRequirements, forceUpdateAfterLogin);
    let successMessage = translator.current('manage.passwordChanged', { values: { username: user.username } });

    if (disableTwoFactorAfterReset && canManage2fa) {
      try {
        await disableManagedTwoFactor(user.user_id);
        successMessage = translator.current('manage.passwordChangedAndTwoFactorDisabled', {
          values: { username: user.username },
        });
      } catch (err) {
        activeDialog = null;
        notificationStore.error(translator.current('manage.passwordChangedTwoFactorFailed', {
          values: { username: user.username, error: formatError(err) },
        }));
        return;
      }
    }

    status = successMessage;
    activeDialog = null;
  }

  async function saveBlockUser(
    user: ManagedUser,
    blockTypes: string[],
    target: UserBlockTarget,
    notAfter: number | null,
    reason: string | null,
  ) {
    await blockUser(user.user_id, blockTypes, target, notAfter, reason);
    status = translator.current('manage.userBlocked', { values: { username: user.username } });
    activeDialog = null;
  }

  async function loadGroupPermissionEditorData(group: ManagedGroup): Promise<PermissionEntriesEditorData> {
    const info = await getGroupInfo(group.name);
    return {
      entries: info.permissions,
      effectivePermissions: info.effective_permissions,
    };
  }

  async function saveGroupPermissions(group: ManagedGroup, entries: PermissionEntry[]) {
    await changeGroupPermissions(group.name, entries);
    status = translator.current('manage.groupPermissionsUpdated', { values: { group: group.name } });
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
    if (activeDialog?.kind !== 'user-permissions') {
      return { entries: [], effectivePermissions: [], inheritedPermissions: [] };
    }
    return loadUserPermissionEditorData(activeDialog.user);
  }

  async function saveActiveUserPermissions(entries: PermissionEntry[]) {
    if (activeDialog?.kind !== 'user-permissions') return;
    await saveUserPermissions(activeDialog.user, entries);
  }

  async function saveActiveResetPassword(
    password: string,
    bypassRequirements: boolean,
    forceUpdateAfterLogin: boolean,
    disableTwoFactorAfterReset: boolean,
  ) {
    if (activeDialog?.kind !== 'reset-password') return;
    await saveResetPassword(
      activeDialog.user,
      password,
      bypassRequirements,
      forceUpdateAfterLogin,
      disableTwoFactorAfterReset,
    );
  }

  async function saveActiveUserStatus(statusValue: ManagedUserStatus) {
    if (activeDialog?.kind !== 'account-management' || !activeDialog.info) return;
    const user = activeDialog.user;
    await runBusy(`status-user:${user.user_id}`, async () => {
      const reason = statusValue === 'disabled' ? accountDisableReason || null : undefined;
      const result = await manageUserStatus(user.user_id, statusValue, reason);
      status = translator.current('manage.userStatusUpdated', {
        values: { username: user.username },
      });
      if (activeDialog?.kind === 'account-management' && activeDialog.user.user_id === user.user_id) {
        activeDialog = {
          ...activeDialog,
          info: activeDialog.info ? { ...activeDialog.info, status: statusValue } : null,
        };
        accountDisableReason = result.reason ?? '';
      }
      await loadUserList();
    });
  }

  async function updateActiveAccountReason() {
    if (activeDialog?.kind !== 'account-management' || activeDialog.info?.status !== 'disabled') return;
    await saveActiveUserStatus('disabled');
  }

  function toggleActiveUserStatus() {
    if (activeDialog?.kind !== 'account-management' || !activeDialog.info) return;
    void saveActiveUserStatus(activeDialog.info.status === 'disabled' ? 'active' : 'disabled');
  }

  async function saveActiveBlockUser(
    blockTypes: string[],
    target: UserBlockTarget,
    notAfter: number | null,
    reason: string | null,
  ) {
    if (activeDialog?.kind !== 'block-user') return;
    await saveBlockUser(activeDialog.user, blockTypes, target, notAfter, reason);
  }

  async function refreshActiveGroupPermissions() {
    if (activeDialog?.kind !== 'group-permissions') return { entries: [], effectivePermissions: [] };
    return loadGroupPermissionEditorData(activeDialog.group);
  }

  async function saveActiveGroupPermissions(entries: PermissionEntry[]) {
    if (activeDialog?.kind !== 'group-permissions') return;
    await saveGroupPermissions(activeDialog.group, entries);
  }

  async function handleDeleteGroup(group: ManagedGroup) {
    if (!(await dialogStore.confirm({
      title: translator.current('common.delete'),
      message: translator.current('manage.deleteGroupConfirm', { values: { group: group.name } }),
      confirmLabel: translator.current('common.delete'),
      cancelLabel: translator.current('common.cancel'),
      danger: true,
    }))) return;
    await runBusy(`delete-group:${group.name}`, async () => {
      await deleteGroup(group.name);
      status = translator.current('manage.groupDeleted', { values: { group: group.name } });
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
    return value?.length ? value.join(', ') : translator.current('common.none');
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
    if (targetType === 'all') return translator.current('tasks.all');
    if (block.target_id) return `${targetType}: ${block.target_id}`;
    return targetType;
  }

  function formatError(err: unknown) {
    return formatUserFacingError(err);
  }

  return {

    get serverSettings() { return serverSettings; },
    set serverSettings(value) { serverSettings = value; },
    get refreshDisabled() { return refreshDisabled(); },
    get refreshBusy() { return activeTab === 'settings' ? serverSettings?.refreshState.busy ?? false : loadingUsers || loadingGroups || loadingLogs; },
    canChangeUsername, canChangeNickname, handleSetUsername,
    get canReadSettings() { return authStore.permissions.includes('view_settings'); },
    get canWriteSettings() { return authStore.permissions.includes('manage_settings'); },
    get accountDisableReason() { return accountDisableReason; },
    set accountDisableReason(value) { accountDisableReason = value; },
    get accountIdentityColumnWidth() { return accountIdentityColumnWidth; },
    set accountIdentityColumnWidth(value) { accountIdentityColumnWidth = value; },
    get accountListElement() { return accountListElement; },
    set accountListElement(value) { accountListElement = value; },
    get activeDialog() { return activeDialog; },
    set activeDialog(value) { activeDialog = value; },
    get activeTab() { return activeTab; },
    set activeTab(value) { activeTab = value; },
    get activeUserPreviewKey() { return activeUserPreviewKey; },
    set activeUserPreviewKey(value) { activeUserPreviewKey = value; },
    applyAuditFilters,
    get auditCursorStack() { return auditCursorStack; },
    set auditCursorStack(value) { auditCursorStack = value; },
    get auditDisplayRange() { return auditDisplayRange; },
    get auditEntries() { return auditEntries; },
    set auditEntries(value) { auditEntries = value; },
    get auditFilters() { return auditFilters; },
    set auditFilters(value) { auditFilters = value; },
    get auditKnownActions() { return auditKnownActions; },
    set auditKnownActions(value) { auditKnownActions = value; },
    get auditNextCursor() { return auditNextCursor; },
    set auditNextCursor(value) { auditNextCursor = value; },
    get auditPageIndex() { return auditPageIndex; },
    set auditPageIndex(value) { auditPageIndex = value; },
    get authenticationManagement() { return authenticationManagement; },
    set authenticationManagement(value) { authenticationManagement = value; },
    get blocksDialog() { return blocksDialog; },
    set blocksDialog(value) { blocksDialog = value; },
    get busyKey() { return busyKey; },
    set busyKey(value) { busyKey = value; },
    get canBlock() { return canBlock; },
    get canListAuthLockouts() { return canListAuthLockouts; },
    get canListBannedSubnets() { return canListBannedSubnets; },
    get canListBlocks() { return canListBlocks; },
    get canListGroups() { return canListGroups; },
    get canListUsers() { return canListUsers; },
    get canManage2fa() { return canManage2fa; },
    get canManageBannedSubnets() { return canManageBannedSubnets; },
    get canManageUserAvatars() { return canManageUserAvatars; },
    get canManageUserStatus() { return canManageUserStatus; },
    canReadUserAuthentication,
    canResetPassword,
    get canSetUserPermissions() { return canSetUserPermissions; },
    get canUnlockAuthLockouts() { return canUnlockAuthLockouts; },
    get canViewLogs() { return canViewLogs; },
    get contextMenu() { return contextMenu; },
    set contextMenu(value) { contextMenu = value; },
    get contextMenuItems() { return contextMenuItems; },
    get detailRows() { return detailRows; },
    set detailRows(value) { detailRows = value; },
    get detailTitle() { return detailTitle; },
    set detailTitle(value) { detailTitle = value; },
    disableActiveUserTwoFactor,
    get expandedActionRow() { return expandedActionRow; },
    set expandedActionRow(value) { expandedActionRow = value; },
    formatBlockTarget,
    formatDate,
    formatList,
    get groupIdentityColumnWidth() { return groupIdentityColumnWidth; },
    set groupIdentityColumnWidth(value) { groupIdentityColumnWidth = value; },
    get groupListElement() { return groupListElement; },
    set groupListElement(value) { groupListElement = value; },
    get groups() { return groups; },
    set groups(value) { groups = value; },
    handleBlockUser,
    handleChangeUserAvatar,
    handleCreateGroup,
    handleCreateUser,
    handleDeleteGroup,
    handleDeleteUser,
    handleEditBlockReason,
    handleEditGroupPermissions,
    handleEditUserGroups,
    handleEditUserPermissions,
    handleListBlocks,
    handleManageAccount,
    handleManageTabKeydown,
    handleRenameGroup,
    handleRenameUser,
    handleResetPassword,
    handleUnblock,
    handleViewUser,
    get hideAccountMetadata() { return hideAccountMetadata; },
    set hideAccountMetadata(value) { hideAccountMetadata = value; },
    hideContextMenu,
    get hideGroupMetadata() { return hideGroupMetadata; },
    set hideGroupMetadata(value) { hideGroupMetadata = value; },
    get identityMeasureHost() { return identityMeasureHost; },
    set identityMeasureHost(value) { identityMeasureHost = value; },
    get isAdmin() { return isAdmin; },
    loadActiveTab,
    loadAuditLogPage,
    get loadingGroups() { return loadingGroups; },
    set loadingGroups(value) { loadingGroups = value; },
    get loadingLogs() { return loadingLogs; },
    set loadingLogs(value) { loadingLogs = value; },
    get loadingUsers() { return loadingUsers; },
    set loadingUsers(value) { loadingUsers = value; },
    refreshActiveGroupPermissions,
    refreshActiveUserGroups,
    refreshActiveUserPermissions,
    removeAuditFilter,
    saveActiveBlockUser,
    saveActiveGroupPermissions,
    saveActiveResetPassword,
    saveActiveUserGroups,
    saveActiveUserPermissions,
    saveCreatedGroup,
    saveCreatedUser,
    get securityRefreshKey() { return securityRefreshKey; },
    set securityRefreshKey(value) { securityRefreshKey = value; },
    setActiveTab,
    showGroupContextMenu,
    showUserContextMenu,
    get tabs() { return tabs; },
    toggleActionRow,
    toggleActiveUserStatus,
    updateActiveAccountReason,
    get userPreviewCache() { return userPreviewCache; },
    get userPreviewRevision() { return userPreviewRevision; },
    set userPreviewRevision(value) { userPreviewRevision = value; },
    get users() { return users; },
    set users(value) { users = value; },

  };

}

export type ManagementWorkspaceController = ReturnType<typeof createManagementWorkspace>;
