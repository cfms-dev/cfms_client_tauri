// CFMS Client — Svelte 5 reactive stores (runes)
//
// All application state lives here as `$state` runes.  Components import
// these and use them directly — no legacy Svelte stores needed.

import { cancelUpload, getSetting, pauseUpload, resumeUpload, setSetting } from "./api";
import type {
  DownloadTaskDto,
  DownloadTaskStatus,
  UploadProgressEvent,
  UploadTaskDto,
  ServiceStatusInfo,
  AuthStatus,
  ServerState,
  ServerInfo,
} from "./api";

// ---------------------------------------------------------------------------
// Server state stores
// ---------------------------------------------------------------------------

class ServerStateStoreImpl {
  remoteAddress = $state<string | null>(null);
  serverName = $state<string | null>(null);
  protocolVersion = $state<number | null>(null);
  connected = $state(false);
  lockdown = $state(false);

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
  }

  /** Apply server info from the connect command response. */
  applyServerInfo(info: ServerInfo) {
    this.serverName = info.server_name;
    this.protocolVersion = info.protocol_version;
    this.lockdown = info.lockdown;
    this.connected = true;
  }

  /** Reset all server state to defaults (on disconnect). */
  clear() {
    this.remoteAddress = null;
    this.serverName = null;
    this.protocolVersion = null;
    this.connected = false;
    this.lockdown = false;
  }
}

export const serverStateStore = new ServerStateStoreImpl();


// ---------------------------------------------------------------------------
// Auth store
// ---------------------------------------------------------------------------

class AuthStoreImpl {
  username = $state<string | null>(null);
  nickname = $state<string | null>(null);
  hasToken = $state(false);
  tokenExp = $state<number | null>(null);
  permissions = $state<string[]>([]);
  groups = $state<string[]>([]);
  avatarPath = $state<string | null>(null);

