// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { AuditLogsResponse, AuthLockout, AuthLockoutSelector, BannedSubnet, BannedSubnetStatus, LockdownState, ManagedGroup, ManagedUser, ManagedUserInfo, ManagedUserStatus, ManagedUserStatusUpdate, UnlockAuthLockoutsResult, UserBlock, UserBlockTarget } from './types/administration';
import type { PermissionEntry } from './types/access';
import type { ServerDiagnostics } from './types/diagnostics';
import type { TwoFactorStatus, UserKeyDetails, UserKeyMetadata } from './types/authentication';

/** Raw status is the integer value of the server's UserStatus enum. */
type ManagedUserResponse = Omit<
  ManagedUser,
  'permissions' | 'effective_permissions' | 'effective_own_permissions' | 'effective_inherited_permissions'
> & {
  permissions: unknown;
  effective_permissions: unknown;
  effective_own_permissions: unknown;
  effective_inherited_permissions: unknown;
};

type ManagedUserInfoResponse = ManagedUserResponse & {
  status: 0 | 1;
};

type ManagedGroupResponse = Omit<ManagedGroup, 'permissions' | 'effective_permissions'> & {
  permissions: unknown;
  effective_permissions: unknown;
};

export class InvalidAdminResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAdminResponseError';
  }
}

function normalizeManagedUserStatus(status: unknown): ManagedUserStatus {
  if (status === 0) return 'active';
  if (status === 1) return 'disabled';
  throw new Error(`Invalid managed user status: ${String(status)}`);
}

function invalidAdminResponse(context: string, field: string, expected: string): never {
  throw new InvalidAdminResponseError(
    `Invalid ${context} response: ${field} must be ${expected}`,
  );
}

function parsePermissionNames(value: unknown, context: string, field: string): string[] {
  if (!Array.isArray(value) || value.some((permission) => typeof permission !== 'string')) {
    return invalidAdminResponse(context, field, 'an array of permission names');
  }
  return [...value];
}

function parsePermissionEntries(value: unknown, context: string): PermissionEntry[] {
  if (!Array.isArray(value)) {
    return invalidAdminResponse(context, 'permissions', 'an array of structured permission entries');
  }

  return value.map((entry, index) => {
    if (
      typeof entry !== 'object'
      || entry === null
      || Array.isArray(entry)
      || typeof entry.permission !== 'string'
      || typeof entry.granted !== 'boolean'
      || typeof entry.start_time !== 'number'
      || !Number.isFinite(entry.start_time)
      || !(
        entry.end_time === null
        || (typeof entry.end_time === 'number' && Number.isFinite(entry.end_time))
      )
    ) {
      return invalidAdminResponse(
        context,
        `permissions[${index}]`,
        'a structured permission entry',
      );
    }

    return {
      permission: entry.permission,
      granted: entry.granted,
      start_time: entry.start_time,
      end_time: entry.end_time,
    };
  });
}

function normalizeManagedUser(user: ManagedUserResponse, context: string): ManagedUser {
  if (typeof user.user_id !== 'string' || !user.user_id) {
    return invalidAdminResponse(context, 'user_id', 'an account UUID');
  }
  return {
    ...user,
    permissions: parsePermissionEntries(user.permissions, context),
    effective_permissions: parsePermissionNames(user.effective_permissions, context, 'effective_permissions'),
    effective_own_permissions: parsePermissionNames(user.effective_own_permissions, context, 'effective_own_permissions'),
    effective_inherited_permissions: parsePermissionNames(
      user.effective_inherited_permissions,
      context,
      'effective_inherited_permissions',
    ),
  };
}

function normalizeManagedGroup(group: ManagedGroupResponse, context: string): ManagedGroup {
  return {
    ...group,
    permissions: parsePermissionEntries(group.permissions, context),
    effective_permissions: parsePermissionNames(group.effective_permissions, context, 'effective_permissions'),
  };
}

export async function listUsers(): Promise<ManagedUser[]> {
  const data = await invoke<{ users?: ManagedUserResponse[] }>("list_users");
  return Array.isArray(data.users)
    ? data.users.map((user, index) => normalizeManagedUser(user, `list_users.users[${index}]`))
    : [];
}

export async function createUser(
  username: string,
  password: string,
  nickname: string,
): Promise<{ user_id: string; username: string }> {
  return invoke("create_user", { username, password, nickname });
}

export async function renameUser(
  userId: string,
  nickname: string | null,
): Promise<boolean> {
  return invoke("rename_user", { userId, nickname });
}

export async function deleteUser(userId: string): Promise<boolean> {
  return invoke("delete_user", { userId });
}

export async function getUserInfo(selector: { userId: string; username?: never } | { username: string; userId?: never }): Promise<ManagedUserInfo> {
  const info = await invoke<ManagedUserInfoResponse>("get_user_info", selector);
  return {
    ...normalizeManagedUser(info, 'get_user_info'),
    status: normalizeManagedUserStatus(info.status),
  };
}

export async function changeUserGroups(
  userId: string,
  groups: string[],
): Promise<boolean> {
  return invoke("change_user_groups", { userId, groups });
}

export async function changeUserPermissions(
  userId: string,
  permissions: PermissionEntry[],
): Promise<boolean> {
  return invoke("change_user_permissions", { userId, permissions });
}

export async function resetUserPassword(
  userId: string,
  newPassword: string,
  bypassPasswdRequirements = false,
  forceUpdateAfterLogin = false,
): Promise<boolean> {
  return invoke("reset_user_password", {
    userId,
    newPassword,
    bypassPasswdRequirements,
    forceUpdateAfterLogin,
  });
}

