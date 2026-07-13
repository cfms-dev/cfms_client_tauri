export type DirectoryId = string | null;

/** Server-side object identifier used when an API targets the root directory itself. */
export const ROOT_DIRECTORY_ID = '/';

export interface DirectoryBreadcrumbSegment {
  label: string;
  id: string;
}

export function normalizeDirectoryId(value: string | null | undefined): DirectoryId {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed === ROOT_DIRECTORY_ID ? null : trimmed;
}

export function sameDirectoryId(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeDirectoryId(a) === normalizeDirectoryId(b);
}

export function formatDirectoryPath(segments: DirectoryBreadcrumbSegment[]): string {
  if (segments.length === 0) return ROOT_DIRECTORY_ID;
  return `${ROOT_DIRECTORY_ID}${segments.map((segment) => segment.label).join(ROOT_DIRECTORY_ID)}`;
}

export function excludedDirectorySet(ids: Array<string | null | undefined>): Set<string> {
  const result = new Set<string>();
  for (const id of ids) {
    const normalized = normalizeDirectoryId(id);
    if (normalized) result.add(normalized);
  }
  return result;
}
