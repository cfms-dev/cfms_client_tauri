export const SEARCH_PERMISSION = 'search';

/** The authentication snapshot already contains direct and group-inherited permissions. */
export function canSearchFiles(permissions: readonly string[]): boolean {
  return permissions.includes(SEARCH_PERMISSION);
}
