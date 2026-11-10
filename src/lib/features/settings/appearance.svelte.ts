import { loadAppearancePreference, saveAppearancePreference } from '$lib/api';
import type { AppearancePreference } from '$lib/api';
import { getCurrentWindow } from '$lib/shared/platform/native-window';
import { isTauri } from '$lib/shared/platform/native-core';
import { setWindowBackdrop } from '$lib/api/core';
import { colorPalettes, DEFAULT_PALETTE_ID } from '$lib/shared/fluent/palettes';
import { paletteWindowAppearance } from '$lib/shared/fluent/theme';
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  resolveColorScheme,
  resolveReducedMotion,
  type ResolvedColorScheme,
} from '$lib/shared/appearance';

class AppearanceStore {
  preference = $state<AppearancePreference>({ ...DEFAULT_APPEARANCE });
  resolvedColorScheme = $state<ResolvedColorScheme>('light');
  loading = $state(true);

  private colorSchemeMediaQuery: MediaQueryList | null = null;
  private reducedMotionMediaQuery: MediaQueryList | null = null;
  private forcedColorsMediaQuery: MediaQueryList | null = null;
  private reducedTransparencyMediaQuery: MediaQueryList | null = null;
  private appearanceRevision = 0;
  private nativeAppearanceUpdate = Promise.resolve();
  private scopeKey: string | null = null;
  private globalPreference: AppearancePreference | null = null;
  private requestId = 0;

  init() {
    if (typeof window === 'undefined') return () => {};
    if (!this.colorSchemeMediaQuery) {
      this.colorSchemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.colorSchemeMediaQuery.addEventListener('change', this.handleSystemAppearanceChange);
    }
    if (!this.reducedMotionMediaQuery) {
      this.reducedMotionMediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotionMediaQuery.addEventListener('change', this.handleSystemAppearanceChange);
    }
    if (!this.forcedColorsMediaQuery) {
      this.forcedColorsMediaQuery = window.matchMedia('(forced-colors: active)');
      this.forcedColorsMediaQuery.addEventListener('change', this.handleSystemAppearanceChange);
    }
    if (!this.reducedTransparencyMediaQuery) {
      this.reducedTransparencyMediaQuery = window.matchMedia('(prefers-reduced-transparency: reduce)');
      this.reducedTransparencyMediaQuery.addEventListener('change', this.handleSystemAppearanceChange);
    }
    this.applyToDocument();
    return () => {
      this.colorSchemeMediaQuery?.removeEventListener('change', this.handleSystemAppearanceChange);
      this.reducedMotionMediaQuery?.removeEventListener('change', this.handleSystemAppearanceChange);
      this.forcedColorsMediaQuery?.removeEventListener('change', this.handleSystemAppearanceChange);
      this.reducedTransparencyMediaQuery?.removeEventListener('change', this.handleSystemAppearanceChange);
      this.colorSchemeMediaQuery = null;
      this.reducedMotionMediaQuery = null;
      this.forcedColorsMediaQuery = null;
      this.reducedTransparencyMediaQuery = null;
    };
  }

  async load(scopeKey: string, force = false) {
    if (!force && this.scopeKey === scopeKey) return;
    if (!force && scopeKey === 'global' && this.globalPreference) {
      this.scopeKey = scopeKey;
      this.apply(this.globalPreference);
      this.loading = false;
      return;
    }
    const requestId = ++this.requestId;
    this.loading = true;
    try {
      const preference = normalizeAppearance(await loadAppearancePreference());
      if (requestId !== this.requestId) return;
      this.scopeKey = scopeKey;
      if (scopeKey === 'global') this.globalPreference = preference;
      this.apply(preference);
    } finally {
      if (requestId === this.requestId) this.loading = false;
    }
  }

  async save(preference: AppearancePreference) {
    const next = normalizeAppearance(preference);
    const savedScopeKey = this.scopeKey;
    this.apply(next);
    await saveAppearancePreference(next);
    if (savedScopeKey === 'global') this.globalPreference = next;
  }

  apply(preference: AppearancePreference) {
    this.preference = normalizeAppearance(preference);
    this.applyToDocument();
  }

  private handleSystemAppearanceChange = () => {
    this.applyToDocument();
  };

  private applyToDocument() {
    const systemPrefersDark = this.colorSchemeMediaQuery?.matches
      ?? (typeof window !== 'undefined'
        && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const systemPrefersReducedMotion = this.reducedMotionMediaQuery?.matches
      ?? (typeof window !== 'undefined'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.resolvedColorScheme = resolveColorScheme(
      this.preference.color_scheme,
      systemPrefersDark,
    );
    const reduceMotion = resolveReducedMotion(
      this.preference.reduce_motion,
      systemPrefersReducedMotion,
    );

    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset.theme = this.resolvedColorScheme;
    root.dataset.palette = DEFAULT_PALETTE_ID;
    root.dataset.colorSchemePreference = this.preference.color_scheme;
    root.dataset.reduceMotion = String(reduceMotion);
    root.style.colorScheme = this.resolvedColorScheme;
    const scheme = this.resolvedColorScheme;
    const revision = ++this.appearanceRevision;
    void import('$lib/shared/fluent/runtime').then(({ applyFluentTheme }) => {
      if (revision === this.appearanceRevision) applyFluentTheme({ paletteId: DEFAULT_PALETTE_ID, mode: scheme, reduceMotion });
    });
    root.dataset.windowBackdrop = 'solid';
    if (!isTauri()) return;
    const { enabled, solidColor } = paletteWindowAppearance(
      colorPalettes[DEFAULT_PALETTE_ID], scheme,
      !this.forcedColorsMediaQuery?.matches && !this.reducedTransparencyMediaQuery?.matches,
    );
    this.nativeAppearanceUpdate = this.nativeAppearanceUpdate.then(async () => {
      if (revision !== this.appearanceRevision) return;
      await getCurrentWindow().setTheme(scheme);
      const mode = await setWindowBackdrop(scheme, enabled, solidColor);
      if (revision === this.appearanceRevision) root.dataset.windowBackdrop = mode;
    }).catch(() => {
      // The opaque CSS canvas is already active if native material is unavailable.
    });
  }
}

export const appearanceStore = new AppearanceStore();
