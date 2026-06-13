import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';

export type SortField = 'name' | 'size' | 'modified';
export type SortDirection = 'asc' | 'desc';

interface SortableFileEntry {
  name: string;
  size: number;
  modified: number;
}

export function sortFolders(
  input: ServerDirectoryEntry[],
  field: SortField,
  direction: SortDirection,
): ServerDirectoryEntry[] {
  return [...input].sort((a, b) => compareFileEntries(
    {
      name: a.name,
      size: 0,
      modified: a.created_time ?? 0,
    },
    {
      name: b.name,
      size: 0,
      modified: b.created_time ?? 0,
    },
    field,
    direction,
  ));
}

export function sortDocuments(
  input: ServerDocumentEntry[],
  field: SortField,
  direction: SortDirection,
): ServerDocumentEntry[] {
  return [...input].sort((a, b) => compareFileEntries(
    {
      name: a.title,
      size: a.size ?? 0,
      modified: a.last_modified ?? 0,
    },
    {
      name: b.title,
      size: b.size ?? 0,
      modified: b.last_modified ?? 0,
    },
    field,
    direction,
  ));
}

function compareFileEntries(
  a: SortableFileEntry,
  b: SortableFileEntry,
  field: SortField,
  direction: SortDirection,
): number {
  const sign = direction === 'asc' ? 1 : -1;
  if (field === 'name') {
    return sign * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  }
  if (field === 'size') {
    return sign * ((a.size - b.size) || a.name.localeCompare(b.name));
  }
  return sign * ((a.modified - b.modified) || a.name.localeCompare(b.name));
}
