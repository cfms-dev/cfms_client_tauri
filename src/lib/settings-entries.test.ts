import { describe, expect, it } from 'vitest';
import { getVisibleSettingsEntries } from './settings-entries';

describe('settings entry visibility', () => {
  it('shows one unified account entry to signed-in users', () => {
    const entries = getVisibleSettingsEntries({ isLoggedIn: true, isMobile: false });

    expect(entries.filter((entry) => entry.href === '/home/settings/account')).toHaveLength(1);
    expect(entries.some((entry) => entry.href === '/home/settings/twofa')).toBe(false);
  });

  it('places the account entry immediately after connection', () => {
    const entries = getVisibleSettingsEntries({ isLoggedIn: true, isMobile: false });
    const connectionIndex = entries.findIndex((entry) => entry.href === '/home/settings/connection');

    expect(entries[connectionIndex + 1]?.href).toBe('/home/settings/account');
  });

  it('hides the account entry from signed-out users', () => {
    const entries = getVisibleSettingsEntries({ isLoggedIn: false, isMobile: false });

    expect(entries.some((entry) => entry.href === '/home/settings/account')).toBe(false);
  });

  it('keeps extension settings outside user-reachable settings', () => {
    const entries = getVisibleSettingsEntries({ isLoggedIn: true, isMobile: false });

    expect(entries.some((entry) => entry.href === '/home/settings/extensions')).toBe(false);
  });
});
