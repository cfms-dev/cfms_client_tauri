import type { DownloadTaskDto } from './api';

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
  currentBytes: number;
  totalBytes: number;
  progress: number;
}

const RUNNING_STATUSES = new Set(['downloading', 'decrypting', 'verifying']);

export function buildDownloadTaskRows(
  tasks: DownloadTaskDto[],
  expandedGroups: ReadonlySet<string>,
): DownloadTaskRow[] {
  const grouped = new Map<string, DownloadTaskDto[]>();
  const standalone: DownloadTaskDto[] = [];

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
      group: buildDownloadTaskGroup(id, groupTasks),
    })),
  ];

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

function buildDownloadTaskGroup(id: string, tasks: DownloadTaskDto[]): DownloadTaskGroup {
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

  return {
    id,
    name: sortedTasks.find((task) => task.batch_name?.trim())?.batch_name?.trim() ?? 'Folder download',
    rootId: sortedTasks.find((task) => task.batch_root_id)?.batch_root_id ?? null,
    createdAt: sortedTasks.find((task) => task.batch_created_at)?.batch_created_at ?? minCreatedAt(sortedTasks),
    tasks: sortedTasks,
    total: sortedTasks.length,
    pending: countStatus(sortedTasks, ['pending', 'scheduled']),
    running: sortedTasks.filter(isRunningDownloadTask).length,
    paused: countStatus(sortedTasks, ['paused']),
    completed: countStatus(sortedTasks, ['completed']),
    failed: countStatus(sortedTasks, ['failed']),
    cancelled: countStatus(sortedTasks, ['cancelled']),
    currentBytes,
    totalBytes,
    progress: totalBytes > 0 ? clampProgress(currentBytes / totalBytes) : averageProgress,
  };
}

function countStatus(tasks: DownloadTaskDto[], statuses: string[]) {
  const statusSet = new Set(statuses);
  return tasks.filter((task) => statusSet.has(task.status)).length;
}

function minCreatedAt(tasks: DownloadTaskDto[]) {
  return tasks.reduce((min, task) => Math.min(min, task.created_at), Number.MAX_SAFE_INTEGER);
}

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}
