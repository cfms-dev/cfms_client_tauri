export const UPDATE_CHECK_PAUSE_SETTING_KEY = 'update_check_pause';

export const UPDATE_CHECK_PAUSE_DURATIONS = {
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000,
  month: 30 * 24 * 60 * 60_000,
} as const;

export const MAX_UPDATE_CHECK_TIMER_MS = 2_147_000_000;

export type UpdateCheckPausePreset = keyof typeof UPDATE_CHECK_PAUSE_DURATIONS | 'indefinite';

export type UpdateCheckPause =
  | { mode: 'active' }
  | { mode: 'until'; until: number }
  | { mode: 'indefinite' };

export const ACTIVE_UPDATE_CHECK_PAUSE: UpdateCheckPause = { mode: 'active' };

export function createUpdateCheckPause(
  preset: UpdateCheckPausePreset,
  now = Date.now(),
): UpdateCheckPause {
  if (preset === 'indefinite') return { mode: 'indefinite' };
  return { mode: 'until', until: now + UPDATE_CHECK_PAUSE_DURATIONS[preset] };
}

export function isAutomaticCheckPaused(pause: UpdateCheckPause, now = Date.now()): boolean {
  return pause.mode === 'indefinite' || (pause.mode === 'until' && pause.until > now);
}

export function parseUpdateCheckPause(raw: string | null, now = Date.now()): UpdateCheckPause {
  if (!raw) return ACTIVE_UPDATE_CHECK_PAUSE;

  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('mode' in value)) {
      return ACTIVE_UPDATE_CHECK_PAUSE;
    }

    if (value.mode === 'active') return ACTIVE_UPDATE_CHECK_PAUSE;
    if (value.mode === 'indefinite') return { mode: 'indefinite' };
    if (
      value.mode === 'until'
      && 'until' in value
      && typeof value.until === 'number'
      && Number.isFinite(value.until)
      && value.until > now
    ) {
      return { mode: 'until', until: value.until };
    }
  } catch {
    // Invalid or legacy values fail open so update checks are not silently disabled.
  }

  return ACTIVE_UPDATE_CHECK_PAUSE;
}

export function serializeUpdateCheckPause(pause: UpdateCheckPause): string {
  return JSON.stringify(pause);
}

export function updateCheckPausesEqual(left: UpdateCheckPause, right: UpdateCheckPause): boolean {
  if (left.mode !== right.mode) return false;
  return left.mode !== 'until' || (right.mode === 'until' && left.until === right.until);
}
