import { Channel, invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';

export type UpdateChannel = 'stable' | 'beta' | 'alpha';

export interface AppUpdateMetadata {
  currentVersion: string;
  version: string;
  date?: string | null;
  body?: string | null;
  channel: UpdateChannel;
  releaseUrl: string;
  installMode: 'desktop' | 'android-apk';
}

export type AppUpdateDownloadEvent =
  | { event: 'Started'; data: { contentLength?: number | null } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

export interface UpdateProgressSnapshot {
  phase: 'idle' | 'downloading' | 'installing' | 'finished';
  downloadedBytes: number;
  totalBytes: number | null;
  progress: number | null;
}

export async function checkAppUpdate(
  channel: UpdateChannel,
): Promise<AppUpdateMetadata | null> {
  return invoke<AppUpdateMetadata | null>('check_app_update', { channel });
}

export async function installAppUpdate(
  onProgress: (snapshot: UpdateProgressSnapshot) => void,
): Promise<void> {
  let downloadedBytes = 0;
  let totalBytes: number | null = null;

  const progressChannel = new Channel<AppUpdateDownloadEvent>((event) => {
    if (event.event === 'Started') {
      downloadedBytes = 0;
      totalBytes = event.data.contentLength ?? null;
      onProgress(toSnapshot('downloading', downloadedBytes, totalBytes));
      return;
    }

    if (event.event === 'Progress') {
      downloadedBytes += event.data.chunkLength;
      onProgress(toSnapshot('downloading', downloadedBytes, totalBytes));
      return;
    }

    onProgress(toSnapshot('installing', downloadedBytes, totalBytes));
  });

  await invoke('install_app_update', { onEvent: progressChannel });
  onProgress(toSnapshot('finished', downloadedBytes, totalBytes));
}

export async function relaunchApp(): Promise<void> {
  await relaunch();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function toSnapshot(
  phase: UpdateProgressSnapshot['phase'],
  downloadedBytes: number,
  totalBytes: number | null,
): UpdateProgressSnapshot {
  const progress =
    totalBytes && totalBytes > 0
      ? Math.min(downloadedBytes / totalBytes, 1)
      : null;

  return {
    phase,
    downloadedBytes,
    totalBytes,
    progress,
  };
}
