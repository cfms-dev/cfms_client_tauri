import { describe, expect, it } from 'vitest';
import { getVisibleSettingsEntries } from './settings-entries';

describe('settings entry visibility', () => {
  it('shows the password entry to signed-in users', () => {
    const entries = getVisibleSettingsEntries({ isLoggedIn: true, isMobile: false });

    expect(entries.some((entry) => entry.href === '/home/settings/password')).toBe(true);
  });

  it('hides the password entry from signed-out users', () => {
    const entries = getVisibleSettingsEntries({ isLoggedIn: false, isMobile: false });

    expect(entries.some((entry) => entry.href === '/home/settings/password')).toBe(false);
  });
});
