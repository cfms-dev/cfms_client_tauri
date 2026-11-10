import { describe, expect, it } from 'vitest';
import {
  ACTIVE_UPDATE_CHECK_PAUSE,
  UPDATE_CHECK_PAUSE_DURATIONS,
  createUpdateCheckPause,
  isAutomaticCheckPaused,
  parseUpdateCheckPause,
  serializeUpdateCheckPause,
} from '$lib/features/updates/update-check-pause';

describe('update check pause policy', () => {
  const now = Date.UTC(2026, 8, 11, 8, 0, 0);

  it('creates exact 24-hour pause presets', () => {
    expect(createUpdateCheckPause('day', now)).toEqual({
      mode: 'until',
      until: now + UPDATE_CHECK_PAUSE_DURATIONS.day,
    });
    expect(createUpdateCheckPause('week', now)).toEqual({
      mode: 'until',
      until: now + UPDATE_CHECK_PAUSE_DURATIONS.week,
    });
    expect(createUpdateCheckPause('month', now)).toEqual({
      mode: 'until',
      until: now + UPDATE_CHECK_PAUSE_DURATIONS.month,
    });
    expect(createUpdateCheckPause('indefinite', now)).toEqual({ mode: 'indefinite' });
  });

  it('round-trips valid active, temporary, and indefinite values', () => {
    const values = [
      ACTIVE_UPDATE_CHECK_PAUSE,
      { mode: 'until', until: now + 1_000 } as const,
      { mode: 'indefinite' } as const,
    ];
    for (const value of values) {
      expect(parseUpdateCheckPause(serializeUpdateCheckPause(value), now)).toEqual(value);
    }
  });

  it('fails open for missing, malformed, invalid, and expired values', () => {
    expect(parseUpdateCheckPause(null, now)).toEqual(ACTIVE_UPDATE_CHECK_PAUSE);
    expect(parseUpdateCheckPause('not-json', now)).toEqual(ACTIVE_UPDATE_CHECK_PAUSE);
    expect(parseUpdateCheckPause('{"mode":"unknown"}', now)).toEqual(ACTIVE_UPDATE_CHECK_PAUSE);
    expect(parseUpdateCheckPause(JSON.stringify({ mode: 'until', until: now }), now))
      .toEqual(ACTIVE_UPDATE_CHECK_PAUSE);
  });

  it('reports only future and indefinite policies as paused', () => {
    expect(isAutomaticCheckPaused(ACTIVE_UPDATE_CHECK_PAUSE, now)).toBe(false);
    expect(isAutomaticCheckPaused({ mode: 'until', until: now }, now)).toBe(false);
    expect(isAutomaticCheckPaused({ mode: 'until', until: now + 1 }, now)).toBe(true);
    expect(isAutomaticCheckPaused({ mode: 'indefinite' }, now)).toBe(true);
  });
});
