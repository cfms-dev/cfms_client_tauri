import { getSetting } from '$lib/api';
import {
  checkAppUpdate,
  installAppUpdate,
  type AppUpdateMetadata,
  type UpdateChannel,
  type UpdateProgressSnapshot,
} from '$lib/updater';
import {
  updateNotificationReporter,
  type UpdateNotificationCopy,
} from '$lib/update-notifications';

interface CheckOptions {
  force?: boolean;
}

class AppUpdateState {
  channel = $state<UpdateChannel>('stable');
  checked = $state(false);
  checking = $state(false);
  update = $state<AppUpdateMetadata | null>(null);
  error = $state<string | null>(null);
  checkedAt = $state<number | null>(null);
  installing = $state(false);
  installed = $state(false);
  installError = $state<string | null>(null);
  progress = $state<UpdateProgressSnapshot>({
    phase: 'idle',
    downloadedBytes: 0,
    totalBytes: null,
    progress: null,
  });

  private channelLoaded = false;
  private pendingCheck: Promise<AppUpdateMetadata | null> | null = null;
  private pendingInstall: Promise<void> | null = null;

  async ensureChannel(force = false): Promise<UpdateChannel> {
    if (this.channelLoaded && !force) return this.channel;

    try {
      const saved = await getSetting('update_channel');
      if (isUpdateChannel(saved)) {
        this.channel = saved;
      }
    } finally {
      this.channelLoaded = true;
    }

    return this.channel;
  }

  setChannel(channel: UpdateChannel) {
    this.channel = channel;
    this.channelLoaded = true;
    this.checked = false;
    this.update = null;
    this.error = null;
    this.checkedAt = null;
    this.resetInstallState();
  }

  async check(options: CheckOptions = {}): Promise<AppUpdateMetadata | null> {
    if (this.pendingCheck) return this.pendingCheck;
    if (this.checked && !options.force) return this.update;

    this.pendingCheck = this.runCheck(options.force === true);

    try {
      return await this.pendingCheck;
    } finally {
      this.pendingCheck = null;
    }
  }

  private async runCheck(forceChannelReload: boolean): Promise<AppUpdateMetadata | null> {
    this.checking = true;
    this.error = null;

    try {
      const channel = await this.ensureChannel(forceChannelReload);
      const previousVersion = this.update?.version ?? null;
      const found = await checkAppUpdate(channel);
      this.update = found;
      this.checked = true;
      this.checkedAt = Date.now();
      if (!found || found.version !== previousVersion) {
        this.resetInstallState();
      }
      return found;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.checked = false;
      this.update = null;
      this.checkedAt = Date.now();
      this.resetInstallState();
      return null;
    } finally {
      this.checking = false;
    }
  }

  install(copy?: UpdateNotificationCopy): Promise<void> {
    if (this.pendingInstall) return this.pendingInstall;
    if (!this.update) return Promise.reject(new Error('No pending update is available. Check for updates first.'));

    this.pendingInstall = this.runInstall(copy);
    return this.pendingInstall;
  }

  private async runInstall(copy?: UpdateNotificationCopy) {
    this.installing = true;
    this.installed = false;
    this.installError = null;
    this.progress = { phase: 'downloading', downloadedBytes: 0, totalBytes: null, progress: null };
    updateNotificationReporter.reset();
    if (copy) await updateNotificationReporter.report(this.progress, copy);

    try {
      await installAppUpdate((snapshot) => {
        this.progress = snapshot;
        if (copy) void updateNotificationReporter.report(snapshot, copy);
      });
      this.installed = true;
    } catch (err) {
      this.installError = err instanceof Error ? err.message : String(err);
      this.progress = { phase: 'idle', downloadedBytes: 0, totalBytes: null, progress: null };
      throw err;
    } finally {
      this.installing = false;
      this.pendingInstall = null;
    }
  }

  private resetInstallState() {
    this.installing = false;
    this.installed = false;
    this.installError = null;
    this.progress = { phase: 'idle', downloadedBytes: 0, totalBytes: null, progress: null };
    this.pendingInstall = null;
    updateNotificationReporter.reset();
  }
}

function isUpdateChannel(value: string | null): value is UpdateChannel {
  return value === 'stable' || value === 'beta' || value === 'alpha';
}

export const appUpdateState = new AppUpdateState();
