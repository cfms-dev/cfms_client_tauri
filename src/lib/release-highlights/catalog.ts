import { compareAppVersions } from '$lib/app-version';
import type { ReleaseHighlight, ReleaseTour } from './types';

const managementPermissions = [
  'manage_system',
  'list_users',
  'create_user',
  'delete_user',
  'set_user_permissions',
  'manage_2fa',
] as const;

export const releaseTours: readonly ReleaseTour[] = [
  {
    version: '0.43.0',
    labelKey: 'releaseHighlights.v043.label',
    highlights: [
      {
        id: 'document-id-download',
        titleKey: 'releaseHighlights.v043.documentDownload.title',
        bodyKey: 'releaseHighlights.v043.documentDownload.body',
        animationSrc: '/release-highlights/v0.43/document-download.json',
        fallbackIcon: 'download',
      },
      {
        id: 'flexible-workspace',
        titleKey: 'releaseHighlights.v043.flexibleWorkspace.title',
        bodyKey: 'releaseHighlights.v043.flexibleWorkspace.body',
        animationSrc: '/release-highlights/v0.43/flexible-workspace.json',
        fallbackIcon: 'maximizeDialog',
      },
      {
        id: 'server-diagnostics',
        titleKey: 'releaseHighlights.v043.diagnostics.title',
        bodyKey: 'releaseHighlights.v043.diagnostics.body',
        animationSrc: '/release-highlights/v0.43/server-diagnostics.json',
        fallbackIcon: 'bugReport',
        requiredAnyPermission: ['diagnostics'],
      },
      {
        id: 'account-administration',
        titleKey: 'releaseHighlights.v043.administration.title',
        bodyKey: 'releaseHighlights.v043.administration.body',
        animationSrc: '/release-highlights/v0.43/account-administration.json',
        fallbackIcon: 'manageAccounts',
        requiredAnyPermission: managementPermissions,
      },
    ],
  },
] as const;

export function findReleaseTour(version: string): ReleaseTour | null {
  return releaseTours.find((tour) => compareAppVersions(tour.version, version) === 0) ?? null;
}

export function filterReleaseHighlights(
  highlights: readonly ReleaseHighlight[],
  permissions: readonly string[],
): ReleaseHighlight[] {
  const permissionSet = new Set(permissions);
  return highlights.filter((highlight) =>
    !highlight.requiredAnyPermission
      || highlight.requiredAnyPermission.some((permission) => permissionSet.has(permission)),
  );
}
