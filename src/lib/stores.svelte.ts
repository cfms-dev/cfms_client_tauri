// CFMS Client — Svelte 5 reactive stores (runes)
//
// All application state lives here as `$state` runes.  Components import
// these and use them directly — no legacy Svelte stores needed.

import { cancelUpload, enqueueUploadBatch, getSetting, loadUserPreference, pauseUpload, resumeUpload, setSetting } from "./api";
import type {
  DownloadTaskDto,
  DownloadTaskStatus,
  UploadTaskDto,
  UploadEnqueueRequest,
  ServiceStatusInfo,
  AuthStatus,
  ServerState,
  ServerInfo,
} from "./api";
import { TransferSpeedTracker } from "./transfer-speed";

// ---------------------------------------------------------------------------
// Server state stores
// ---------------------------------------------------------------------------

class ServerStateStoreImpl {
  remoteAddress = $state<string | null>(null);
  serverName = $state<string | null>(null);
  protocolVersion = $state<number | null>(null);
  connected = $state(false);
  lockdown = $state(false);
  lockdownReason = $state<string | null>(null);
  extensionFlags = $state<string[]>([]);

  /** Update connection-related server state.
   *
   *  Accepts raw values only — this store has no knowledge of auth types. */
  updateConnection(connected: boolean, address: string | null, lockdown: boolean) {
    this.connected = connected;
    this.remoteAddress = address;
    this.lockdown = lockdown;
  }

  /** Apply a full ServerState snapshot from the backend. */
  apply(s: ServerState) {
    this.connected = s.connected;
    this.remoteAddress = s.server_address;
    this.serverName = s.server_name ?? this.serverName;
    this.protocolVersion = s.protocol_version ?? this.protocolVersion;
    this.lockdown = s.lockdown;
    this.lockdownReason = s.lockdown_reason;
    this.extensionFlags = [...(s.extension_flags ?? [])];
  }

  /** Apply server info from the connect command response. */
  applyServerInfo(info: ServerInfo) {
    this.serverName = info.server_name;
    this.protocolVersion = info.protocol_version;
    this.lockdown = info.lockdown;
    this.lockdownReason = info.lockdown_reason;
    this.extensionFlags = [...(info.extension_flags ?? [])];
    this.connected = true;
  }

  /** Reset all server state to defaults (on disconnect). */
  clear() {
    this.remoteAddress = null;
    this.serverName = null;
    this.protocolVersion = null;
    this.connected = false;
    this.lockdown = false;
    this.lockdownReason = null;
    this.extensionFlags = [];
  }
}

export const serverStateStore = new ServerStateStoreImpl();


// ---------------------------------------------------------------------------
// Auth store
// ---------------------------------------------------------------------------

class AuthStoreImpl {
  userId = $state<string | null>(null);
  username = $state<string | null>(null);
  nickname = $state<string | null>(null);
  hasToken = $state(false);
  tokenExp = $state<number | null>(null);
  escalationExp = $state<number | null>(null);
  permissions = $state<string[]>([]);
  permissionSnapshotRevision = $state(0);
  groups = $state<string[]>([]);
  avatarPath = $state<string | null>(null);

  // 2FA state
  requires2fa = $state(false);
  authenticationMethods = $state<string[]>([]);

  // True while the login page is still running post-login initialization
  // such as preference recovery prompts and task/avatar loading.
  postLoginPending = $state(false);

  /** Returns true if the user is authenticated and has a token. */
  get isLoggedIn() {
    return this.hasToken && this.username !== null;
  }

  /** Returns true when the server has requested 2FA but it hasn't been
   *  completed yet.  Components can use this to show the 2FA dialog. */
  get isPending2FA() {
    return this.requires2fa && this.username !== null && !this.hasToken;
  }

  get displayName() {
    return this.nickname ?? this.username;
  }

  /** Apply a full AuthStatus snapshot from the backend.
   *
   *  Only handles auth-specific fields.  Server-state fields (connection status,
   *  server address, lockdown) must be applied to `serverStateStore` separately
   *  by the caller — the two stores are fully independent. */
  apply(s: AuthStatus) {
    this.userId = s.user_id;
    this.username = s.username;
    this.nickname = normalizeNickname(s.nickname, s.username);
    this.hasToken = s.has_token;
    this.tokenExp = s.token_exp;
    this.escalationExp = s.escalation_exp ?? null;
    this.permissions = s.permissions;
    this.permissionSnapshotRevision += 1;
    this.groups = s.groups;
    this.avatarPath = s.avatar_path ?? this.avatarPath;
    this.requires2fa = s.requires_2fa ?? false;
    this.authenticationMethods = s.authentication_methods ?? [];
  }

