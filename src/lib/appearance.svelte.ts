import { loadAppearancePreference, saveAppearancePreference } from '$lib/api';
import type { AppearancePreference } from '$lib/api';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  DEFAULT_APPEARANCE,
  normalizeAppearance,
  resolveColorScheme,
  resolveReducedMotion,
  type ResolvedColorScheme,
} from '$lib/appearance';

class AppearanceStore {
  preference = $state<AppearancePreference>({ ...DEFAULT_APPEARANCE });
  resolvedColorScheme = $state<ResolvedColorScheme>('light');
  loading = $state(true);

  private colorSchemeMediaQuery: MediaQueryList | null = null;
  private reducedMotionMediaQuery: MediaQueryList | null = null;
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
    this.applyToDocument();
    return () => {
      this.colorSchemeMediaQuery?.removeEventListener('change', this.handleSystemAppearanceChange);
      this.reducedMotionMediaQuery?.removeEventListener('change', this.handleSystemAppearanceChange);
      this.colorSchemeMediaQuery = null;
      this.reducedMotionMediaQuery = null;
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
    root.dataset.colorSchemePreference = this.preference.color_scheme;
    root.dataset.reduceMotion = String(reduceMotion);
    root.style.colorScheme = this.resolvedColorScheme;
    void getCurrentWindow().setTheme(this.resolvedColorScheme).catch(() => {
      /* Browser previews do not expose a native Tauri window. */
    });
  }
}

export const appearanceStore = new AppearanceStore();
