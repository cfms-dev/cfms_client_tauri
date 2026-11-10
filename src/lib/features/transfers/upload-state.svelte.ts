import { cancelUpload, enqueueUploadBatch, loadUserPreference, pauseUpload, resumeUpload } from "$lib/api";
import type { UploadTaskDto, UploadEnqueueRequest } from "$lib/api/types";

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

function normalizeTaskConcurrency(value: number | null | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_TASK_CONCURRENCY;
  return Math.min(
    MAX_TASK_CONCURRENCY,
    Math.max(MIN_TASK_CONCURRENCY, Math.trunc(value ?? DEFAULT_TASK_CONCURRENCY)),
  );
}