  beginPostLogin() {
    this.postLoginPending = true;
  }

  finishPostLogin() {
    this.postLoginPending = false;
  }

  /** Clear all auth state (used on logout / token expiry).
   *
   *  Server state must be cleared separately via `serverStateStore.clear()` if
   *  needed — the two stores are fully independent. */
  clear() {
    this.userId = null;
    this.username = null;
    this.nickname = null;
    this.hasToken = false;
    this.tokenExp = null;
    this.escalationExp = null;
    this.permissions = [];
    this.permissionSnapshotRevision += 1;
    this.groups = [];
    this.avatarPath = null;
    this.requires2fa = false;
    this.authenticationMethods = [];
    this.postLoginPending = false;
    downloadStore.clear();
    uploadStore.clear();
  }
}

export const authStore = new AuthStoreImpl();

function normalizeNickname(nickname: string | null, username: string | null) {
  const cleanNickname = nickname?.trim();
  if (cleanNickname) return cleanNickname;

  const cleanUsername = username?.trim();
  return cleanUsername || null;
}

// ---------------------------------------------------------------------------
// Download store
// ---------------------------------------------------------------------------

class DownloadStoreImpl {
  private removed = new Set<string>();
  clear() { this.tasks = new Map(); this.speeds = new Map(); this.removed.clear(); this.activeBadgeCount = 0; }
  tasks = $state<Map<string, DownloadTaskDto>>(new Map());
  speeds = $state<Map<string, number>>(new Map());
  private speedTracker = new TransferSpeedTracker();
  /** Number of badge-eligible tasks (mirrors _ACTIVE_BADGE_STATUSES). */
  activeBadgeCount = $state(0);

  /** Replace the entire task map (batch update from backend). */
  setAll(tasks: DownloadTaskDto[]) {
    const next = new Map<string, DownloadTaskDto>();
    for (const t of tasks) {
      if (!this.removed.has(t.task_id)) next.set(t.task_id, t);
    }
    this.tasks = next;
    const runningIds = new Set(tasks.filter((task) => task.status === "downloading").map((task) => task.task_id));
    this.speedTracker.retain(runningIds);
    this.speeds = new Map([...this.speeds].filter(([id]) => runningIds.has(id)));
  }

  /** Upsert a single task into the map. */
  upsert(task: DownloadTaskDto) {
    if (this.removed.has(task.task_id)) return;
    this.tasks.set(task.task_id, task);
    // Trigger reactivity by replacing the Map.
    this.tasks = new Map(this.tasks);
  }

  /** Remove a task from the map. */
  remove(taskId: string) {
    this.removed.add(taskId);
    this.tasks.delete(taskId);
    this.tasks = new Map(this.tasks);
    this.clearSpeed(taskId);
  }

  /** Update progress for a single task (from DownloadProgress event). */
  updateProgress(
    taskId: string,
    phase: string,
    progress: number,
    message: string,
    currentBytes: number,
    totalBytes: number,
  ) {
    const oldTask = this.tasks.get(taskId);
    if (oldTask) {
      if (
        ["completed", "failed", "cancelled", "paused"].includes(
          oldTask.status,
        )
      ) {
        return;
      }

      const newTask = { ...oldTask };

      newTask.progress = progress;
      if (currentBytes > 0) newTask.current_bytes = currentBytes;
      if (totalBytes > 0) newTask.total_bytes = totalBytes;
      newTask.message = message;

      if (phase === "downloading") newTask.status = "downloading";
      else if (phase === "decrypting") newTask.status = "decrypting";
      else if (phase === "cleaning" || phase === "verifying") newTask.status = "verifying";

      this.tasks.set(taskId, newTask);

      if (phase === "downloading") {
        const nextSpeeds = new Map(this.speeds);
        nextSpeeds.set(taskId, this.speedTracker.update(taskId, currentBytes));
        this.speeds = nextSpeeds;
      } else {
        this.clearSpeed(taskId);
      }

      this.tasks = new Map(this.tasks);
    }
  }

