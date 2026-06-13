import { getSetting } from '$lib/api';
import { checkAppUpdate, type AppUpdateMetadata, type UpdateChannel } from '$lib/updater';

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

  private channelLoaded = false;
  private pendingCheck: Promise<AppUpdateMetadata | null> | null = null;

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
      const found = await checkAppUpdate(channel);
      this.update = found;
      this.checked = true;
      this.checkedAt = Date.now();
      return found;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.checked = false;
      this.update = null;
      this.checkedAt = Date.now();
      return null;
    } finally {
      this.checking = false;
    }
  }
}

function isUpdateChannel(value: string | null): value is UpdateChannel {
  return value === 'stable' || value === 'beta' || value === 'alpha';
}

export const appUpdateState = new AppUpdateState();
