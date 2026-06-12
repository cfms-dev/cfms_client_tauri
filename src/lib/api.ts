// CFMS Client — Typed Tauri IPC bridge
//
// Every function here wraps `invoke()` from `@tauri-apps/api/core`.
// The WebView MUST NOT perform direct file I/O or network requests —
// all sensitive operations go through these wrappers → Rust backend.
//
// TypeScript types mirror the Rust structs in `cfms_core::types`.

import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Enums (matching Rust repr)
// ---------------------------------------------------------------------------

export type DownloadTaskStatus =
  | "pending"
  | "downloading"
  | "paused"
  | "decrypting"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "scheduled";

export type UploadTaskStatus =
  | "pending"
  | "uploading"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export type DownloadPhase =
  | "downloading"
  | "decrypting"
  | "cleaning"
  | "verifying";

// ---------------------------------------------------------------------------
// DTOs (matching cfms_core::types)
// ---------------------------------------------------------------------------

export interface DownloadTaskDto {
  task_id: string;
  file_id: string;
  filename: string;
  file_path: string;
  status: DownloadTaskStatus;
  progress: number;
  current_bytes: number;
  total_bytes: number;
  message: string | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  priority: number;
  retry_count: number;
  max_retries: number;
  scheduled_time: number | null;
  stage: number;
  bandwidth_limit: number | null;
  pause_position: number | null;
  supports_resume: boolean;
}

export interface FileEntry {
  path: string;
  size: number;
  is_dir: boolean;
  modified: number | null;
}

/** A directory/folder entry returned by the server's list_directory action. */
export interface ServerDirectoryEntry {
  id: string;
  name: string;
  created_time: number | null;
}

/** A document/file entry returned by the server's list_directory action. */
export interface ServerDocumentEntry {
  id: string;
  title: string;
  size: number;
  last_modified: number | null;
}

export interface ServerDocumentInfo {
  document_id?: string;
  title?: string;
  size?: number;
  created_time?: number | null;
  last_modified?: number | null;
  parent_id?: string | null;
  access_rules?: unknown;
  info_code?: number | null;
}

export interface ServerDirectoryInfo {
  directory_id?: string;
  name?: string;
  count_of_child?: number;
  created_time?: number | null;
  parent_id?: string | null;
  access_rules?: unknown;
  info_code?: number | null;
}

export type ServerObjectType = "document" | "directory";
export type AccessEntityType = "user" | "group";
export type AccessType = "read" | "write" | "move" | "manage";

export interface AccessEntry {
  id: number;
  entity_type: AccessEntityType | string;
  entity_identifier: string;
  target_type: ServerObjectType | string;
  target_identifier: string;
  access_type: AccessType | string;
  start_time: number | null;
  end_time: number | null;
}

export interface RevisionEntry {
  id: string;
  parent_id?: string | null;
  created_time?: number | null;
  is_current?: boolean;
}

/** Response data for the list_directory server action. */
export interface ListDirectoryResponse {
  folders: ServerDirectoryEntry[];
  documents: ServerDocumentEntry[];
  parent_id: string | null;
}

export interface SearchDirectoryEntry extends ServerDirectoryEntry {
  parent_id?: string | null;
}

export interface SearchDocumentEntry {
  id: string;
  name?: string;
  title?: string;
  parent_id?: string | null;
  size?: number;
  last_modified?: number | null;
}

export interface SearchFilesResponse {
  documents: SearchDocumentEntry[];
  directories: SearchDirectoryEntry[];
  total_count: number;
}

export interface DeletedDirectoryEntry {
  id: string;
  name: string;
  created_time?: number | null;
}

export interface DeletedDocumentEntry {
  id: string;
  title: string;
  created_time?: number | null;
}

export interface DeletedItemsResponse {
  folders: DeletedDirectoryEntry[];
  documents: DeletedDocumentEntry[];
}

export interface ManagedUser {
  username: string;
  nickname?: string | null;
  permissions?: string[];
  groups?: string[];
  created_time?: number | null;
  last_login?: number | null;
  passwd_last_modified?: number | null;
}

export interface ManagedGroup {
  name: string;
  display_name?: string | null;
  permissions?: string[];
  members?: string[];
}

export interface UserBlockTarget {
  type: "all" | "directory" | "document";
  id?: string;
}

