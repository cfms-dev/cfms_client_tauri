import { browser } from '$app/environment';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { formatBytes, type UpdateProgressSnapshot } from '$lib/updater';

const UPDATE_NOTIFICATION_ID = 24001;

export interface UpdateNotificationCopy {
  title: string;
  preparingDownload: string;
  installing: string;
  installed: string;
  downloadProgress: (values: { percent: string; current: string; total: string }) => string;
  downloadedBytes: (values: { current: string }) => string;
}

class UpdateNotificationReporter {
  private enabled: boolean | null = null;
  private lastBucket: string | null = null;

  reset() {
    this.lastBucket = null;
  }

  async report(snapshot: UpdateProgressSnapshot, copy: UpdateNotificationCopy) {
    if (!browser || !(await this.ensureEnabled())) return;

    const bucket = this.bucketFor(snapshot);
    if (bucket === this.lastBucket) return;
    this.lastBucket = bucket;

    try {
      sendNotification({
        id: UPDATE_NOTIFICATION_ID,
        title: copy.title,
        body: this.bodyFor(snapshot, copy),
        ongoing: snapshot.phase === 'downloading' || snapshot.phase === 'installing',
        autoCancel: snapshot.phase === 'finished',
        group: 'app-update',
      });
    } catch {
      this.enabled = false;
    }
  }

  private async ensureEnabled() {
    if (this.enabled !== null) return this.enabled;

    try {
      this.enabled = await isPermissionGranted();
      if (!this.enabled) {
        this.enabled = (await requestPermission()) === 'granted';
      }
    } catch {
      this.enabled = false;
    }

    return this.enabled;
  }

  private bucketFor(snapshot: UpdateProgressSnapshot) {
    if (snapshot.phase !== 'downloading') return snapshot.phase;
    if (snapshot.progress !== null) {
      return `downloading:${Math.floor(snapshot.progress * 100 / 10) * 10}`;
    }
    return `downloading:${Math.floor(snapshot.downloadedBytes / (2 * 1024 * 1024))}`;
  }

  private bodyFor(snapshot: UpdateProgressSnapshot, copy: UpdateNotificationCopy) {
    if (snapshot.phase === 'installing') return copy.installing;
    if (snapshot.phase === 'finished') return copy.installed;

    if (snapshot.totalBytes) {
      const percent = snapshot.progress === null
        ? '0.0'
        : (Math.round(snapshot.progress * 1000) / 10).toFixed(1);
      return copy.downloadProgress({
        percent,
        current: formatBytes(snapshot.downloadedBytes),
        total: formatBytes(snapshot.totalBytes),
      });
    }

    if (snapshot.downloadedBytes > 0) {
      return copy.downloadedBytes({ current: formatBytes(snapshot.downloadedBytes) });
    }

    return copy.preparingDownload;
  }
}

export const updateNotificationReporter = new UpdateNotificationReporter();
