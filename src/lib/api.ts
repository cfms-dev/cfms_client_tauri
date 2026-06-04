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
  error: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  priority: number;
  retry_count: number;
  max_retries: number;
  scheduled_time: number | null;
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

/** Response data for the list_directory server action. */
export interface ListDirectoryResponse {
  folders: ServerDirectoryEntry[];
  documents: ServerDocumentEntry[];
  parent_id: string | null;
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
  current: number;
  total: number;
}

export interface UploadProgress {
  current: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Service Events (tagged union — cfms_core::ServiceEvent)
// ---------------------------------------------------------------------------

export type ServiceEvent =
  | { event: "DownloadProgress"; data: { task_id: string; phase: string; current: number; total: number } }
  | { event: "DownloadCompleted"; data: { task_id: string; file_path: string } }
  | { event: "DownloadFailed"; data: { task_id: string; error: string } }
  | { event: "DownloadCancelled"; data: { task_id: string } }
  | { event: "Lockdown"; data: { status: boolean } }
  | { event: "TokenExpired" }
  | { event: "FavoritesValidationComplete"; data: { invalid_count: number } };

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

/** Metadata returned by the connect command after a successful server_info
 *  handshake.  Mirrors cfms_core::ServerInfo on the Rust side. */
export interface ServerInfo {
  server_name: string;
  protocol_version: number;
  lockdown: boolean;
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
  return invoke("create_directory", { parentId, name, existsOk: existsOk ?? false });
}

/** Delete a directory on the CFMS server. */
export async function deleteDirectory(folderId: string): Promise<boolean> {
  return invoke("delete_directory", { folderId });
}

/** Delete a document on the CFMS server. */
export async function deleteDocument(documentId: string): Promise<boolean> {
  return invoke("delete_document", { documentId });
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
  use_external_storage: boolean;
  external_storage_path: string;
}

export interface Favourites {
  files: Record<string, string>;
  directories: Record<string, string>;
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

/** Signal that the download task list should be refreshed for the current user. */
export async function reloadTasksForUser(): Promise<void> {
  return invoke("reload_tasks_for_user");
}
