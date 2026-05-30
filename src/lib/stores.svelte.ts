// CFMS Client — Svelte 5 reactive stores (runes)
//
// All application state lives here as `$state` runes.  Components import
// these and use them directly — no legacy Svelte stores needed.

import type {
  DownloadTaskDto,
  DownloadTaskStatus,
  ServiceStatusInfo,
  AuthStatus,
} from "./api";

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
  connected = $state(false);
  serverAddress = $state<string | null>(null);
  lockdown = $state(false);

  /** Returns true if the user is authenticated and has a token. */
  get isLoggedIn() {
    return this.hasToken && this.username !== null;
  }

  /** Apply a full AuthStatus snapshot from the backend. */
  apply(s: AuthStatus) {
    this.username = s.username;
    this.nickname = s.nickname;
    this.hasToken = s.has_token;
    this.tokenExp = s.token_exp;
    this.permissions = s.permissions;
    this.groups = s.groups;
    this.connected = s.connected;
    this.serverAddress = s.server_address;
    this.lockdown = s.lockdown;
  }

  /** Clear all auth state (used on logout / token expiry). */
  clear() {
    this.username = null;
    this.nickname = null;
    this.hasToken = false;
    this.tokenExp = null;
    this.permissions = [];
    this.groups = [];
    this.connected = false;
    this.serverAddress = null;
    this.lockdown = false;
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
