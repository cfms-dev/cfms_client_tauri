// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { AuditLogsResponse, AuthLockout, AuthLockoutSelector, BannedSubnet, BannedSubnetStatus, ManagedGroup, ManagedUser, ManagedUserInfo, ManagedUserStatus, TwoFactorStatus, UnlockAuthLockoutsResult, UserBlock, UserBlockTarget, UserKeyDetails, UserKeyMetadata } from './types';

/** Raw status is the integer value of the server's UserStatus enum. */
type ManagedUserInfoResponse = Omit<ManagedUserInfo, 'status'> & {
  status: ManagedUserStatus | 0 | 1;
};

function normalizeManagedUserStatus(status: unknown): ManagedUserStatus {
  if (status === 'active' || status === 0) return 'active';
  if (status === 'disabled' || status === 1) return 'disabled';
  throw new Error(`Invalid managed user status: ${String(status)}`);
}

export async function listUsers(): Promise<ManagedUser[]> {
  const data = await invoke<{ users?: ManagedUser[] }>("list_users");
  return data.users ?? [];
}

export async function createUser(
  username: string,
  password: string,
  nickname: string,
): Promise<boolean> {
  return invoke("create_user", { username, password, nickname });
}

export async function renameUser(
  username: string,
  nickname: string,
): Promise<boolean> {
  return invoke("rename_user", { username, nickname });
}

export async function deleteUser(username: string): Promise<boolean> {
  return invoke("delete_user", { username });
}

export async function getUserInfo(username: string): Promise<ManagedUserInfo> {
  const info = await invoke<ManagedUserInfoResponse>("get_user_info", { username });
  return {
    ...info,
    status: normalizeManagedUserStatus(info.status),
  };
}

export async function changeUserGroups(
  username: string,
  groups: string[],
): Promise<boolean> {
  return invoke("change_user_groups", { username, groups });
}

export async function changeUserPermissions(
  username: string,
  permissions: string[],
): Promise<boolean> {
  return invoke("change_user_permissions", { username, permissions });
}

export async function resetUserPassword(
  username: string,
  newPassword: string,
  bypassPasswdRequirements = false,
  forceUpdateAfterLogin = false,
): Promise<boolean> {
  return invoke("reset_user_password", {
    username,
    newPassword,
    bypassPasswdRequirements,
    forceUpdateAfterLogin,
  });
}

export async function manageUserStatus(
  username: string,
  status: ManagedUserStatus,
  reason?: string,
): Promise<boolean> {
  return invoke("manage_user_status", { username, status, reason: reason ?? null });
}

export async function setLockdown(status: boolean, reason?: string): Promise<boolean> {
  return invoke("set_lockdown", { status, reason: reason ?? null });
}

export async function blockUser(
  username: string,
  blockTypes: string[],
  target: UserBlockTarget,
  notAfter?: number | null,
): Promise<boolean> {
  return invoke("block_user", {
    username,
    blockTypes,
    target,
    notAfter: notAfter ?? null,
  });
}

export async function listUserBlocks(username: string): Promise<UserBlock[]> {
  const data = await invoke<{ blocks?: UserBlock[] }>("list_user_blocks", {
    username,
  });
  return data.blocks ?? [];
}

export async function unblockUser(blockId: string): Promise<boolean> {
  return invoke("unblock_user", { blockId });
}

export async function getManagedTwoFactorStatus(username: string): Promise<TwoFactorStatus> {
  return invoke("get_managed_2fa_status", { username });
}

export async function disableManagedTwoFactor(username: string): Promise<boolean> {
  return invoke("disable_managed_2fa", { username });
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
  const data = await invoke<{ groups?: ManagedGroup[] }>("list_groups");
  return data.groups ?? [];
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
  return invoke("get_group_info", { groupName });
}

export async function changeGroupPermissions(
  groupName: string,
  permissions: string[],
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

export async function listUserKeys(targetUsername?: string | null): Promise<UserKeyMetadata[]> {
  const data = await invoke<{ keys?: UserKeyMetadata[] }>("list_user_keys", {
    targetUsername: targetUsername ?? null,
  });
  return data.keys ?? [];
}

export async function getUserKey(id: string): Promise<UserKeyDetails> {
  const data = await invoke<UserKeyDetails>("get_user_key", { id });
  return {
    ...data,
    id: data.id ?? data.key_id ?? id,
  };
}

export async function deleteUserKey(id: string): Promise<boolean> {
  return invoke("delete_user_key", { id });
}

// ---------------------------------------------------------------------------
