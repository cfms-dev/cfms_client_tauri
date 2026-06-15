import { browser } from '$app/environment';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import { formatBytes, type UpdateProgressSnapshot } from '$lib/updater';
import { floatingProgressStore } from '$lib/stores.svelte';

const UPDATE_NOTIFICATION_ID = 24001;
const UPDATE_NOTIFICATION_TAG = 'cfms-app-update-download';
const UPDATE_PROGRESS_ID = 'app-update:download';
const SYSTEM_NOTIFICATION_MIN_INTERVAL_MS = 500;
const UNKNOWN_TOTAL_BUCKET_BYTES = 512 * 1024;

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
  private lastSystemNotificationAt = 0;
  private androidRuntime: boolean | null = null;

  reset() {
    this.lastBucket = null;
    this.lastSystemNotificationAt = 0;
    floatingProgressStore.remove(UPDATE_PROGRESS_ID);
  }

  dismiss() {
    floatingProgressStore.remove(UPDATE_PROGRESS_ID);
    void this.cancelAndroidNotification();
  }

  async report(snapshot: UpdateProgressSnapshot, copy: UpdateNotificationCopy) {
    const body = this.bodyFor(snapshot, copy);
    const ongoing = snapshot.phase === 'downloading' || snapshot.phase === 'installing';
    const isAndroid = await this.isAndroidRuntime();

    if (isAndroid) {
      this.reportFloatingProgress(snapshot, copy.title, body);
    }

    if (!browser) return;

    if (!this.shouldReportSystemNotification(snapshot)) return;

    try {
      if (isAndroid) {
        await invoke('show_android_update_notification', {
          title: copy.title,
          body,
          ongoing,
          showProgress: ongoing,
        });
      } else {
        if (!(await this.ensureEnabled())) return;

        const notificationOptions: ReplacingNotificationOptions = {
          id: UPDATE_NOTIFICATION_ID,
          tag: UPDATE_NOTIFICATION_TAG,
          renotify: false,
          title: copy.title,
          body,
          ongoing,
          autoCancel: snapshot.phase === 'finished',
          group: 'app-update',
        };

        sendNotification(notificationOptions);
      }
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
      return `downloading:${Math.floor(snapshot.progress * 100)}`;
    }
    return `downloading:${Math.floor(snapshot.downloadedBytes / UNKNOWN_TOTAL_BUCKET_BYTES)}`;
  }

  private shouldReportSystemNotification(snapshot: UpdateProgressSnapshot) {
    const bucket = this.bucketFor(snapshot);
    if (bucket === this.lastBucket) return false;

    const now = Date.now();
    const isTerminalOrPhaseChange = snapshot.phase !== 'downloading';
    const isComplete = snapshot.progress !== null && snapshot.progress >= 1;
    if (
      !isTerminalOrPhaseChange
      && !isComplete
      && this.lastSystemNotificationAt > 0
      && now - this.lastSystemNotificationAt < SYSTEM_NOTIFICATION_MIN_INTERVAL_MS
    ) {
      return false;
    }

    this.lastBucket = bucket;
    this.lastSystemNotificationAt = now;
    return true;
  }

  private reportFloatingProgress(
    snapshot: UpdateProgressSnapshot,
    title: string,
    text: string,
  ) {
    if (snapshot.phase === 'finished' || snapshot.phase === 'idle') {
      floatingProgressStore.remove(UPDATE_PROGRESS_ID);
      return;
    }

    const total = snapshot.totalBytes ?? Math.max(snapshot.downloadedBytes, 1);
    floatingProgressStore.upsert(
      UPDATE_PROGRESS_ID,
      title,
      text,
      snapshot.downloadedBytes,
      total,
    );
  }

  private async isAndroidRuntime() {
    if (!browser) return false;
    if (this.androidRuntime !== null) return this.androidRuntime;

    try {
      this.androidRuntime = platform() === 'android';
    } catch {
      this.androidRuntime = false;
    }

    return this.androidRuntime;
  }

  private async cancelAndroidNotification() {
    if (!browser || !(await this.isAndroidRuntime())) return;

    try {
      await invoke('cancel_android_update_notification');
    } catch {
      // Best effort only; stale system notifications are harmless.
    }
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

interface ReplacingNotificationOptions {
  id: number;
  title: string;
  body?: string;
  tag?: string;
  renotify?: boolean;
  ongoing?: boolean;
  autoCancel?: boolean;
  group?: string;
}

export const updateNotificationReporter = new UpdateNotificationReporter();
