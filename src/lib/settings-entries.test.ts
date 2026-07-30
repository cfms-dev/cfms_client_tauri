import { describe, expect, it } from 'vitest';
import { getVisibleSettingsEntries, getVisibleSettingsGroups } from './settings-entries';

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

  it('groups signed-in desktop settings by task in a stable order', () => {
    const groups = getVisibleSettingsGroups({ isLoggedIn: true, isMobile: false });

    expect(groups.map((group) => group.id)).toEqual([
      'personalization',
      'accessSecurity',
      'dataOperations',
      'maintenance',
    ]);
    expect(groups.find((group) => group.id === 'accessSecurity')?.entries.map((entry) => entry.href)).toEqual([
      '/home/settings/connection',
      '/home/settings/account',
      '/home/settings/privacy',
      '/home/settings/app-lock',
    ]);
    expect(groups.find((group) => group.id === 'dataOperations')?.entries.map((entry) => entry.href)).toEqual([
      '/home/settings/storage',
      '/home/settings/activity',
      '/home/settings/tasks',
    ]);
  });

  it('keeps the mobile interaction entry in personalization only on mobile', () => {
    const desktop = getVisibleSettingsGroups({ isLoggedIn: true, isMobile: false });
    const mobile = getVisibleSettingsGroups({ isLoggedIn: true, isMobile: true });

    expect(desktop.flatMap((group) => group.entries).some((entry) => entry.href === '/home/settings/behavior')).toBe(false);
    expect(mobile.find((group) => group.id === 'personalization')?.entries.at(-1)?.href).toBe('/home/settings/behavior');
  });

  it('hides the account entry from signed-out users', () => {
    const entries = getVisibleSettingsEntries({ isLoggedIn: false, isMobile: false });

    expect(entries.some((entry) => entry.href === '/home/settings/account')).toBe(false);
  });

  it('keeps local data reset available while signed out', () => {
    const signedOut = getVisibleSettingsEntries({ isLoggedIn: false, isMobile: false });
    const signedIn = getVisibleSettingsEntries({ isLoggedIn: true, isMobile: false });

    expect(signedOut.some((entry) => entry.href === '/home/settings/data')).toBe(true);
    expect(signedIn.some((entry) => entry.href === '/home/settings/data')).toBe(true);
    expect(signedOut.find((entry) => entry.href === '/home/settings/data')?.icon).toBe('backup');
    expect(signedOut.find((entry) => entry.href === '/home/settings/data')?.tone).toBe('danger');
  });

  it('keeps extension settings outside user-reachable settings', () => {
    const entries = getVisibleSettingsEntries({ isLoggedIn: true, isMobile: false });

    expect(entries.some((entry) => entry.href === '/home/settings/extensions')).toBe(false);
  });
});
