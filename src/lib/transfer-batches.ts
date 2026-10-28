import type { DownloadTaskDto, TransferControlAction, UploadTaskDto } from './api';
import { compareTransferEntries, compareTransferIds, isTransferInProgress, downloadCapabilities, uploadCapabilities, matchesTransferQuery, uploadSection, type TransferSectionFilter } from './transfer-task-view';

export type TransferTask = DownloadTaskDto | UploadTaskDto;
export type CleanupKind = 'completed' | 'failed' | 'cancelled' | 'finished' | 'active';
export const transferId = (task: TransferTask) => 'upload_id' in task ? task.upload_id : task.task_id;

export function canControlTransfer(task: TransferTask, action: TransferControlAction) {
  const capabilities = 'upload_id' in task ? uploadCapabilities(task) : downloadCapabilities(task);
  if (action === 'retry') return 'upload_id' in task ? uploadCapabilities(task).restart : downloadCapabilities(task).retry;
  if (action === 'cancel_and_remove') return capabilities.cancel;
  return capabilities[action];
}

export function matchesCleanup(task: TransferTask, kind: CleanupKind): boolean {
  if (kind === 'active') return canControlTransfer(task, 'cancel');
  if (kind === 'completed') return ['completed', 'skipped', 'deleted'].includes(task.status);
  if (kind === 'failed') return ['failed', 'interrupted'].includes(task.status);
  if (kind === 'cancelled') return task.status === 'cancelled';
  return matchesCleanup(task, 'completed') || matchesCleanup(task, 'failed') || matchesCleanup(task, 'cancelled');
}

export function summarizeTransfers(tasks: TransferTask[]) {
  const completed = tasks.filter(t => matchesCleanup(t, 'completed')).length;
  const failed = tasks.filter(t => matchesCleanup(t, 'failed')).length;
  const running = tasks.filter(t => ['uploading', 'downloading', 'decrypting', 'verifying'].includes(t.status)).length;
  const waiting = tasks.filter(t => ['pending', 'scheduled'].includes(t.status)).length;
  const paused = tasks.filter(t => t.status === 'paused').length;
  const totalBytes = tasks.reduce((sum, t) => sum + Math.max(0, t.total_bytes), 0);
  const currentBytes = tasks.reduce((sum, t) => sum + Math.min(Math.max(0, t.current_bytes), Math.max(0, t.total_bytes)), 0);
  const bytesKnown = tasks.length > 0 && tasks.every(t => t.total_bytes > 0);
  return { completed, failed, running, waiting, paused, totalBytes, currentBytes, bytesKnown,
    progress: bytesKnown ? currentBytes / totalBytes : (tasks.length ? completed / tasks.length : 0) };
}

export interface UploadTaskGroup {
  id: string;
  name: string;
  tasks: UploadTaskDto[];
  matching: UploadTaskDto[];
  summary: ReturnType<typeof summarizeTransfers>;
}

export type UploadTaskRow =
  | { kind: 'group'; group: UploadTaskGroup }
  | { kind: 'task'; task: UploadTaskDto; groupId?: string };

export function buildUploadTaskRows(tasks: UploadTaskDto[], expanded: ReadonlySet<string>, query = '', filter: TransferSectionFilter = 'all'): UploadTaskRow[] {
  const groups = new Map<string, UploadTaskDto[]>();
  const entries: Array<UploadTaskGroup | UploadTaskDto> = [];
  for (const task of tasks) {
    if (!task.batch_id) { entries.push(task); continue; }
    const members = groups.get(task.batch_id) ?? [];
    members.push(task);
    groups.set(task.batch_id, members);
  }
  for (const [id, members] of groups) {
    members.sort((a, b) => (a.batch_index ?? Number.MAX_SAFE_INTEGER) - (b.batch_index ?? Number.MAX_SAFE_INTEGER)
      || a.created_at - b.created_at || compareTransferIds(a.upload_id, b.upload_id));
    const name = members[0].batch_name ?? '';
    const matching = members.filter(t => (filter === 'all' || uploadSection(t) === filter)
      && (matchesTransferQuery(t, query) || (Boolean(query.trim()) && name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))));
    if (matching.length) entries.push({ id, name, tasks: members, matching, summary: summarizeTransfers(members) });
  }
  const sortKey = (entry: UploadTaskGroup | UploadTaskDto) => 'matching' in entry
    ? { id: entry.id, active: entry.tasks.some(isTransferInProgress),
      createdAt: entry.tasks.reduce((earliest, task) => Math.min(earliest, task.batch_created_at ?? task.created_at), Infinity) }
    : { id: entry.upload_id, active: isTransferInProgress(entry), createdAt: entry.created_at };
  const sorted = entries.map(entry => ({ entry, ...sortKey(entry) })).sort(compareTransferEntries);
  return sorted.flatMap(({ entry }): UploadTaskRow[] => {
    if ('matching' in entry) return [{ kind: 'group', group: entry }, ...(expanded.has(entry.id) || query.trim()
      ? entry.matching.map(task => ({ kind: 'task' as const, task, groupId: entry.id })) : [])];
    return (filter === 'all' || uploadSection(entry) === filter) && matchesTransferQuery(entry, query) ? [{ kind: 'task', task: entry }] : [];
  });
}