  // 2FA state
  requires2fa = $state(false);
  twofaMethod = $state<string>('totp');

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
    this.username = s.username;
    this.nickname = normalizeNickname(s.nickname, s.username);
    this.hasToken = s.has_token;
    this.tokenExp = s.token_exp;
    this.permissions = s.permissions;
    this.groups = s.groups;
    this.avatarPath = s.avatar_path ?? this.avatarPath;
    this.requires2fa = s.requires_2fa ?? false;
    this.twofaMethod = s['2fa_method'] ?? 'totp';
  }

  /** Clear all auth state (used on logout / token expiry).
   *
   *  Server state must be cleared separately via `serverStateStore.clear()` if
   *  needed — the two stores are fully independent. */
  clear() {
    this.username = null;
    this.nickname = null;
    this.hasToken = false;
    this.tokenExp = null;
    this.permissions = [];
    this.groups = [];
    this.avatarPath = null;
    this.requires2fa = false;
    this.twofaMethod = 'totp';
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
  tasks = $state<Map<string, DownloadTaskDto>>(new Map());
  /** Number of badge-eligible tasks (mirrors _ACTIVE_BADGE_STATUSES). */
  activeBadgeCount = $state(0);

  /** Replace the entire task map (batch update from backend). */
  setAll(tasks: DownloadTaskDto[]) {
    const next = new Map<string, DownloadTaskDto>();
    for (const t of tasks) {
      next.set(t.task_id, t);
    }
    this.tasks = next;
  }

  /** Upsert a single task into the map. */
  upsert(task: DownloadTaskDto) {
    this.tasks.set(task.task_id, task);
    // Trigger reactivity by replacing the Map.
    this.tasks = new Map(this.tasks);
  }

  /** Remove a task from the map. */
  remove(taskId: string) {
    this.tasks.delete(taskId);
    this.tasks = new Map(this.tasks);
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
      else if (phase === "verifying") newTask.status = "verifying";

      this.tasks.set(taskId, newTask);

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
    }
  }

  /** Mark a task as failed. */
  markFailed(taskId: string, error: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "failed";
      task.error = error;
      this.tasks = new Map(this.tasks);
    }
  }

  /** Mark a task as cancelled. */
  markCancelled(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "cancelled";
      this.tasks = new Map(this.tasks);
    }
  }

  // Derived views
  get activeTasks(): DownloadTaskDto[] {
    return [...this.tasks.values()].filter((t) =>
      ["pending", "downloading", "decrypting", "verifying"].includes(
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

class UploadStoreImpl {
  tasks = $state<Map<string, UploadTaskDto>>(new Map());
  private runners = new Map<string, (uploadId: string) => Promise<unknown>>();
  private completionCallbacks = new Map<string, () => Promise<void> | void>();
  private processing = false;

  addQueued(
    uploadId: string,
    fileName: string,
    sourcePath: string,
    runner?: (uploadId: string) => Promise<unknown>,
    onCompleted?: () => Promise<void> | void,
  ) {
    const now = Math.floor(Date.now() / 1000);
    this.tasks.set(uploadId, {
      upload_id: uploadId,
      task_id: null,
      file_name: fileName,
      source_path: sourcePath,
      status: "pending",
      progress: 0,
      current_bytes: 0,
      total_bytes: 0,
      message: null,
      error: null,
      created_at: now,
      completed_at: null,
    });
    if (runner) this.runners.set(uploadId, runner);
    if (onCompleted) this.completionCallbacks.set(uploadId, onCompleted);
    this.tasks = new Map(this.tasks);
    void this.processQueue();
  }

  async pause(uploadId: string) {
    const task = this.tasks.get(uploadId);
    if (!task || ["completed", "failed", "cancelled", "skipped"].includes(task.status)) return;

    if (task.status === "uploading") {
      const interrupted = await pauseUpload(uploadId);
      if (interrupted) return;
    }

    this.setStatus(uploadId, "paused", "Upload paused");
  }

  async resume(uploadId: string) {
    const task = this.tasks.get(uploadId);
    if (!task || task.status !== "paused") return;
    await resumeUpload(uploadId);
    this.tasks.set(uploadId, {
      ...task,
      status: "pending",
      message: null,
      error: null,
      completed_at: null,
    });
    this.tasks = new Map(this.tasks);
    void this.processQueue();
  }

  async cancel(uploadId: string) {
    const task = this.tasks.get(uploadId);
    if (!task || ["completed", "failed", "cancelled", "skipped"].includes(task.status)) return;

    if (task.status === "uploading") {
      const interrupted = await cancelUpload(uploadId);
      if (interrupted) return;
    }

    this.setStatus(uploadId, "cancelled", "Upload cancelled", true);
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const next = [...this.tasks.values()]
          .sort((a, b) => a.created_at - b.created_at)
          .find((task) => task.status === "pending" && this.runners.has(task.upload_id));
        if (!next) break;

        this.tasks.set(next.upload_id, {
          ...next,
          status: "uploading",
          message: next.message ?? "Preparing upload",
          error: null,
          completed_at: null,
        });
        this.tasks = new Map(this.tasks);

        try {
          await this.runners.get(next.upload_id)?.(next.upload_id);
          const current = this.tasks.get(next.upload_id);
          if (current && current.status === "uploading") {
            this.tasks.set(next.upload_id, {
              ...current,
              status: "completed",
              progress: 1,
              current_bytes: current.total_bytes || current.current_bytes || 1,
              total_bytes: current.total_bytes || current.current_bytes || 1,
              message: "Upload completed",
              completed_at: Math.floor(Date.now() / 1000),
            });
            this.tasks = new Map(this.tasks);
          }

          const after = this.completionCallbacks.get(next.upload_id);
          const finished = this.tasks.get(next.upload_id);
          if (after && finished && ["completed", "skipped"].includes(finished.status)) {
            await after();
          }
        } catch (err) {
          const current = this.tasks.get(next.upload_id);
          if (!current || ["paused", "cancelled", "failed"].includes(current.status)) {
            continue;
          }
          this.markFailed(next.upload_id, formatStoreError(err));
        }
      }
    } finally {
      this.processing = false;
    }
  }

  applyProgress(event: UploadProgressEvent) {
    const oldTask = this.tasks.get(event.upload_id);
    const terminal = event.status === "completed"
      || event.status === "failed"
      || event.status === "skipped"
      || event.status === "cancelled";
    const next: UploadTaskDto = {
      upload_id: event.upload_id,
      task_id: event.task_id,
      file_name: event.file_name,
      source_path: oldTask?.source_path ?? "",
      status: event.status,
      progress:
        event.total_bytes === 0 && (event.status === "paused" || event.status === "cancelled")
          ? (oldTask?.progress ?? event.progress)
          : event.progress,
      current_bytes: event.current_bytes || oldTask?.current_bytes || 0,
      total_bytes: event.total_bytes || oldTask?.total_bytes || 0,
      message: event.message,
      error: event.status === "failed" ? event.message : null,
      created_at: oldTask?.created_at ?? Math.floor(Date.now() / 1000),
      completed_at: terminal ? Math.floor(Date.now() / 1000) : null,
    };
    this.tasks.set(event.upload_id, next);
    this.tasks = new Map(this.tasks);
  }

  markFailed(uploadId: string, error: string) {
    const task = this.tasks.get(uploadId);
    if (!task) return;
    this.tasks.set(uploadId, {
      ...task,
      status: "failed",
      error,
      message: error,
      completed_at: Math.floor(Date.now() / 1000),
    });
    this.tasks = new Map(this.tasks);
  }

  remove(uploadId: string) {
    this.tasks.delete(uploadId);
    this.runners.delete(uploadId);
    this.completionCallbacks.delete(uploadId);
    this.tasks = new Map(this.tasks);
  }

  clearFinished() {
    this.clearTerminalByStatus(["completed", "failed", "cancelled", "skipped"]);
  }

  clearCompletedAndCancelled() {
    this.clearTerminalByStatus(["completed", "cancelled", "skipped"]);
  }

  clearFailedAndCancelled() {
    this.clearTerminalByStatus(["failed", "cancelled", "skipped"]);
  }

  private clearTerminalByStatus(statuses: UploadTaskDto["status"][]) {
    const toClear = new Set(statuses);
    for (const task of this.allTasks) {
      if (toClear.has(task.status)) {
        this.runners.delete(task.upload_id);
        this.completionCallbacks.delete(task.upload_id);
      }
    }
    this.tasks = new Map(
      [...this.tasks].filter(([, task]) =>
        !toClear.has(task.status)
      ),
    );
  }

  get allTasks(): UploadTaskDto[] {
    return [...this.tasks.values()].sort((a, b) => b.created_at - a.created_at);
  }

  get activeTasks(): UploadTaskDto[] {
    return this.allTasks.filter((task) => task.status === "pending" || task.status === "uploading");
  }

  get pausedTasks(): UploadTaskDto[] {
    return this.allTasks.filter((task) => task.status === "paused");
  }

  get completedTasks(): UploadTaskDto[] {
    return this.allTasks.filter((task) => task.status === "completed" || task.status === "skipped");
  }

  get failedTasks(): UploadTaskDto[] {
    return this.allTasks.filter((task) => task.status === "failed");
  }

  get cancelledTasks(): UploadTaskDto[] {
    return this.allTasks.filter((task) => task.status === "cancelled");
  }

  private setStatus(
    uploadId: string,
    status: UploadTaskDto["status"],
    message: string,
    complete = false,
  ) {
    const task = this.tasks.get(uploadId);
    if (!task) return;
    this.tasks.set(uploadId, {
      ...task,
      status,
      message,
      error: status === "failed" ? message : task.error,
      completed_at: complete ? Math.floor(Date.now() / 1000) : null,
    });
    this.tasks = new Map(this.tasks);
  }
}

export const uploadStore = new UploadStoreImpl();

function formatStoreError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

export interface NotificationEntry {
  id: number;
  type: NotificationType;
  text: string;
  createdAt: number;
  timeoutMs: number | null;
  groupKey?: string;
  groupTitle?: string;
  items: Array<{ text: string; createdAt: number }>;
}

export interface NotificationOptions {
  groupKey?: string;
  groupTitle?: string;
  itemText?: string;
  summaryText?: (count: number, latestText: string) => string;
}

class NotificationStoreImpl {
  entries = $state<NotificationEntry[]>([]);
  private nextId = 1;

  push(
    type: NotificationType,
    text: string,
    timeoutMs = 3000,
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
      items: [{ text: options.itemText ?? text, createdAt: Date.now() }],
    };
    this.entries = [entry, ...this.entries].slice(0, 5);
    return entry.id;
  }

  info(text: string, timeoutMs = 3000, options?: NotificationOptions) {
    return this.push("info", text, timeoutMs, options);
  }

  success(text: string, timeoutMs = 3000, options?: NotificationOptions) {
    return this.push("success", text, timeoutMs, options);
  }

  warning(text: string, timeoutMs = 3000, options?: NotificationOptions) {
    return this.push("warning", text, timeoutMs, options);
  }

  error(text: string, timeoutMs = 3000, options?: NotificationOptions) {
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