  /** Mark a task as completed. */
  markCompleted(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      const newTask = { ...task };

      newTask.status = "completed";
      newTask.progress = 1.0;

      this.tasks.set(taskId, newTask);
      this.tasks = new Map(this.tasks);
      this.clearSpeed(taskId);
    }
  }

  /** Mark a task as failed. */
  markFailed(taskId: string, error: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "failed";
      task.error = error;
      this.tasks = new Map(this.tasks);
      this.clearSpeed(taskId);
    }
  }

  /** Mark a task as paused. */
  markPaused(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "paused";
      this.tasks = new Map(this.tasks);
      this.clearSpeed(taskId);
    }
  }

  /** Mark a task as cancelled. */
  markCancelled(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "cancelled";
      this.tasks = new Map(this.tasks);
      this.clearSpeed(taskId);
    }
  }

  private clearSpeed(taskId: string) {
    this.speedTracker.forget(taskId);
    if (!this.speeds.has(taskId)) return;
    const nextSpeeds = new Map(this.speeds);
    nextSpeeds.delete(taskId);
    this.speeds = nextSpeeds;
  }

  // Derived views
  get activeTasks(): DownloadTaskDto[] {
    return [...this.tasks.values()].filter((t) =>
      ["pending", "scheduled", "downloading", "decrypting", "verifying"].includes(
        t.status,
      ),
    );
  }

  get completedTasks(): DownloadTaskDto[] {
    return [...this.tasks.values()].filter((t) => t.status === "completed");
  }

  get failedTasks(): DownloadTaskDto[] {
    return [...this.tasks.values()].filter((t) => t.status === "failed");
  }

  get cancelledTasks(): DownloadTaskDto[] {
    return [...this.tasks.values()].filter((t) => t.status === "cancelled");
  }

  getTasksByStatus(status: DownloadTaskStatus | "all"): DownloadTaskDto[] {
    if (status === "all") return [...this.tasks.values()];
    return [...this.tasks.values()].filter((t) => t.status === status);
  }
}

export const downloadStore = new DownloadStoreImpl();

// ---------------------------------------------------------------------------
// Upload store
// ---------------------------------------------------------------------------

const DEFAULT_TASK_CONCURRENCY = 3;
const MIN_TASK_CONCURRENCY = 1;
const MAX_TASK_CONCURRENCY = 8;

export class UploadStoreImpl {
  tasks = $state<Map<string, UploadTaskDto>>(new Map());
  maxConcurrent = $state(DEFAULT_TASK_CONCURRENCY);
  private removed = new Set<string>();
  private concurrencyScopeKey: string | null = null;

  async initConcurrency(scopeKey: string) {
    if (this.concurrencyScopeKey === scopeKey) return;
    if (this.concurrencyScopeKey !== null) this.clear();
    this.concurrencyScopeKey = scopeKey;
    try { this.configureConcurrency((await loadUserPreference()).task_concurrency?.max_uploads); }
    catch { this.configureConcurrency(DEFAULT_TASK_CONCURRENCY); }
  }

  configureConcurrency(value: number | null | undefined) { this.maxConcurrent = normalizeTaskConcurrency(value); }

  async addBatch(requests: UploadEnqueueRequest[]) {
    const result = await enqueueUploadBatch(requests);
    for (const task of result.tasks) this.applyTask(task);
    return result;
  }

  setAll(tasks: UploadTaskDto[]) {
    // Events can arrive while an IPC snapshot is in flight. Keep newer revisions.
    for (const task of tasks) this.applyTask(task);
  }

  applyTask(task: UploadTaskDto) {
    if (this.removed.has(task.upload_id)) return false;
    const old = this.tasks.get(task.upload_id);
    if (old && (old.revision ?? 0) > (task.revision ?? 0)) return false;
    this.tasks = new Map(this.tasks).set(task.upload_id, task);
    return true;
  }

  async pause(id: string) { return pauseUpload(id); }
  async resume(id: string) { return resumeUpload(id); }
  async cancel(id: string) { return cancelUpload(id); }

  remove(id: string) {
    this.removed.add(id);
    const next = new Map(this.tasks);
    next.delete(id);
    this.tasks = next;
  }

