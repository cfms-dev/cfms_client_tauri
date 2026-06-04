// CFMS Client — Svelte 5 reactive stores (runes)
//
// All application state lives here as `$state` runes.  Components import
// these and use them directly — no legacy Svelte stores needed.

import { getSetting, setSetting } from "./api";
import type {
  DownloadTaskDto,
  DownloadTaskStatus,
  ServiceStatusInfo,
  AuthStatus,
  ServerState,
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
    this.lockdown = s.lockdown;
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

  /** Apply a full AuthStatus snapshot from the backend.
   *
   *  Only handles auth-specific fields.  Server-state fields (connection status,
   *  server address, lockdown) must be applied to `serverStateStore` separately
   *  by the caller — the two stores are fully independent. */
  apply(s: AuthStatus) {
    this.username = s.username;
    this.nickname = s.nickname;
    this.hasToken = s.has_token;
    this.tokenExp = s.token_exp;
    this.permissions = s.permissions;
    this.groups = s.groups;
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
    this.requires2fa = false;
    this.twofaMethod = 'totp';
  }
}

export const authStore = new AuthStoreImpl();

// ---------------------------------------------------------------------------
// Download store
// ---------------------------------------------------------------------------

class DownloadStoreImpl {
  tasks = $state<Map<string, DownloadTaskDto>>(new Map());

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
  updateProgress(taskId: string, phase: string, current: number, total: number) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.current_bytes = current;
      task.total_bytes = total;
      task.progress = total > 0 ? current / total : 0;
      if (phase === "downloading") task.status = "downloading";
      else if (phase === "decrypting") task.status = "decrypting";
      else if (phase === "verifying") task.status = "verifying";
      this.tasks = new Map(this.tasks);
    }
  }

  /** Mark a task as completed. */
  markCompleted(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = "completed";
      task.progress = 1.0;
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
      ["pending", "downloading", "decrypting", "verifying", "paused"].includes(
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

  getTasksByStatus(status: DownloadTaskStatus | "all"): DownloadTaskDto[] {
    if (status === "all") return [...this.tasks.values()];
    return [...this.tasks.values()].filter((t) => t.status === status);
  }
}

export const downloadStore = new DownloadStoreImpl();

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