export interface UserBlock {
  block_id: string;
  block_types: string[];
  target_type?: string;
  target_id?: string | null;
  timestamp?: number | null;
  not_before?: number | null;
  not_after?: number | null;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  username: string;
  target: string;
  data: unknown;
  result: string;
  remote_address: string;
  logged_time: number;
}

export interface AuditLogsResponse {
  total: number;
  entries: AuditLogEntry[];
}

export interface ServiceStatusInfo {
  name: string;
  running: boolean;
}

export interface FileMetadata {
  file_size: number | null;
  chunk_size: number;
  total_chunks: number;
}

export interface DownloadProgress {
  phase: DownloadPhase;
  progress: number;
  message: string;
}

export interface UploadProgress {
  current: number;
  total: number;
}

export interface UploadRevisionProgressEvent {
  document_id: string;
  task_id: string;
  current_bytes: number;
  total_bytes: number;
  progress: number;
}

export type UploadConflictStrategy = "fail" | "skip" | "overwrite";

export interface UploadProgressEvent {
  upload_id: string;
  task_id: string | null;
  file_name: string;
  current_bytes: number;
  total_bytes: number;
  progress: number;
  status: UploadTaskStatus;
  message: string | null;
}

export interface UploadTaskDto {
  upload_id: string;
  task_id: string | null;
  file_name: string;
  source_path: string;
  status: UploadTaskStatus;
  progress: number;
  current_bytes: number;
  total_bytes: number;
  message: string | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface SelectedUploadDirectory {
  uri: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Service Events (tagged union — cfms_core::ServiceEvent)
// ---------------------------------------------------------------------------

export type ServiceEvent =
  | { event: "DownloadProgress"; data: { task_id: string; phase: string; progress: number; message: string; current_bytes: number; total_bytes: number } }
  | { event: "DownloadCompleted"; data: { task_id: string; file_path: string } }
  | { event: "DownloadFailed"; data: { task_id: string; error: string } }
  | { event: "DownloadCancelled"; data: { task_id: string } }
  | { event: "ActiveCountChanged"; data: { count: number } }
  | { event: "Lockdown"; data: { status: boolean } }
  | { event: "ConnectionRestored" }
  | { event: "ConnectionLost"; data: { error: string } }
  | { event: "TokenExpired" }
  | {
      event: "FavoritesValidationComplete";
      data: {
        invalid_count: number;
        invalid_files: string[];
        invalid_directories: string[];
        access_denied_files: string[];
        access_denied_directories: string[];
      };
    };

// ---------------------------------------------------------------------------
// Auth / Connection types
// ---------------------------------------------------------------------------

export interface AuthStatus {
  username: string | null;
  nickname: string | null;
  has_token: boolean;
  token_exp: number | null;
  permissions: string[];
  groups: string[];
  /** Local filesystem path to the cached user avatar. */
  avatar_path?: string | null;
  /** When true, the server requires 2FA verification before completing login. */
  requires_2fa?: boolean;
  /** The 2FA method requested by the server (e.g. "totp"). */
  "2fa_method"?: string;
}

export interface ServerState {
  connected: boolean;
  server_address: string | null;
  /** Human-readable display name reported by the server via server_info. */
  server_name: string | null;
  /** Wire-protocol version the connected server speaks. */
  protocol_version: number | null;
  lockdown: boolean;
}

export interface TwoFactorStatus {
  enabled: boolean;
  method: string | null;
  backup_codes_count: number;
}

export interface TwoFactorSetup {
  secret: string;
  provisioning_uri: string;
  backup_codes: string[];
}

/** Metadata returned by the connect command after a successful server_info
 *  handshake.  Mirrors cfms_core::ServerInfo on the Rust side. */
export interface ServerInfo {
  server_name: string;
  protocol_version: number;
  lockdown: boolean;
}

export interface ConnectionSettings {
  enable_proxy: boolean;
  follow_system_proxy: boolean;
  custom_proxy: string;
  force_ipv4: boolean;
  client_cert_path: string;
  client_key_path: string;
}

// ---------------------------------------------------------------------------
// IPC command wrappers
// ---------------------------------------------------------------------------

/** Ping the Rust backend. */
export async function ping(): Promise<string> {
  return invoke("ping");
}

/** Get the current protocol version. */
export async function protocolVersion(): Promise<number> {
  return invoke("protocol_version");
}

/** Get cryptographic constants (iterations, key lengths, etc.). */
export async function cryptoInfo(): Promise<{
  kdf_iterations: number;
  salt_len: number;
  key_len: number;
  nonce_len: number;
  tag_len: number;
}> {
  return invoke("crypto_info");
}

/** Get the running status of all background services. */
export async function getServiceStatus(): Promise<ServiceStatusInfo[]> {
  return invoke("get_service_status");
}

// ---------------------------------------------------------------------------
// Auth / Connection
// ---------------------------------------------------------------------------

/** Log in with username + password. Derives KEK via PBKDF2 on the Rust side.
 *
 * If the server requires 2FA (code 202), the returned `AuthStatus` will have
 * `requires_2fa: true`.  The caller should then prompt the user for a
 * verification code and re-invoke this function with `twofaToken`.
 */
export async function login(
  username: string,
  password: string,
  twofaToken?: string,
): Promise<AuthStatus> {
  return invoke("login", { username, password, twofaToken: twofaToken ?? null });
}

/** Change the current user's password via the server `set_passwd` action.
 *
 * Used for the self-change flow when the server rejects login with code
 * 4001/4002 (password must be changed before login).  No authentication token
 * is required — the server verifies `oldPassword` directly.  Throws with the
 * server's `(code) message` on failure (e.g. password-rule violations).
 */
export async function changePassword(
  username: string,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  return invoke("change_password", { username, oldPassword, newPassword });
}

/** Log out — clears auth state and closes the connection. */
export async function logout(): Promise<void> {
  return invoke("logout");
}

/** Establish WSS connection to a CFMS server and perform the initial
 *  server_info handshake.
 *
 *  Returns [`ServerInfo`] on success.  Throws with a specially-formatted
 *  error string on protocol version mismatch:
 *
 *  - `"server_update_required:<server_ver>:<client_ver>"` — server is newer.
 *  - `"server_too_old:<server_ver>:<client_ver>"` — server is too old.
 */
export async function connect(
  url: string,
  disableSslEnforcement: boolean,
): Promise<ServerInfo> {
  return invoke("connect", {
    url,
    disableSslEnforcement,
  });
}

/** Close the WSS connection. */
export async function disconnect(): Promise<void> {
  return invoke("disconnect");
}

/** Get the current authentication status (username, token, permissions, etc.). */
export async function getAuthStatus(): Promise<AuthStatus> {
  return invoke("get_auth_status");
}

/** Get the current server-connection state (connected, address, lockdown). */
export async function getServerState(): Promise<ServerState> {
  return invoke("get_server_state");
}

/** Get the authenticated user's two-factor authentication status. */
export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  return invoke("get_2fa_status");
}

/** Start TOTP setup for the authenticated user. */
export async function setupTwoFactor(): Promise<TwoFactorSetup> {
  return invoke("setup_2fa");
}

/** Verify the TOTP setup code and enable two-factor authentication. */
export async function validateTwoFactor(token: string): Promise<void> {
  return invoke("validate_2fa", { token });
}

/** Cancel a pending TOTP setup before verification. */
export async function cancelTwoFactorSetup(): Promise<void> {
  return invoke("cancel_2fa_setup");
}

/** Disable two-factor authentication for the authenticated user. */
export async function disableTwoFactor(password: string): Promise<void> {
  return invoke("disable_2fa", { password });
}

// ---------------------------------------------------------------------------
// Download queue
// ---------------------------------------------------------------------------

/** Add a download task to the queue. */
export async function addDownload(task: DownloadTaskDto): Promise<void> {
  return invoke("add_download", { task });
}

/** Get download tasks, optionally filtered by status. */
export async function getDownloadTasks(
  statusFilter?: DownloadTaskStatus,
): Promise<DownloadTaskDto[]> {
  return invoke("get_download_tasks", { statusFilter: statusFilter ?? null });
}

/** Pause an in-progress download. */
export async function pauseDownload(taskId: string): Promise<boolean> {
  return invoke("pause_download", { taskId });
}

/** Resume a paused download. */
export async function resumeDownload(taskId: string): Promise<boolean> {
  return invoke("resume_download", { taskId });
}

/** Cancel a download task. */
export async function cancelDownload(taskId: string): Promise<boolean> {
  return invoke("cancel_download", { taskId });
}

/** Clear all completed and cancelled tasks. */
export async function clearCompletedTasks(): Promise<number> {
  return invoke("clear_completed_tasks");
}

/** Clear all failed tasks. */
export async function clearFailedTasks(): Promise<number> {
  return invoke("clear_failed_tasks");
}

// ---------------------------------------------------------------------------
// Server-side file browsing
// ---------------------------------------------------------------------------

/** List a directory on the CFMS server via the active WSS connection.
 *
 * Pass `folderId = null` to list the root directory.
 * Returns sub-folders, documents, and the parent folder ID.
 */
export async function listDirectory(
  folderId: string | null,
): Promise<ListDirectoryResponse> {
  return invoke("list_directory", { folderId });
}

/** Request a document download from the CFMS server.
 *
 * Sends the `get_document` action, which creates a download task on the
 * server and adds it to the persistent local download queue.
 */
export async function getDocument(
  documentId: string,
  filename: string,
): Promise<{
  task_id: string;
  file_id: string;
  filename: string;
  file_path: string;
}> {
  return invoke("get_document", { documentId, filename });
}

/** Delete a download task from the database and remove its file from disk. */
export async function deleteDownload(taskId: string): Promise<boolean> {
  return invoke("delete_download", { taskId });
}

/** Open a completed download with the platform's default application. */
export async function openDownloadedFile(path: string): Promise<void> {
  return invoke("open_downloaded_file", { path });
}

/** Create a new directory on the CFMS server.
 *
 * Mirrors `create_directory` from the Python reference.
 * Returns the new directory's ID.
 */
export async function createDirectory(
  parentId: string | null,
  name: string,
  existsOk?: boolean,
): Promise<string> {
  return invoke("create_directory", {
    parentId,
    name,
    existsOk: existsOk ?? false,
  });
}

/** Delete a directory on the CFMS server. */
export async function deleteDirectory(folderId: string): Promise<boolean> {
  return invoke("delete_directory", { folderId });
}

/** Delete a document on the CFMS server. */
export async function deleteDocument(documentId: string): Promise<boolean> {
  return invoke("delete_document", { documentId });
}

export async function renameDirectory(
  folderId: string,
  newName: string,
): Promise<boolean> {
  return invoke("rename_directory", { folderId, newName });
}

export async function renameDocument(
  documentId: string,
  newTitle: string,
): Promise<boolean> {
  return invoke("rename_document", { documentId, newTitle });
}

export async function moveDirectory(
  folderId: string,
  targetFolderId?: string | null,
): Promise<boolean> {
  return invoke("move_directory", {
    folderId,
    targetFolderId: targetFolderId ?? null,
  });
}

export async function moveDocument(
  documentId: string,
  targetFolderId?: string | null,
): Promise<boolean> {
  return invoke("move_document", {
    documentId,
    targetFolderId: targetFolderId ?? null,
  });
}

export async function getDirectoryInfo(
  directoryId: string,
): Promise<ServerDirectoryInfo> {
  return invoke("get_directory_info", { directoryId });
}

export async function getDocumentInfo(
  documentId: string,
): Promise<ServerDocumentInfo> {
  return invoke("get_document_info", { documentId });
}

export async function viewAccessEntries(
  objectType: ServerObjectType,
  objectIdentifier: string,
): Promise<AccessEntry[]> {
  const data = await invoke<{ result?: AccessEntry[] }>("view_access_entries", {
    objectType,
    objectIdentifier,
  });
  return data.result ?? [];
}

export async function revokeAccess(entryId: number): Promise<boolean> {
  return invoke("revoke_access", { entryId });
}

export async function grantAccess(
  entityIdentifier: string,
  entityType: AccessEntityType,
  targetType: ServerObjectType,
  targetIdentifier: string,
  accessTypes: AccessType[],
  startTime: number,
  endTime: number,
): Promise<boolean> {
  return invoke("grant_access", {
    entityIdentifier,
    entityType,
    targetType,
    targetIdentifier,
    accessTypes,
    startTime,
    endTime,
  });
}

export async function getAccessRules(
  objectType: ServerObjectType,
  objectId: string,
): Promise<{ rules: unknown; inherit: boolean }> {
  return invoke("get_access_rules", { objectType, objectId });
}

export async function setAccessRules(
  objectType: ServerObjectType,
  objectId: string,
  accessRules: unknown,
  inheritParent: boolean,
): Promise<boolean> {
  return invoke("set_access_rules", {
    objectType,
    objectId,
    accessRules,
    inheritParent,
  });
}

export async function listRevisions(documentId: string): Promise<RevisionEntry[]> {
  const data = await invoke<{ revisions?: RevisionEntry[] }>("list_revisions", {
    documentId,
  });
  return (data.revisions ?? []).map((revision) => ({
    ...revision,
    id: String(revision.id),
    parent_id:
      revision.parent_id === null || revision.parent_id === undefined
        ? null
        : String(revision.parent_id),
  }));
}

export async function getRevision(
  revisionId: string,
  filename: string,
  isCurrent = false,
): Promise<{
  task_id: string;
  file_id: string;
  filename: string;
  file_path: string;
}> {
  return invoke("get_revision", {
    revisionId: String(revisionId),
    filename,
    isCurrent,
  });
}

export async function setCurrentRevision(
  documentId: string,
  revisionId: string,
): Promise<boolean> {
  return invoke("set_current_revision", { documentId, revisionId: String(revisionId) });
}

export async function uploadNewRevision(
  documentId: string,
  filePath: string,
): Promise<{ task_id: string; document_id: string }> {
  return invoke("upload_new_revision", { documentId, filePath });
}

export async function uploadDocumentFile(
  parentId: string | null,
  filePath: string,
  uploadId: string,
  conflictStrategy: UploadConflictStrategy = "overwrite",
  uploadName?: string,
): Promise<{
  upload_id: string;
  task_id: string | null;
  document_id: string | null;
  file_name: string;
  skipped: boolean;
  overwritten: boolean;
}> {
  return invoke("upload_document_file", {
    parentId,
    filePath,
    uploadId,
    conflictStrategy,
    uploadName: uploadName ?? null,
  });
}

export async function uploadDirectory(
  parentId: string | null,
  directoryPath: string,
  uploadId: string,
  conflictStrategy: UploadConflictStrategy = "overwrite",
  uploadName?: string,
): Promise<{
  upload_id: string;
  directory_id: string;
  total_files: number;
  uploaded_files: number;
}> {
  return invoke("upload_directory", {
    parentId,
    directoryPath,
    uploadId,
    conflictStrategy,
    uploadName: uploadName ?? null,
  });
}

export async function selectUploadDirectory(): Promise<SelectedUploadDirectory> {
  return invoke("select_upload_directory");
}

export async function pauseUpload(uploadId: string): Promise<boolean> {
  return invoke("pause_upload", { uploadId });
}

export async function resumeUpload(uploadId: string): Promise<boolean> {
  return invoke("resume_upload", { uploadId });
}

export async function cancelUpload(uploadId: string): Promise<boolean> {
  return invoke("cancel_upload", { uploadId });
}

export async function searchFiles(
  query: string,
  options: {
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    searchDocuments?: boolean;
    searchDirectories?: boolean;
  } = {},
): Promise<SearchFilesResponse> {
  const data = await invoke<Partial<SearchFilesResponse>>("search_files", {
    query,
    limit: options.limit ?? 100,
    sortBy: options.sortBy ?? "name",
    sortOrder: options.sortOrder ?? "asc",
    searchDocuments: options.searchDocuments ?? true,
    searchDirectories: options.searchDirectories ?? true,
  });
  return {
    documents: data.documents ?? [],
    directories: data.directories ?? [],
    total_count:
      data.total_count
      ?? ((data.documents?.length ?? 0) + (data.directories?.length ?? 0)),
  };
}

// ---------------------------------------------------------------------------
// Trash / recycle bin
// ---------------------------------------------------------------------------

export async function listDeletedItems(
  folderId = "/",
): Promise<DeletedItemsResponse> {
  const data = await invoke<Partial<DeletedItemsResponse>>("list_deleted_items", {
    folderId,
  });
  return {
    folders: data.folders ?? [],
    documents: data.documents ?? [],
  };
}

export async function restoreDocument(
  documentId: string,
  newTitle?: string | null,
  targetFolderId?: string | null,
): Promise<boolean> {
  return invoke("restore_document", {
    documentId,
    newTitle: newTitle ?? null,
    targetFolderId: targetFolderId ?? null,
  });
}

export async function restoreDirectory(
  folderId: string,
  newName?: string | null,
  targetParentId?: string | null,
): Promise<boolean> {
  return invoke("restore_directory", {
    folderId,
    newName: newName ?? null,
    targetParentId: targetParentId ?? null,
  });
}

export async function purgeDocument(documentId: string): Promise<boolean> {
  return invoke("purge_document", { documentId });
}

export async function purgeDirectory(folderId: string): Promise<boolean> {
  return invoke("purge_directory", { folderId });
}

// ---------------------------------------------------------------------------
// Administration / management
// ---------------------------------------------------------------------------

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
  offset: number,
  count: number,
): Promise<AuditLogsResponse> {
  const data = await invoke<Partial<AuditLogsResponse>>("view_audit_logs", {
    offset,
    count,
  });
  return {
    total: data.total ?? 0,
    entries: data.entries ?? [],
  };
}