  clear() { this.tasks = new Map(); this.removed.clear(); }
  get allTasks() { return [...this.tasks.values()].sort((a, b) => b.created_at - a.created_at); }
  get activeTasks() { return this.allTasks.filter(t => ['pending', 'uploading'].includes(t.status)); }
  get pausedTasks() { return this.allTasks.filter(t => t.status === 'paused'); }
  get completedTasks() { return this.allTasks.filter(t => ['completed', 'skipped'].includes(t.status)); }
  get failedTasks() { return this.allTasks.filter(t => ['failed', 'interrupted'].includes(t.status)); }
  get cancelledTasks() { return this.allTasks.filter(t => t.status === 'cancelled'); }
}

export const uploadStore = new UploadStoreImpl();

function formatStoreError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeTaskConcurrency(value: number | null | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_TASK_CONCURRENCY;
  return Math.min(
    MAX_TASK_CONCURRENCY,
    Math.max(MIN_TASK_CONCURRENCY, Math.trunc(value ?? DEFAULT_TASK_CONCURRENCY)),
  );
}

// ---------------------------------------------------------------------------
// Service status store
// ---------------------------------------------------------------------------

class ServiceStatusStoreImpl {
  services = $state<ServiceStatusInfo[]>([]);

  setAll(services: ServiceStatusInfo[]) {
    this.services = services;
  }
}

export const serviceStatusStore = new ServiceStatusStoreImpl();

// ---------------------------------------------------------------------------
// Shared UI chrome measurements
// ---------------------------------------------------------------------------

class ChromeStoreImpl {
  snackbarStackHeight = $state(0);

  setSnackbarStackHeight(height: number) {
    this.snackbarStackHeight = Math.max(0, Math.round(height));
  }
}

export const chromeStore = new ChromeStoreImpl();

// ---------------------------------------------------------------------------
// Event log (last N events for the dashboard activity feed)
// ---------------------------------------------------------------------------

class EventLogImpl {
  entries = $state<Array<{ time: Date; text: string; type: string }>>([]);

  push(type: string, text: string) {
    this.entries = [
      { time: new Date(), text, type },
      ...this.entries.slice(0, 49),
    ];
  }
}

export const eventLog = new EventLogImpl();

// ---------------------------------------------------------------------------
// File shortcut validation state
// ---------------------------------------------------------------------------

export interface FileShortcutValidationPayload {
  invalid_files?: string[];
  invalid_directories?: string[];
  access_denied_files?: string[];
  access_denied_directories?: string[];
}

class FileShortcutValidationStoreImpl {
  invalidFiles = $state<Set<string>>(new Set());
  invalidDirectories = $state<Set<string>>(new Set());
  accessDeniedFiles = $state<Set<string>>(new Set());
  accessDeniedDirectories = $state<Set<string>>(new Set());

  apply(payload: FileShortcutValidationPayload) {
    this.invalidFiles = new Set(payload.invalid_files ?? []);
    this.invalidDirectories = new Set(payload.invalid_directories ?? []);
    this.accessDeniedFiles = new Set(payload.access_denied_files ?? []);
    this.accessDeniedDirectories = new Set(payload.access_denied_directories ?? []);
  }

  markUnavailable(type: 'document' | 'directory', id: string) {
    if (type === 'document') {
      this.invalidFiles = new Set([...this.invalidFiles, id]);
      this.accessDeniedFiles = withoutValue(this.accessDeniedFiles, id);
    } else {
      this.invalidDirectories = new Set([...this.invalidDirectories, id]);
      this.accessDeniedDirectories = withoutValue(this.accessDeniedDirectories, id);
    }
  }

  isUnavailable(type: 'document' | 'directory', id: string) {
    return type === 'document'
      ? this.invalidFiles.has(id) || this.accessDeniedFiles.has(id)
      : this.invalidDirectories.has(id) || this.accessDeniedDirectories.has(id);
  }
}

function withoutValue(values: Set<string>, value: string) {
  const next = new Set(values);
  next.delete(value);
  return next;
}

export const fileShortcutValidationStore = new FileShortcutValidationStoreImpl();

// ---------------------------------------------------------------------------
// Floating progress notifications
// ---------------------------------------------------------------------------

export interface FloatingProgressEntry {
  id: string;
  title: string;
  text: string;
  current: number;
  total: number;
  createdAt: number;
}

