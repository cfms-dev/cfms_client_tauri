import { describe, expect, it } from 'vitest';
import { getVisibleSettingsEntries } from './settings-entries';

describe('settings entry visibility', () => {
  it('shows one unified account entry to signed-in users', () => {
    const entries = getVisibleSettingsEntries({ isLoggedIn: true, isMobile: false });

    expect(entries.filter((entry) => entry.href === '/home/settings/account')).toHaveLength(1);
    expect(entries.some((entry) => entry.href === '/home/settings/twofa')).toBe(false);
  });

  it('hides the account entry from signed-out users', () => {
    const entries = getVisibleSettingsEntries({ isLoggedIn: false, isMobile: false });

    expect(entries.some((entry) => entry.href === '/home/settings/account')).toBe(false);
  });
});
