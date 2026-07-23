import {
  getExtensionOverview,
  installExtensionFromCatalog,
  refreshExtensionCatalog,
  setExtensionEnabled,
  type ExtensionCapability,
  type ExtensionInstallation,
  type ExtensionCatalog,
  type ExtensionOverview,
} from '$lib/api/extensions';
import { runExtensionWorkflow } from '$lib/extension-workflows';
import { notificationStore } from '$lib/stores.svelte';

class ExtensionsStore {
  overview = $state<ExtensionOverview | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  private accountScope: string | null = null;
  private timers = new Map<string, number>();
  private running = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private failures = new Map<string, number>();
  private eventListenerReady = false;
  private catalogAttempted = false;
  private catalogTimer: number | null = null;

  get enabledInstallations(): ExtensionInstallation[] {
    return (this.overview?.installed ?? []).filter((installation) =>
      this.overview?.accountStates[installation.manifest.id]?.enabled,
    );
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.overview = await getExtensionOverview();
      const enabledIds = new Set(this.enabledInstallations.map((item) => item.manifest.id));
      for (const key of this.timers.keys()) {
        const extensionId = key.slice(0, key.indexOf(':'));
        if (!enabledIds.has(extensionId)) this.clearExtensionTimers(extensionId);
      }
      if (this.accountScope) this.scheduleIntervals();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  async changeEnabled(
    extensionId: string,
    enabled: boolean,
    capabilities: ExtensionCapability[],
  ): Promise<void> {
    await setExtensionEnabled(extensionId, enabled, capabilities);
    await this.refresh();
    void this.syncCatalogOnce();
    this.clearExtensionTimers(extensionId);
    if (enabled) {
      const installation = this.overview?.installed.find((item) => item.manifest.id === extensionId);
      for (const trigger of installation?.manifest.background_triggers ?? []) {
        if (trigger.type === 'on_enable') void this.runBackground(extensionId, trigger.workflow);
      }
      this.scheduleIntervals();
    }
  }

  async activateForAccount(scope: string | null): Promise<void> {
    if (scope === this.accountScope) return;
    this.accountScope = scope;
    this.ensureEventListener();
    this.clearTimers();
    this.failures.clear();
    await this.refresh();
    void this.syncCatalogOnce();
    if (!scope) return;
    for (const installation of this.enabledInstallations) {
      for (const trigger of installation.manifest.background_triggers) {
        if (trigger.type === 'on_login') void this.runBackground(installation.manifest.id, trigger.workflow);
      }
    }
    this.scheduleIntervals();
  }

  private ensureEventListener() {
    if (this.eventListenerReady || typeof window === 'undefined') return;
    this.eventListenerReady = true;
    this.catalogTimer = window.setInterval(() => void this.syncCatalog(), 24 * 60 * 60_000);
    window.addEventListener('cfms:extension-event', (event) => {
      const eventName = (event as CustomEvent<string>).detail;
      for (const installation of this.enabledInstallations) {
        for (const trigger of installation.manifest.background_triggers) {
          if (trigger.type === 'event' && trigger.event === eventName) {
            void this.runBackground(installation.manifest.id, trigger.workflow);
          }
        }
      }
    });
  }

  private async syncCatalogOnce() {
    if (this.catalogAttempted) return;
    this.catalogAttempted = true;
    await this.syncCatalog();
  }

  private async syncCatalog() {
    if (!this.overview?.trustedKeysConfigured) return;
    try {
      const catalog = await refreshExtensionCatalog();
      await this.applyCompatibleUpdates(catalog);
      await this.refresh();
    } catch {
      // A stale signed cache remains usable and catalog outages never block core startup.
    }
  }

  private async applyCompatibleUpdates(catalog: ExtensionCatalog) {
    for (const installed of this.overview?.installed ?? []) {
      if (installed.state === 'bundled') continue;
      const candidate = catalog.extensions.find((entry) =>
        entry.manifest.id === installed.manifest.id
        && !entry.revoked
        && compareVersions(entry.manifest.version, installed.manifest.version) > 0,
      );
      if (!candidate) continue;
      const oldCapabilities = new Set(installed.manifest.requested_capabilities);
      if (!candidate.manifest.requested_capabilities.every((capability) => oldCapabilities.has(capability))) {
        continue;
      }
      try {
        await installExtensionFromCatalog(candidate.manifest.id);
      } catch {
        // Keep the last verified version active; the management page exposes retry details.
      }
    }
  }

  private scheduleIntervals() {
    for (const installation of this.enabledInstallations) {
      for (const trigger of installation.manifest.background_triggers) {
        if (trigger.type !== 'interval') continue;
        const key = `${installation.manifest.id}:${trigger.workflow}`;
        if (this.timers.has(key)) continue;
        const timer = window.setInterval(
          () => void this.runBackground(installation.manifest.id, trigger.workflow),
          Math.max(trigger.minutes, 15) * 60_000,
        );
        this.timers.set(key, timer);
      }
    }
  }

  private async runBackground(extensionId: string, workflow: string) {
    const key = `${extensionId}:${workflow}`;
    if (this.running.has(key)) return;
    this.running.add(key);
    const controller = new AbortController();
    this.controllers.set(key, controller);
    try {
      await runExtensionWorkflow(extensionId, workflow, {
        background: true,
        signal: controller.signal,
      });
      this.failures.delete(extensionId);
    } catch (error) {
      const failures = (this.failures.get(extensionId) ?? 0) + 1;
      this.failures.set(extensionId, failures);
      if (failures >= 5) {
        const installation = this.overview?.installed.find((item) => item.manifest.id === extensionId);
        await setExtensionEnabled(
          extensionId,
          false,
          installation?.manifest.requested_capabilities ?? [],
        ).catch(() => undefined);
        this.clearExtensionTimers(extensionId);
        notificationStore.error(`${installation?.manifest.name ?? extensionId} was disabled after repeated background failures.`);
        await this.refresh();
      }
    } finally {
      this.controllers.delete(key);
      this.running.delete(key);
    }
  }

  private clearExtensionTimers(extensionId: string) {
    for (const [key, timer] of this.timers) {
      if (key.startsWith(`${extensionId}:`)) {
        window.clearInterval(timer);
        this.timers.delete(key);
      }
    }
    for (const [key, controller] of this.controllers) {
      if (key.startsWith(`${extensionId}:`)) {
        controller.abort();
        this.controllers.delete(key);
      }
    }
  }

  private clearTimers() {
    for (const timer of this.timers.values()) window.clearInterval(timer);
    this.timers.clear();
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}

export const extensionsStore = new ExtensionsStore();

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split('-', 1)[0].split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
