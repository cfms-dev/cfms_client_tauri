import type { DownloadTaskDto, DownloadTaskStatus } from "$lib/api/types";
import { TransferSpeedTracker } from "$lib/features/transfers/transfer-speed";

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
