import { getSetting, setSetting } from '$lib/api';
import { loadAppVersion } from '$lib/app-info';
import { compareAppVersions } from '$lib/app-version';
import { filterReleaseHighlights, findReleaseTour } from './catalog';
import type { ReleaseTour, ReleaseTourPresentation } from './types';

export const RELEASE_HIGHLIGHTS_SEEN_KEY = 'release_highlights_seen_version';

interface ReleaseHighlightsDependencies {
  loadVersion: () => Promise<string>;
  readSetting: (key: string) => Promise<string | null>;
  writeSetting: (key: string, value: string) => Promise<void>;
}

const defaultDependencies: ReleaseHighlightsDependencies = {
  loadVersion: loadAppVersion,
  readSetting: getSetting,
  writeSetting: setSetting,
};

export class ReleaseHighlightsState {
  initialized = $state(false);
  initializing = $state(false);
  currentVersion = $state<string | null>(null);
  currentTour = $state<ReleaseTour | null>(null);
  presentation = $state<ReleaseTourPresentation | null>(null);
  autoEligible = $state(false);

  private initialization: Promise<void> | null = null;

  constructor(private readonly dependencies: ReleaseHighlightsDependencies = defaultDependencies) {}

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    if (this.initialized) return Promise.resolve();
    this.initialization = this.runInitialization();
    return this.initialization;
  }

  private async runInitialization() {
    this.initializing = true;
    try {
      const version = await this.dependencies.loadVersion();
      this.currentVersion = version;
      this.currentTour = findReleaseTour(version);
      if (!this.currentTour) return;

      try {
        const seenVersion = await this.dependencies.readSetting(RELEASE_HIGHLIGHTS_SEEN_KEY);
        this.autoEligible = !seenVersion || compareAppVersions(version, seenVersion) > 0;
      } catch {
        // Fail closed when durable state cannot be read so the tour never nags repeatedly.
        this.autoEligible = false;
      }
    } finally {
      this.initializing = false;
      this.initialized = true;
      this.initialization = null;
    }
  }

  openAutomatically(permissions: readonly string[]): boolean {
    if (!this.autoEligible || this.presentation) return false;
    return this.open(permissions, 'automatic');
  }

  openManually(permissions: readonly string[]): boolean {
    return this.open(permissions, 'manual');
  }

  private open(permissions: readonly string[], source: 'automatic' | 'manual'): boolean {
    if (!this.currentTour) return false;
    const highlights = filterReleaseHighlights(this.currentTour.highlights, permissions);
    if (highlights.length === 0) return false;
    this.presentation = { tour: this.currentTour, highlights, source };
    return true;
  }

  dismiss() {
    const version = this.presentation?.tour.version ?? this.currentTour?.version;
    this.presentation = null;
    this.autoEligible = false;
    if (!version) return;
    void this.dependencies.writeSetting(RELEASE_HIGHLIGHTS_SEEN_KEY, version).catch(() => {
      // Memory state still suppresses repeats for the current process.
    });
  }
}

export const releaseHighlightsState = new ReleaseHighlightsState();
