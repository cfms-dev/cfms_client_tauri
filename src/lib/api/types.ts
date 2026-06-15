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
  /** True when the current login response included a server-side encrypted preference DEK. */
  has_server_preference_dek?: boolean;
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
  remember_connection_addresses: boolean;
  recent_connection_addresses: string[];
}

export interface CaCertificateStatus {
  caDir: string;
  certificateCount: number;
  lastChecked: number | null;
}

export interface CaCertificateUpdateResult {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  errors: string[];
  lastChecked: number | null;
}

export interface AndroidPasskeyAvailability {
  available: boolean;
  webViewWebAuthn: boolean;
}

export interface AndroidPasskeyRegistration {
  id: string;
  registrationResponseJson: string;
}

export interface AndroidPasskeyAssertion {
  id: string;
  authenticationResponseJson: string;
}

export interface FileShortcutValidationResult {
  invalid_count: number;
  invalid_files: string[];
  invalid_directories: string[];
  access_denied_files: string[];
  access_denied_directories: string[];
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// User preference types
// ---------------------------------------------------------------------------

/** Per-user application preferences stored as an encrypted file.
 *
 *  Mirrors the Python `UserPreference` dataclass. */
export interface UserPreference {
  theme: string;
  favourites: Favourites;
  recent_visits: RecentVisitPreferenceRecord[];
  record_recent_visits: boolean;
  use_external_storage: boolean;
  external_storage_path: string;
  app_lock?: unknown;
  root_back_button_behavior?: "background" | "exit" | null;
  screenshot_protection_enabled?: boolean;
  task_concurrency: TaskConcurrencyPreference;
}

export interface TaskConcurrencyPreference {
  max_downloads: number;
  max_uploads: number;
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
