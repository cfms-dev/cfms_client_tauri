import type { IconName } from '$lib/icons';
import { USER_EXTENSIONS_ENABLED } from '$lib/feature-flags';
import { isMobilePlatform } from '$lib/platform';

type SettingsPlatformScope = 'all' | 'mobile';

export type SettingsGroupId =
  | 'personalization'
  | 'accessSecurity'
  | 'dataOperations'
  | 'maintenance';

export interface SettingsGroup {
  id: SettingsGroupId;
  labelKey: string;
}

export interface VisibleSettingsGroup extends SettingsGroup {
  entries: SettingsEntry[];
}

export interface SettingsEntry {
  labelKey: string;
  descriptionKey: string;
  icon: IconName;
  href: string;
  group: SettingsGroupId;
  scopeKey?: string;
  tone?: 'default' | 'danger';
  requiresAuth?: boolean;
  platformScope?: SettingsPlatformScope;
  feature?: 'extensions';
}

interface SettingsEntryVisibilityContext {
  isLoggedIn: boolean;
  isMobile?: boolean;
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'personalization', labelKey: 'settings.overview.groups.personalization' },
  { id: 'accessSecurity', labelKey: 'settings.overview.groups.accessSecurity' },
  { id: 'dataOperations', labelKey: 'settings.overview.groups.dataOperations' },
  { id: 'maintenance', labelKey: 'settings.overview.groups.maintenance' },
];

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  {
    labelKey: 'settings.language.title',
    descriptionKey: 'settings.language.description',
    icon: 'language',
    href: '/home/settings/language',
    group: 'personalization',
  },
  {
    labelKey: 'settings.appearance.title',
    descriptionKey: 'settings.appearance.description',
    icon: 'appearance',
    href: '/home/settings/appearance',
    group: 'personalization',
  },
  {
    labelKey: 'settings.behavior.title',
    descriptionKey: 'settings.behavior.description',
    icon: 'touchApp',
    href: '/home/settings/behavior',
    group: 'personalization',
    requiresAuth: true,
    platformScope: 'mobile',
  },
  {
    labelKey: 'settings.connection.title',
    descriptionKey: 'settings.connection.description',
    icon: 'connect',
    href: '/home/settings/connection',
    group: 'accessSecurity',
    scopeKey: 'settings.overview.scope.device',
  },
  {
    labelKey: 'settings.account.title',
    descriptionKey: 'settings.account.description',
    icon: 'accountCircle',
    href: '/home/settings/account',
    group: 'accessSecurity',
    scopeKey: 'settings.overview.scope.account',
    requiresAuth: true,
  },
  {
    labelKey: 'settings.privacy.title',
    descriptionKey: 'settings.privacy.description',
    icon: 'privacy',
    href: '/home/settings/privacy',
    group: 'accessSecurity',
    scopeKey: 'settings.overview.scope.accountDevice',
    requiresAuth: true,
  },
  {
    labelKey: 'appLock.settings.title',
    descriptionKey: 'appLock.settings.description',
    icon: 'lockPerson',
    href: '/home/settings/app-lock',
    group: 'accessSecurity',
    scopeKey: 'settings.overview.scope.accountDevice',
    requiresAuth: true,
  },
  {
    labelKey: 'settings.storage.title',
    descriptionKey: 'settings.storage.description',
    icon: 'storage',
    href: '/home/settings/storage',
    group: 'dataOperations',
    requiresAuth: true,
  },
  {
    labelKey: 'settings.activity.title',
    descriptionKey: 'settings.activity.description',
    icon: 'history',
    href: '/home/settings/activity',
    group: 'dataOperations',
    requiresAuth: true,
  },
  {
    labelKey: 'settings.tasks.title',
    descriptionKey: 'settings.tasks.description',
    icon: 'tasks',
    href: '/home/settings/tasks',
    group: 'dataOperations',
    requiresAuth: true,
  },
  {
    labelKey: 'settings.localData.title',
    descriptionKey: 'settings.localData.description',
    icon: 'backup',
    href: '/home/settings/data',
    group: 'maintenance',
    tone: 'danger',
  },
  {
    // Kept in the catalog so the extension settings implementation can be
    // restored without recreating its navigation metadata.
    labelKey: 'settings.extensions.title',
    descriptionKey: 'settings.extensions.description',
    icon: 'extensions',
    href: '/home/settings/extensions',
    group: 'maintenance',
    feature: 'extensions',
  },
  {
    labelKey: 'settings.updates.title',
    descriptionKey: 'settings.updates.description',
    icon: 'browserUpdated',
    href: '/home/settings/updates',
    group: 'maintenance',
  },
];

export function getVisibleSettingsEntries(
  context: SettingsEntryVisibilityContext,
): SettingsEntry[] {
  return SETTINGS_ENTRIES.filter((entry) => isSettingsEntryVisible(entry, context));
}

export function getVisibleSettingsGroups(
  context: SettingsEntryVisibilityContext,
): VisibleSettingsGroup[] {
  const entries = getVisibleSettingsEntries(context);

  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    entries: entries.filter((entry) => entry.group === group.id),
  })).filter((group) => group.entries.length > 0);
}

export function isSettingsEntryVisible(
  entry: SettingsEntry,
  context: SettingsEntryVisibilityContext,
): boolean {
  if (entry.feature === 'extensions' && !USER_EXTENSIONS_ENABLED) return false;
  if (entry.requiresAuth && !context.isLoggedIn) return false;
  if (entry.platformScope === 'mobile') return context.isMobile ?? isMobilePlatform();
  return true;
}
