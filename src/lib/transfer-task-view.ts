import type {
  DownloadTaskDto, DownloadTaskStatus, UploadTaskDto, UploadTaskStatus,
} from './api';

export type TransferSectionKey = 'attention' | 'active' | 'waiting' | 'history';
export type TransferSectionFilter = 'all' | TransferSectionKey;

export const TRANSFER_SECTION_ORDER: TransferSectionKey[] = [
  'attention', 'active', 'waiting', 'history',
];

const DOWNLOAD_STATUS_KEYS: Record<DownloadTaskStatus, string> = {
  pending: 'tasks.pending',
  downloading: 'tasks.downloading',
  paused: 'tasks.paused',
  decrypting: 'tasks.decrypting',
  verifying: 'tasks.verifying',
  completed: 'tasks.completed',
  deleted: 'tasks.fileDeleted',
  failed: 'tasks.failed',
  cancelled: 'tasks.cancelled',
  scheduled: 'tasks.retryWaiting',
};

const UPLOAD_STATUS_KEYS: Record<UploadTaskStatus, string> = {
  pending: 'tasks.uploadQueued',
  uploading: 'tasks.uploading',
  paused: 'tasks.paused',
  interrupted: 'tasks.interrupted',
  completed: 'tasks.uploadCompleted',
  failed: 'tasks.failed',
  cancelled: 'tasks.cancelled',
  skipped: 'tasks.skipped',
};

const ACTIVE_DOWNLOAD_STATUSES = new Set<DownloadTaskStatus>([
  'downloading', 'decrypting', 'verifying',
]);

export function downloadStatusMessageKey(status: DownloadTaskStatus) {
  return DOWNLOAD_STATUS_KEYS[status];
}

export function uploadStatusMessageKey(status: UploadTaskStatus) {
  return UPLOAD_STATUS_KEYS[status];
}

export function downloadPhaseMessageKey(
  task: Pick<DownloadTaskDto, 'stage' | 'status'>,
): string | null {
  if (!ACTIVE_DOWNLOAD_STATUSES.has(task.status)) return null;

  return ({
    0: 'tasks.phases.receiving',
    1: 'tasks.phases.decrypting',
    2: 'tasks.phases.cleaning',
    3: 'tasks.phases.verifying',
  } as Record<number, string>)[task.stage] ?? 'tasks.phases.transferring';
}

export function downloadSection(task: DownloadTaskDto): TransferSectionKey {
  if (task.status === 'failed') return 'attention';
  if (['downloading', 'decrypting', 'verifying', 'scheduled'].includes(task.status)) return 'active';
  if (['pending', 'paused'].includes(task.status)) return 'waiting';
  return 'history';
}

export function uploadSection(task: UploadTaskDto): TransferSectionKey {
  if (task.status === 'failed' || task.status === 'interrupted') return 'attention';
  if (task.status === 'uploading') return 'active';
  if (task.status === 'pending' || task.status === 'paused') return 'waiting';
  return 'history';
}

export function matchesTransferQuery(
  task: Pick<DownloadTaskDto, 'filename' | 'file_path'> | Pick<UploadTaskDto, 'file_name' | 'source_path'>,
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const name = 'filename' in task ? task.filename : task.file_name;
  const path = 'file_path' in task ? task.file_path : task.source_path;
  return `${name}\n${path}`.toLocaleLowerCase().includes(normalized);
}

export function downloadCapabilities(task: DownloadTaskDto) {
  return {
    pause: task.status === 'pending' || task.status === 'scheduled'
      || (task.status === 'downloading' && task.supports_resume),
    resume: task.status === 'paused',
    retry: task.status === 'failed',
    cancel: ['pending', 'scheduled', 'downloading', 'decrypting', 'verifying', 'paused'].includes(task.status),
    open: task.status === 'completed',
    deleteFile: task.status === 'completed',
    removeRecord: ['completed', 'deleted', 'failed', 'cancelled'].includes(task.status),
  };
}

export function uploadCapabilities(task: UploadTaskDto) {
  return {
    pause: task.status === 'pending' || task.status === 'uploading',
    resume: task.status === 'paused',
    restart: (task.status === 'interrupted' || task.status === 'failed') && task.source_available,
    reselect: task.status === 'interrupted' && !task.source_available,
    cancel: ['pending', 'uploading', 'paused'].includes(task.status),
    removeRecord: ['completed', 'failed', 'cancelled', 'skipped'].includes(task.status),
  };
}

export function sortSectionTasks<T extends { created_at: number }>(tasks: T[], section: TransferSectionKey) {
  return [...tasks].sort((a, b) => section === 'history'
    ? b.created_at - a.created_at
    : a.created_at - b.created_at);
}
