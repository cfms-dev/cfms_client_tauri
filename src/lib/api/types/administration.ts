import type { PermissionEntry } from './access';
import type { CursorPageMeta } from './common';

export interface ManagedUser {
  user_id: string;
  username: string;
  nickname?: string | null;
  /** Structured permission entries assigned directly to this user. */
  permissions: PermissionEntry[];
  /** Final effective permission names after direct and inherited revocations. */
  effective_permissions: string[];
  /** Effective permission names contributed by direct entries alone. */
  effective_own_permissions: string[];
  /** Effective permission names contributed by active group entries. */
  effective_inherited_permissions: string[];
  groups?: string[];
  created_time?: number | null;
  last_login?: number | null;
  passwd_last_modified?: number | null;
}

export type ManagedUserStatus = "active" | "disabled";

export interface ManagedUserStatusUpdate {
  user_id: string;
  username: string;
  status: ManagedUserStatus;
  reason: string | null;
}

/** Detailed account data returned by get_user_info. */
export interface ManagedUserInfo extends ManagedUser {
  status: ManagedUserStatus;
}

export interface ManagedGroup {
  name: string;
  display_name?: string | null;
  permissions: PermissionEntry[];
  effective_permissions: string[];
  members?: string[];
}

export interface UserBlockTarget {
  type: "all" | "directory" | "document";
  id?: string;
}

export interface UserBlock {
  user_id: string;
  block_id: string;
  block_types: string[];
  target_type?: string;
  target_id?: string | null;
  timestamp?: number | null;
  not_before?: number | null;
  not_after?: number | null;
  reason: string | null;
}

export interface LockdownState {
  status: boolean;
  reason: string | null;
}

export type BannedSubnetStatus = "scheduled" | "active" | "expired";

export interface BannedSubnet {
  subnet: string;
  reason: string | null;
  created_at: number;
  starts_at: number;
  expires_at: number | null;
  status: BannedSubnetStatus;
}

export type AuthFactor = "password" | "totp";

export type AuthLockoutScope = "ip" | "account" | "account_ip";

export interface AuthLockout {
  scope: AuthLockoutScope;
  username: string | null;
  factor: AuthFactor | null;
  ip_address: string | null;
  failed_attempts: number;
  window_started_at: number | null;
  last_attempt: number;
  locked_until: number;
  retry_after_seconds: number;
}

export type AuthLockoutSelector =
  | { scope: "ip"; ip_address: string }
  | { scope: "account"; username: string; factor: AuthFactor }
  | { scope: "account_ip"; username: string; ip_address: string };

export interface UnlockAuthLockoutsResult {
  cleared: AuthLockoutSelector[];
  not_found: AuthLockoutSelector[];
}

export interface AuditLogEntry {
  id: string;
  action: string;
  user_id: string | null;
  target: string;
  data: unknown;
  result: string;
  remote_address: string;
  logged_time: number;
}

export interface AuditLogsResponse extends CursorPageMeta {
  entries: AuditLogEntry[];
}
