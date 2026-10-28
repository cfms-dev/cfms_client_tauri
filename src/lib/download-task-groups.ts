import type { DownloadTaskDto } from './api';
import { serverAvailability } from './api/server-errors';
import type { DownloadBatchSnapshot } from './download-batch-control';
import {
  TRANSFER_SECTION_ORDER, compareTransferEntries, compareTransferIds, isTransferInProgress, downloadSection, matchesTransferQuery, type TransferSectionKey,
} from './transfer-task-view';

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
  scheduled: number;
  rateLimited: number;
  queueRateLimited: number;
  rateLimitWaiting: boolean;
  running: number;
  paused: number;
  completed: number;
  deleted: number;
  failed: number;
  cancelled: number;
  discovered: number;
  queued: number;
  currentBytes: number;
  totalBytes: number;
  progress: number;
  progressKnown: boolean;
  preparing: boolean;
  batchPaused: boolean;
  phase: DownloadBatchSnapshot['phase'] | null;
}

export interface DownloadTaskSection {
  section: TransferSectionKey;
  count: number;
  rows: DownloadTaskRow[];
}

const RUNNING_STATUSES = new Set(['downloading', 'decrypting', 'verifying']);
const TERMINAL_DOWNLOAD_STATUSES = new Set(['completed', 'deleted', 'failed', 'cancelled']);

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

  const sortKey = (entry: typeof entries[number]) => entry.kind === 'group'
    ? { id: entry.group.id, createdAt: entry.group.createdAt,
      active: (entry.group.preparing && !entry.group.batchPaused) || entry.group.tasks.some(isTransferInProgress) }
    : { id: entry.task.task_id, createdAt: entry.task.created_at, active: isTransferInProgress(entry.task) };
  const sorted = entries.map(entry => ({ entry, ...sortKey(entry) })).sort(compareTransferEntries);

  const rows: DownloadTaskRow[] = [];
  for (const { entry } of sorted) {
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

export function buildDownloadTaskSections(
  tasks: DownloadTaskDto[],
  expandedGroups: ReadonlySet<string>,
  activeBatches: DownloadBatchSnapshot[] = [],
  query = '',
): DownloadTaskSection[] {
  const sections = new Map<TransferSectionKey, DownloadTaskSection>(
    TRANSFER_SECTION_ORDER.map((section) => [section, { section, count: 0, rows: [] }]),
  );
  const groupSections = new Map<string, TransferSectionKey>();

  const taskRows = buildDownloadTaskRows(tasks, expandedGroups, activeBatches);
  for (const row of filterDownloadTaskRows(taskRows, query)) {
    let section: TransferSectionKey;
    if (row.kind === 'group') {
      section = downloadTaskGroupSection(row.group);
      groupSections.set(row.group.id, section);
      sections.get(section)!.count += row.group.total;
    } else if (row.kind === 'group-task') {
      section = groupSections.get(row.group.id) ?? downloadTaskGroupSection(row.group);
    } else {
      section = downloadSection(row.task);
      sections.get(section)!.count += 1;
    }
    sections.get(section)!.rows.push(row);
  }

  return TRANSFER_SECTION_ORDER
    .map((section) => sections.get(section)!)
    .filter((section) => section.rows.length > 0);
}

export function filterDownloadTaskRows(rows: DownloadTaskRow[], query: string): DownloadTaskRow[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return rows;

  const matchingGroupNames = new Set(
    rows
      .filter((row): row is Extract<DownloadTaskRow, { kind: 'group' }> => row.kind === 'group')
      .filter((row) => row.group.name.toLocaleLowerCase().includes(normalized))
      .map((row) => row.group.id),
  );
  const visibleGroupIds = new Set(matchingGroupNames);
  for (const row of rows) {
    if (row.kind === 'group-task' && matchesTransferQuery(row.task, query)) {
      visibleGroupIds.add(row.group.id);
    } else if (row.kind === 'group' && row.group.tasks.some((task) => matchesTransferQuery(task, query))) {
      visibleGroupIds.add(row.group.id);
    }
  }

  return rows.filter((row) => {
    if (row.kind === 'task') return matchesTransferQuery(row.task, query);
    if (row.kind === 'group') return visibleGroupIds.has(row.group.id);
    return visibleGroupIds.has(row.group.id)
      && (matchingGroupNames.has(row.group.id) || matchesTransferQuery(row.task, query));
  });
}

export function downloadTaskGroupSection(group: DownloadTaskGroup): TransferSectionKey {
  const childSections = new Set(group.tasks.map(downloadSection));
  if (childSections.has('attention')) return 'attention';
  if (group.preparing || childSections.has('active')) return 'active';
  if (childSections.has('waiting')) return 'waiting';
  return 'history';
}

export function isRunningDownloadTask(task: DownloadTaskDto) {
  return RUNNING_STATUSES.has(task.status);
}

export function canDeleteDownloadTaskGroupFiles(group: DownloadTaskGroup) {
  return group.tasks.length > 0
    && !group.preparing
    && group.tasks.some((task) => task.status === 'completed')
    && group.tasks.every((task) => TERMINAL_DOWNLOAD_STATUSES.has(task.status));
}

export function canRemoveDownloadTaskGroupRecords(group: DownloadTaskGroup) {
  return group.tasks.length > 0
    && !group.preparing
    && group.tasks.every((task) => TERMINAL_DOWNLOAD_STATUSES.has(task.status));
}

function buildDownloadTaskGroup(
  id: string,
  tasks: DownloadTaskDto[],
  activeBatch?: DownloadBatchSnapshot,
): DownloadTaskGroup {
  const sortedTasks = [...tasks].sort((a, b) => a.created_at - b.created_at || compareTransferIds(a.task_id, b.task_id));

  const totalBytes = sortedTasks.reduce((sum, task) => sum + Math.max(0, task.total_bytes), 0);
  const currentBytes = sortedTasks.reduce((sum, task) => sum + (['completed', 'deleted'].includes(task.status)
    ? Math.max(0, task.total_bytes) : Math.min(Math.max(0, task.total_bytes), Math.max(0, task.current_bytes))), 0);
  const averageProgress = sortedTasks.length === 0
    ? 0
    : sortedTasks.reduce((sum, task) => sum + clampProgress(task.progress), 0) / sortedTasks.length;

  const available = countStatus(sortedTasks, ['completed']);
  const deleted = countStatus(sortedTasks, ['deleted']);
  // Deleting a local file does not undo its completed transfer. Keep transfer
  // progress monotonic while exposing local-file availability separately.
  const completed = available + deleted;
  const failed = countStatus(sortedTasks, ['failed']) + (activeBatch?.failed ?? 0);
  const cancelled = countStatus(sortedTasks, ['cancelled']);
  const scheduledTasks = sortedTasks.filter((task) => task.status === 'scheduled');
  const rateLimited = scheduledTasks.filter((task) =>
    serverAvailability(task.error)?.kind === 'rate_limited'
  ).length;
  const isBatchGroup = Boolean(activeBatch || sortedTasks.some((task) => task.batch_id?.trim()));
  const total = Math.max(sortedTasks.length, activeBatch?.discovered ?? 0, activeBatch?.queued ?? 0);
  const progressKnown = !activeBatch || total > 0;
  const allSizesKnown = sortedTasks.length > 0 && sortedTasks.every(task => task.total_bytes > 0);
  const progress = !activeBatch && allSizesKnown
    ? Math.min(1, currentBytes / totalBytes)
    : isBatchGroup
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
    scheduled: scheduledTasks.length,
    rateLimited,
    queueRateLimited: activeBatch?.rateLimited ?? 0,
    rateLimitWaiting: activeBatch?.rateLimitWaiting ?? false,
    running: sortedTasks.filter(isRunningDownloadTask).length,
    paused: countStatus(sortedTasks, ['paused']),
    completed,
    deleted,
    failed,
    cancelled,
    discovered: activeBatch?.discovered ?? sortedTasks.length,
    queued: activeBatch?.queued ?? sortedTasks.length,
    currentBytes,
    totalBytes,
    progress: clampProgress(progress),
    progressKnown,
    preparing: Boolean(activeBatch),
    batchPaused: activeBatch?.paused ?? false,
    phase: activeBatch?.phase ?? null,
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