export async function manageUserStatus(
  userId: string,
  status: ManagedUserStatus,
  reason?: string | null,
): Promise<ManagedUserStatusUpdate> {
  return invoke("manage_user_status", { userId, status, reason: reason ?? null });
}

export async function setLockdown(status: boolean, reason?: string | null): Promise<LockdownState> {
  return invoke("set_lockdown", { status, reason: reason ?? null });
}

export async function blockUser(
  userId: string,
  blockTypes: string[],
  target: UserBlockTarget,
  notAfter?: number | null,
  reason?: string | null,
): Promise<UserBlock> {
  return invoke("block_user", {
    userId,
    blockTypes,
    target,
    notAfter: notAfter ?? null,
    reason: reason ?? null,
  });
}

export async function listUserBlocks(userId: string): Promise<UserBlock[]> {
  const data = await invoke<{ blocks?: UserBlock[] }>("list_user_blocks", {
    userId,
  });
  return data.blocks ?? [];
}

export async function unblockUser(blockId: string): Promise<boolean> {
  return invoke("unblock_user", { blockId });
}

export async function updateUserBlock(blockId: string, reason: string | null): Promise<UserBlock> {
  return invoke("update_user_block", { blockId, reason });
}

export async function getManagedTwoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  return invoke("get_managed_2fa_status", { userId });
}

export async function disableManagedTwoFactor(userId: string): Promise<boolean> {
  return invoke("disable_managed_2fa", { userId });
}

export async function listBannedSubnets(status?: BannedSubnetStatus): Promise<BannedSubnet[]> {
  const data = await invoke<{ subnets?: BannedSubnet[] }>("list_banned_subnets", {
    status: status ?? null,
  });
  return data.subnets ?? [];
}

export async function createBannedSubnet(
  subnet: string,
  reason: string | null,
  startsAt: number | null,
  expiresAt: number | null,
  confirmSelfBlock = false,
): Promise<BannedSubnet> {
  return invoke("create_banned_subnet", {
    subnet,
    reason,
    startsAt,
    expiresAt,
    confirmSelfBlock,
  });
}

export async function updateBannedSubnet(
  subnet: string,
  reason: string | null,
  startsAt: number,
  expiresAt: number | null,
  confirmSelfBlock = false,
): Promise<BannedSubnet> {
  return invoke("update_banned_subnet", {
    subnet,
    reason,
    startsAt,
    expiresAt,
    confirmSelfBlock,
  });
}

export async function deleteBannedSubnet(subnet: string): Promise<boolean> {
  return invoke("delete_banned_subnet", { subnet });
}

export async function listAuthLockouts(): Promise<AuthLockout[]> {
  const data = await invoke<{ lockouts?: AuthLockout[] }>("list_auth_lockouts");
  return data.lockouts ?? [];
}

export async function unlockAuthLockouts(
  locks: AuthLockoutSelector[],
  reason: string,
): Promise<UnlockAuthLockoutsResult> {
  return invoke("unlock_auth_lockouts", { locks, reason });
}

export async function listGroups(): Promise<ManagedGroup[]> {
  const data = await invoke<{ groups?: ManagedGroupResponse[] }>("list_groups");
  return Array.isArray(data.groups)
    ? data.groups.map((group, index) => normalizeManagedGroup(group, `list_groups.groups[${index}]`))
    : [];
}

export async function createGroup(
  groupName: string,
  displayName: string,
): Promise<boolean> {
  return invoke("create_group", { groupName, displayName });
}

export async function renameGroup(
  groupName: string,
  displayName: string,
): Promise<boolean> {
  return invoke("rename_group", { groupName, displayName });
}

export async function deleteGroup(groupName: string): Promise<boolean> {
  return invoke("delete_group", { groupName });
}

export async function getGroupInfo(groupName: string): Promise<ManagedGroup> {
  const group = await invoke<ManagedGroupResponse>("get_group_info", { groupName });
  return normalizeManagedGroup(group, 'get_group_info');
}

export async function changeGroupPermissions(
  groupName: string,
  permissions: PermissionEntry[],
): Promise<boolean> {
  return invoke("change_group_permissions", { groupName, permissions });
}

export async function viewAuditLogs(
  cursor: string | null = null,
  pageSize = 128,
  filters: string[] = [],
): Promise<AuditLogsResponse> {
  const data = await invoke<Partial<AuditLogsResponse>>("view_audit_logs", {
    cursor,
    pageSize,
    filters,
  });
  return {
    entries: data.entries ?? [],
    page_size: data.page_size ?? pageSize,
    next_cursor: data.next_cursor ?? null,
    has_more: data.has_more ?? false,
  };
}

/** Load the permission-protected protocol 22 server diagnostic snapshot. */
export async function getServerDiagnostics(): Promise<ServerDiagnostics> {
  return invoke('server_diagnostics');
}

export async function listUserKeys(userId?: string | null): Promise<UserKeyMetadata[]> {
  const data = await invoke<{ keys?: UserKeyMetadata[] }>("list_user_keys", {
    userId: userId ?? null,
  });
  return data.keys ?? [];
}

export async function getUserKey(id: string): Promise<UserKeyDetails> {
  const data = await invoke<Omit<UserKeyDetails, 'id'>>("get_user_key", { id });
  return {
    ...data,
    id: data.key_id,
  };
}

export async function deleteUserKey(id: string): Promise<boolean> {
  return invoke("delete_user_key", { id });
}

// ---------------------------------------------------------------------------
