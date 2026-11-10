import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';

export type SortField = 'name' | 'size' | 'modified';
export type SortDirection = 'asc' | 'desc';

const fileNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export interface SortedFileEntries {
  folders: ServerDirectoryEntry[];
  documents: ServerDocumentEntry[];
}

export function sortFileEntries(
  folders: ServerDirectoryEntry[],
  documents: ServerDocumentEntry[],
  field: SortField,
  direction: SortDirection,
): SortedFileEntries {
  return {
    folders: sortFolders(folders, field, direction),
    documents: sortDocuments(documents, field, direction),
  };
}

export function sortFolders(
  input: ServerDirectoryEntry[],
  field: SortField,
  direction: SortDirection,
): ServerDirectoryEntry[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...input].sort((a, b) => sign * compareFolderEntries(a, b, field));
}

export function sortDocuments(
  input: ServerDocumentEntry[],
  field: SortField,
  direction: SortDirection,
): ServerDocumentEntry[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...input].sort((a, b) => sign * compareDocumentEntries(a, b, field));
}

function compareFolderEntries(
  a: ServerDirectoryEntry,
  b: ServerDirectoryEntry,
  field: SortField,
): number {
  if (field === 'name') {
    return compareNames(a.name, b.name);
  }
  if (field === 'size') {
    return compareNames(a.name, b.name);
  }
  return ((a.created_time ?? 0) - (b.created_time ?? 0)) || compareNames(a.name, b.name);
}

function compareDocumentEntries(
  a: ServerDocumentEntry,
  b: ServerDocumentEntry,
  field: SortField,
): number {
  if (field === 'name') {
    return compareNames(a.title, b.title);
  }
  if (field === 'size') {
    return ((a.size ?? 0) - (b.size ?? 0)) || compareNames(a.title, b.title);
  }
  return ((a.last_modified ?? 0) - (b.last_modified ?? 0)) || compareNames(a.title, b.title);
}

function compareNames(a: string, b: string): number {
  return fileNameCollator.compare(a, b);
}