class FloatingProgressStoreImpl {
  entries = $state<FloatingProgressEntry[]>([]);

  upsert(id: string, title: string, text: string, current: number, total: number) {
    const existing = this.entries.find((entry) => entry.id === id);
    const next: FloatingProgressEntry = {
      id,
      title,
      text,
      current,
      total,
      createdAt: existing?.createdAt ?? Date.now(),
    };

    this.entries = [
      next,
      ...this.entries.filter((entry) => entry.id !== id),
    ];
  }

  remove(id: string) {
    this.entries = this.entries.filter((entry) => entry.id !== id);
  }

  clear() {
    this.entries = [];
  }
}

export const floatingProgressStore = new FloatingProgressStoreImpl();

// ---------------------------------------------------------------------------
// Floating notifications / SnackBars
// ---------------------------------------------------------------------------

export type NotificationType = "info" | "success" | "warning" | "error";

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface NotificationEntry {
  id: number;
  type: NotificationType;
  text: string;
  createdAt: number;
  timeoutMs: number | null;
  groupKey?: string;
  groupTitle?: string;
  action?: NotificationAction;
  items: Array<{ text: string; createdAt: number }>;
}

export interface NotificationOptions {
  groupKey?: string;
  groupTitle?: string;
  action?: NotificationAction;
  itemText?: string;
  summaryText?: (count: number, latestText: string) => string;
}

class NotificationStoreImpl {
  entries = $state<NotificationEntry[]>([]);
  private nextId = 1;

  push(
    type: NotificationType,
    text: string,
    timeoutMs = 7000,
    options: NotificationOptions = {},
  ) {
    if (options.groupKey) {
      const existing = this.entries.find(
        (entry) => entry.groupKey === options.groupKey && entry.type === type,
      );
      if (existing) {
        const now = Date.now();
        const itemText = options.itemText ?? text;
        const items = [...existing.items, { text: itemText, createdAt: now }].slice(-20);
        const next: NotificationEntry = {
          ...existing,
          text: options.summaryText?.(items.length, itemText) ?? text,
          groupTitle: options.groupTitle ?? existing.groupTitle,
          action: options.action ?? existing.action,
          items,
          createdAt: now,
          timeoutMs: timeoutMs > 0 ? timeoutMs : null,
        };
        this.entries = [next, ...this.entries.filter((entry) => entry.id !== existing.id)];
        return existing.id;
      }
    }

    const entry: NotificationEntry = {
      id: this.nextId++,
      type,
      text,
      createdAt: Date.now(),
      timeoutMs: timeoutMs > 0 ? timeoutMs : null,
      groupKey: options.groupKey,
      groupTitle: options.groupTitle,
      action: options.action,
      items: [{ text: options.itemText ?? text, createdAt: Date.now() }],
    };
    this.entries = [entry, ...this.entries].slice(0, 5);
    return entry.id;
  }

  info(text: string, timeoutMs = 7000, options?: NotificationOptions) {
    return this.push("info", text, timeoutMs, options);
  }

  success(text: string, timeoutMs = 7000, options?: NotificationOptions) {
    return this.push("success", text, timeoutMs, options);
  }

  warning(text: string, timeoutMs = 7000, options?: NotificationOptions) {
    return this.push("warning", text, timeoutMs, options);
  }

  error(text: string, timeoutMs = 7000, options?: NotificationOptions) {
    return this.push("error", text, timeoutMs, options);
  }

  remove(id: number) {
    this.entries = this.entries.filter((entry) => entry.id !== id);
  }

  clear() {
    this.entries = [];
  }
}

export const notificationStore = new NotificationStoreImpl();

// ---------------------------------------------------------------------------
// Disclaimer store
// ---------------------------------------------------------------------------

class DisclaimerStoreImpl {
  accepted = $state(false);
  checked = $state(false);

  /** Check whether the user has accepted the disclaimer. */
  async init() {
    try {
      const val = await getSetting('disclaimer_accepted');
      this.accepted = val === 'true';
    } catch {
      this.accepted = false;
    }
    this.checked = true;
  }

  /** Persist the accept action and update state. */
  async accept() {
    await setSetting('disclaimer_accepted', 'true');
    this.accepted = true;
  }
}

export const disclaimerStore = new DisclaimerStoreImpl();