// ---------------------------------------------------------------------------
// Local file scanning (legacy — use listDirectory for server browsing)
// ---------------------------------------------------------------------------

/** Scan a local directory recursively. */
export async function scanDirectory(
  path: string,
  pattern?: string,
): Promise<FileEntry[]> {
  return invoke("scan_directory", { path, pattern: pattern ?? null });
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

/** Read a user setting by key. */
export async function getSetting(key: string): Promise<string | null> {
  return invoke("get_setting", { key });
}

/** Write a user setting. */
export async function setSetting(key: string, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

/** Get the active backend locale. */
export async function getLocale(): Promise<string> {
  return invoke("get_locale");
}

/** Set the active frontend/backend locale. */
export async function setLocale(language: string): Promise<string> {
  return invoke("set_locale", { language });
}

/** Translate a backend Fluent message key using the active locale. */
export async function translateBackend(key: string): Promise<string> {
  return invoke("translate_backend", { key });
}

/** Load connection settings that are consumed by backend connections. */
export async function getConnectionSettings(): Promise<ConnectionSettings> {
  return invoke("get_connection_settings");
}

/** Save connection settings consumed by backend connections. */
export async function setConnectionSettings(
  settings: ConnectionSettings,
): Promise<void> {
  return invoke("set_connection_settings", { settings });
}

// ---------------------------------------------------------------------------
// Avatar commands (mirrors reference/src/include/util/avatar.py)
// ---------------------------------------------------------------------------

/** Get the avatar task data for a user from the server. */
export async function getUserAvatar(
  username: string,
): Promise<object | null> {
  return invoke("get_user_avatar", { username });
}

/** Download an avatar file from the server and cache it locally.
 *
 *  Returns the local filesystem path to the cached avatar, or null on failure. */
export async function downloadAvatar(
  taskData: object,
  username: string,
  forceDownload?: boolean,
): Promise<string | null> {
  return invoke("download_avatar", {
    taskData,
    username,
    forceDownload: forceDownload ?? false,
  });
}

/** Check whether a cached avatar exists locally for a username on the
 *  currently-connected server.
 *
 *  Returns the local filesystem path to the cached file if it exists,
 *  or `null` otherwise.  Safe to call before login — it only reads the
 *  local filesystem and does not talk to the server. */
export async function checkCachedAvatar(
  username: string,
): Promise<string | null> {
  return invoke("check_cached_avatar", { username });
}

/** Set a user's avatar to a specific document ID on the server. */
export async function setUserAvatar(
  username: string,
  documentId: string,
): Promise<boolean> {
  return invoke("set_user_avatar", { username, documentId });
}

// ---------------------------------------------------------------------------
// User preference commands (mirrors reference/src/include/util/userpref.py)
// ---------------------------------------------------------------------------

/** Per-user application preferences stored as an encrypted file.
 *
 *  Mirrors the Python `UserPreference` dataclass. */
export interface UserPreference {
  theme: string;
  favourites: Favourites;
  recent_visits: RecentVisitPreferenceRecord[];
  use_external_storage: boolean;
  external_storage_path: string;
}

export interface Favourites {
  files: Record<string, string>;
  directories: Record<string, string>;
}

export interface RecentVisitPreferenceRecord {
  type: ServerObjectType;
  id: string;
  name: string;
  parentId?: string | null;
  visitedAt: number;
}

/** Load the current user's preferences from the encrypted local file. */
export async function loadUserPreference(): Promise<UserPreference> {
  return invoke("load_user_preference");
}

/** Save the current user's preferences to an encrypted local file. */
export async function saveUserPreference(
  preferences: UserPreference,
): Promise<void> {
  return invoke("save_user_preference", { preferences });
}

// ---------------------------------------------------------------------------
// Download task reload (mirrors reference's reload_tasks_for_user)
// ---------------------------------------------------------------------------

/** Reload download tasks for the current user from the encrypted persistence file.
 *
 * Returns the number of tasks loaded.  Must be called after login (when
 * the DEK is available). */
export async function reloadTasksForUser(): Promise<number> {
  return invoke("reload_tasks_for_user");
}
