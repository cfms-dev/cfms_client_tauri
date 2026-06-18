import type { DownloadTaskDto } from './api';
import type { DownloadBatchSnapshot } from './download-batch-control';

export type DownloadTaskRow =
  | { kind: 'task'; task: DownloadTaskDto }
  | { kind: 'group'; group: DownloadTaskGroup }
  | { kind: 'group-task'; group: DownloadTaskGroup; task: DownloadTaskDto };

export interface DownloadTaskGroup {
  id: string;
  name: string;
  rootId: string | null;
  createdAt: number;
  tasks: DownloadTaskDto[];
  total: number;
  pending: number;
  running: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
  discovered: number;
  queued: number;
  currentBytes: number;
  totalBytes: number;
  progress: number;
  progressKnown: boolean;
  preparing: boolean;
  phase: DownloadBatchSnapshot['phase'] | null;
}

const RUNNING_STATUSES = new Set(['downloading', 'decrypting', 'verifying']);
const BATCH_FILE_DELETE_STATUSES = new Set(['completed', 'cancelled']);

export function buildDownloadTaskRows(
  tasks: DownloadTaskDto[],
  expandedGroups: ReadonlySet<string>,
  activeBatches: DownloadBatchSnapshot[] = [],
): DownloadTaskRow[] {
  const grouped = new Map<string, DownloadTaskDto[]>();
  const standalone: DownloadTaskDto[] = [];
  const activeBatchMap = new Map(activeBatches.map((batch) => [batch.batchId, batch]));

  for (const task of tasks) {
    const batchId = task.batch_id?.trim();
    if (!batchId) {
      standalone.push(task);
      continue;
    }

    const groupTasks = grouped.get(batchId) ?? [];
    groupTasks.push(task);
    grouped.set(batchId, groupTasks);
  }

  const entries: Array<{ kind: 'task'; task: DownloadTaskDto } | { kind: 'group'; group: DownloadTaskGroup }> = [
    ...standalone.map((task) => ({ kind: 'task' as const, task })),
    ...[...grouped.entries()].map(([id, groupTasks]) => ({
      kind: 'group' as const,
      group: buildDownloadTaskGroup(id, groupTasks, activeBatchMap.get(id)),
    })),
  ];

  for (const batch of activeBatches) {
    if (grouped.has(batch.batchId)) continue;
    entries.push({
      kind: 'group',
      group: buildDownloadTaskGroup(batch.batchId, [], batch),
    });
  }

  entries.sort((a, b) => {
    const aRunning = a.kind === 'group' ? a.group.running > 0 : isRunningDownloadTask(a.task);
    const bRunning = b.kind === 'group' ? b.group.running > 0 : isRunningDownloadTask(b.task);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;

    const aCreated = a.kind === 'group' ? a.group.createdAt : a.task.created_at;
    const bCreated = b.kind === 'group' ? b.group.createdAt : b.task.created_at;
    return bCreated - aCreated;
  });

  const rows: DownloadTaskRow[] = [];
  for (const entry of entries) {
    if (entry.kind === 'task') {
      rows.push(entry);
      continue;
    }

    rows.push(entry);
    if (expandedGroups.has(entry.group.id)) {
      for (const task of entry.group.tasks) {
        rows.push({ kind: 'group-task', group: entry.group, task });
      }
    }
  }

  return rows;
}

export function isRunningDownloadTask(task: DownloadTaskDto) {
  return RUNNING_STATUSES.has(task.status);
}

export function canDeleteDownloadTaskGroupFiles(group: DownloadTaskGroup) {
  return group.tasks.length > 0
    && !group.preparing
    && group.tasks.every((task) => BATCH_FILE_DELETE_STATUSES.has(task.status));
}

function buildDownloadTaskGroup(
  id: string,
  tasks: DownloadTaskDto[],
  activeBatch?: DownloadBatchSnapshot,
): DownloadTaskGroup {
  const sortedTasks = [...tasks].sort((a, b) => {
    const aRunning = isRunningDownloadTask(a);
    const bRunning = isRunningDownloadTask(b);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return b.created_at - a.created_at;
  });

  const totalBytes = sortedTasks.reduce((sum, task) => sum + Math.max(0, task.total_bytes), 0);
  const currentBytes = sortedTasks.reduce((sum, task) => sum + Math.max(0, task.current_bytes), 0);
  const averageProgress = sortedTasks.length === 0
    ? 0
    : sortedTasks.reduce((sum, task) => sum + clampProgress(task.progress), 0) / sortedTasks.length;

  const completed = countStatus(sortedTasks, ['completed']);
  const failed = countStatus(sortedTasks, ['failed']);
  const cancelled = countStatus(sortedTasks, ['cancelled']);
  const estimatedTotal = maxEstimatedTotal(sortedTasks);
  const isBatchGroup = Boolean(activeBatch || sortedTasks.some((task) => task.batch_id?.trim()));
  const total = Math.max(sortedTasks.length, estimatedTotal, activeBatch?.discovered ?? 0, activeBatch?.queued ?? 0);
  const progressKnown = !activeBatch || total > 0;
  const progress = isBatchGroup
    ? (total > 0 ? completed / total : 0)
    : (totalBytes > 0 ? currentBytes / totalBytes : averageProgress);

  return {
    id,
    name: activeBatch?.batchName ?? sortedTasks.find((task) => task.batch_name?.trim())?.batch_name?.trim() ?? 'Folder download',
    rootId: activeBatch?.batchRootId ?? sortedTasks.find((task) => task.batch_root_id)?.batch_root_id ?? null,
    createdAt: activeBatch?.batchCreatedAt ?? sortedTasks.find((task) => task.batch_created_at)?.batch_created_at ?? minCreatedAt(sortedTasks),
    tasks: sortedTasks,
    total,
    pending: countStatus(sortedTasks, ['pending', 'scheduled']),
    running: sortedTasks.filter(isRunningDownloadTask).length,
    paused: countStatus(sortedTasks, ['paused']),
    completed,
    failed,
    cancelled,
    discovered: activeBatch?.discovered ?? sortedTasks.length,
    queued: activeBatch?.queued ?? sortedTasks.length,
    currentBytes,
    totalBytes,
    progress: clampProgress(progress),
    progressKnown,
    preparing: Boolean(activeBatch),
    phase: activeBatch?.phase ?? null,
  };
}

function countStatus(tasks: DownloadTaskDto[], statuses: string[]) {
  const statusSet = new Set(statuses);
  return tasks.filter((task) => statusSet.has(task.status)).length;
}

function maxEstimatedTotal(tasks: DownloadTaskDto[]) {
  return tasks.reduce((max, task) => Math.max(max, task.batch_estimated_total ?? 0), 0);
}

function minCreatedAt(tasks: DownloadTaskDto[]) {
  return tasks.reduce((min, task) => Math.min(min, task.created_at), Number.MAX_SAFE_INTEGER);
}

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}
