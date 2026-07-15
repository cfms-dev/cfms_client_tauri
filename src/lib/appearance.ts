import type {
  AppearancePreference,
  ColorSchemePreference,
  ReduceMotionPreference,
} from '$lib/api';

export type ResolvedColorScheme = 'light' | 'dark';

export const DEFAULT_APPEARANCE: AppearancePreference = {
  color_scheme: 'system',
  reduce_motion: 'system',
};

export function normalizeAppearance(
  value: AppearancePreference | null | undefined,
): AppearancePreference {
  return {
    color_scheme: normalizeColorScheme(value?.color_scheme),
    reduce_motion: normalizeReduceMotion(value?.reduce_motion),
  };
}

export function normalizeColorScheme(value: unknown): ColorSchemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function resolveColorScheme(
  preference: ColorSchemePreference,
  systemPrefersDark: boolean,
): ResolvedColorScheme {
  return preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
}

export function resolveReducedMotion(
  preference: ReduceMotionPreference,
  systemPrefersReducedMotion: boolean,
): boolean {
  if (preference === 'always') return true;
  if (preference === 'never') return false;
  return systemPrefersReducedMotion;
}

export function normalizeReduceMotion(value: unknown): ReduceMotionPreference {
  return value === 'always' || value === 'never' || value === 'system' ? value : 'system';
}

export function isReducedMotionEnabled(): boolean {
  if (typeof document !== 'undefined') {
    const configured = document.documentElement.dataset.reduceMotion;
    if (configured !== undefined) return configured === 'true';
  }
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
