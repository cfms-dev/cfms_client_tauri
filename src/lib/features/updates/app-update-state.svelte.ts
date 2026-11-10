import { getSetting, setSetting } from '$lib/api';
import { notifyGithubAuthFallback } from '$lib/features/updates/github-auth-notices';
import {
  checkAppUpdate,
  installAppUpdate,
  type AppUpdateMetadata,
  type UpdateChannel,
  type UpdateProgressSnapshot,
} from '$lib/api/updates';
import {
  updateNotificationReporter,
  type UpdateNotificationCopy,
} from '$lib/features/updates/update-notifications';
import {
  ACTIVE_UPDATE_CHECK_PAUSE,
  MAX_UPDATE_CHECK_TIMER_MS,
  UPDATE_CHECK_PAUSE_SETTING_KEY,
  isAutomaticCheckPaused,
  parseUpdateCheckPause,
  serializeUpdateCheckPause,
  updateCheckPausesEqual,
  type UpdateCheckPause,
} from '$lib/features/updates/update-check-pause';

interface CheckOptions {
  force?: boolean;
}

export class AppUpdateState {
  channel = $state<UpdateChannel>('stable');
  automaticCheckPause = $state<UpdateCheckPause>(ACTIVE_UPDATE_CHECK_PAUSE);
  automaticCheckSettled = $state(false);
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
  private automaticCheckPauseLoaded = false;
  private automaticChecksInitialized = false;
  private pendingCheck: Promise<AppUpdateMetadata | null> | null = null;
  private pendingInstall: Promise<void> | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private pauseWrite: Promise<void> = Promise.resolve();
  private visibilityHandler: (() => void) | null = null;

  get isAutomaticCheckPaused(): boolean {
    return isAutomaticCheckPaused(this.automaticCheckPause);
  }

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

  async ensureAutomaticCheckPause(force = false): Promise<UpdateCheckPause> {
    if (this.automaticCheckPauseLoaded && !force) return this.automaticCheckPause;

    try {
      const saved = await getSetting(UPDATE_CHECK_PAUSE_SETTING_KEY);
      this.automaticCheckPause = parseUpdateCheckPause(saved);
    } finally {
      this.automaticCheckPauseLoaded = true;
    }

    return this.automaticCheckPause;
  }

  async initializeAutomaticChecks(): Promise<AppUpdateMetadata | null> {
    this.automaticChecksInitialized = true;
    this.automaticCheckSettled = false;
    this.installVisibilityHandler();
    this.clearPauseTimer();

    try {
      await this.ensureAutomaticCheckPause();
      if (this.isAutomaticCheckPaused) {
        this.schedulePauseExpiry();
        return null;
      }
      return await this.check();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      this.automaticCheckSettled = true;
    }
  }

  disposeAutomaticChecks() {
    this.automaticChecksInitialized = false;
    this.clearPauseTimer();
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
    this.visibilityHandler = null;
  }

  async setAutomaticCheckPause(pause: UpdateCheckPause): Promise<void> {
    const normalized = pause.mode === 'until' && pause.until <= Date.now()
      ? ACTIVE_UPDATE_CHECK_PAUSE
      : pause;
    await this.persistAutomaticCheckPause(normalized);
    this.automaticCheckPause = normalized;
    this.automaticCheckPauseLoaded = true;

    if (this.automaticChecksInitialized) {
      this.schedulePauseExpiry();
    }
  }

  async resumeAutomaticChecks(): Promise<void> {
    await this.setAutomaticCheckPause(ACTIVE_UPDATE_CHECK_PAUSE);
    void this.check({ force: true });
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
      await notifyGithubAuthFallback();
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
      updateNotificationReporter.dismiss();
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
    updateNotificationReporter.dismiss();
  }

  private persistAutomaticCheckPause(pause: UpdateCheckPause): Promise<void> {
    const write = this.pauseWrite.then(() => setSetting(
      UPDATE_CHECK_PAUSE_SETTING_KEY,
      serializeUpdateCheckPause(pause),
    ));
    this.pauseWrite = write.catch(() => undefined);
    return write;
  }

  private installVisibilityHandler() {
    if (this.visibilityHandler || typeof document === 'undefined') return;
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') this.reconcilePauseExpiry();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private clearPauseTimer() {
    if (this.pauseTimer !== null) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
  }

  private schedulePauseExpiry() {
    this.clearPauseTimer();
    if (!this.automaticChecksInitialized || this.automaticCheckPause.mode !== 'until') return;

    const remaining = this.automaticCheckPause.until - Date.now();
    if (remaining <= 0) {
      void this.expireTemporaryPause(this.automaticCheckPause.until);
      return;
    }

    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null;
      this.reconcilePauseExpiry();
    }, Math.min(remaining, MAX_UPDATE_CHECK_TIMER_MS));
  }

  private reconcilePauseExpiry() {
    if (this.automaticCheckPause.mode !== 'until') return;
    if (this.automaticCheckPause.until > Date.now()) {
      this.schedulePauseExpiry();
      return;
    }
    void this.expireTemporaryPause(this.automaticCheckPause.until);
  }

  private async expireTemporaryPause(expectedUntil: number) {
    const expected: UpdateCheckPause = { mode: 'until', until: expectedUntil };
    if (!updateCheckPausesEqual(this.automaticCheckPause, expected)) return;

    try {
      await this.persistAutomaticCheckPause(ACTIVE_UPDATE_CHECK_PAUSE);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }

    if (!updateCheckPausesEqual(this.automaticCheckPause, expected)) return;
    this.automaticCheckPause = ACTIVE_UPDATE_CHECK_PAUSE;
    this.automaticCheckPauseLoaded = true;
    void this.check({ force: true });
  }
}

function isUpdateChannel(value: string | null): value is UpdateChannel {
  return value === 'stable' || value === 'beta' || value === 'alpha';
}

export const appUpdateState = new AppUpdateState();
