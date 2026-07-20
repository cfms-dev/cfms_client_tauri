import type { IconName } from '$lib/icons';
import { isMobilePlatform } from '$lib/platform';

type SettingsPlatformScope = 'all' | 'mobile';

export interface SettingsEntry {
  labelKey: string;
  descriptionKey: string;
  icon: IconName;
  href: string;
  requiresAuth?: boolean;
  platformScope?: SettingsPlatformScope;
}

interface SettingsEntryVisibilityContext {
  isLoggedIn: boolean;
  isMobile?: boolean;
}

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  {
    labelKey: 'settings.language.title',
    descriptionKey: 'settings.language.description',
    icon: 'language',
    href: '/home/settings/language',
  },
  {
    labelKey: 'settings.appearance.title',
    descriptionKey: 'settings.appearance.description',
    icon: 'appearance',
    href: '/home/settings/appearance',
  },
  {
    labelKey: 'settings.behavior.title',
    descriptionKey: 'settings.behavior.description',
    icon: 'touchApp',
    href: '/home/settings/behavior',
    requiresAuth: true,
    platformScope: 'mobile',
  },
  {
    labelKey: 'settings.connection.title',
    descriptionKey: 'settings.connection.description',
    icon: 'connect',
    href: '/home/settings/connection',
  },
  {
    labelKey: 'settings.account.title',
    descriptionKey: 'settings.account.description',
    icon: 'accountCircle',
    href: '/home/settings/account',
    requiresAuth: true,
  },
  {
    labelKey: 'settings.storage.title',
    descriptionKey: 'settings.storage.description',
    icon: 'storage',
    href: '/home/settings/storage',
    requiresAuth: true,
  },
  {
    labelKey: 'settings.activity.title',
    descriptionKey: 'settings.activity.description',
    icon: 'history',
    href: '/home/settings/activity',
    requiresAuth: true,
  },
  {
    labelKey: 'settings.privacy.title',
    descriptionKey: 'settings.privacy.description',
    icon: 'privacy',
    href: '/home/settings/privacy',
    requiresAuth: true,
  },
  {
    labelKey: 'settings.tasks.title',
    descriptionKey: 'settings.tasks.description',
    icon: 'tasks',
    href: '/home/settings/tasks',
    requiresAuth: true,
  },
  {
    labelKey: 'appLock.settings.title',
    descriptionKey: 'appLock.settings.description',
    icon: 'lockPerson',
    href: '/home/settings/app-lock',
    requiresAuth: true,
  },
  {
    labelKey: 'settings.updates.title',
    descriptionKey: 'settings.updates.description',
    icon: 'browserUpdated',
    href: '/home/settings/updates',
  },
];

export function getVisibleSettingsEntries(
  context: SettingsEntryVisibilityContext,
): SettingsEntry[] {
  return SETTINGS_ENTRIES.filter((entry) => isSettingsEntryVisible(entry, context));
}

export function isSettingsEntryVisible(
  entry: SettingsEntry,
  context: SettingsEntryVisibilityContext,
): boolean {
  if (entry.requiresAuth && !context.isLoggedIn) return false;
  if (entry.platformScope === 'mobile') return context.isMobile ?? isMobilePlatform();
  return true;
}
