import { describe, expect, it, vi } from 'vitest';
import { RELEASE_HIGHLIGHTS_SEEN_KEY, ReleaseHighlightsState } from './state.svelte';

function createState(seenVersion: string | null = null) {
  const writeSetting = vi.fn(async () => {});
  const state = new ReleaseHighlightsState({
    loadVersion: async () => '0.43.0',
    readSetting: async () => seenVersion,
    writeSetting,
  });
  return { state, writeSetting };
}

describe('release highlights state', () => {
  it('offers the current tour on first use and persists dismissal', async () => {
    const { state, writeSetting } = createState();
    await state.initialize();

    expect(state.autoEligible).toBe(true);
    expect(state.openAutomatically([])).toBe(true);
    expect(state.presentation?.highlights).toHaveLength(2);
    state.dismiss();

    expect(state.presentation).toBeNull();
    expect(state.autoEligible).toBe(false);
    expect(writeSetting).toHaveBeenCalledWith(RELEASE_HIGHLIGHTS_SEEN_KEY, '0.43.0');
  });

  it('does not automatically reopen a version already seen', async () => {
    const { state } = createState('0.43.0');
    await state.initialize();
    expect(state.autoEligible).toBe(false);
    expect(state.openAutomatically([])).toBe(false);
    expect(state.openManually([])).toBe(true);
  });

  it('filters automatic presentations using account permissions', async () => {
    const { state } = createState('0.42.0');
    await state.initialize();
    state.openAutomatically(['diagnostics', 'manage_system']);
    expect(state.presentation?.highlights.map((item) => item.id)).toEqual([
      'document-id-download',
      'flexible-workspace',
      'server-diagnostics',
      'account-administration',
    ]);
  });

  it('fails closed when the seen-version setting is unavailable', async () => {
    const state = new ReleaseHighlightsState({
      loadVersion: async () => '0.43.0',
      readSetting: async () => { throw new Error('settings unavailable'); },
      writeSetting: async () => {},
    });
    await state.initialize();
    expect(state.currentTour?.version).toBe('0.43.0');
    expect(state.autoEligible).toBe(false);
  });
});
