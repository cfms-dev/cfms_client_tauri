// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { AuditLogsResponse, ManagedGroup, ManagedUser, ManagedUserStatus, UserBlock, UserBlockTarget, UserKeyDetails, UserKeyMetadata } from './types';

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

export async function getUserInfo(username: string): Promise<ManagedUser> {
  return invoke("get_user_info", { username });
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
