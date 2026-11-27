import type {
  SearchDirectoryEntry,
  SearchDocumentEntry,
  SearchFilesResponse,
  SearchResultItem,
} from '$lib/api';
import { normalizeDirectoryId, ROOT_DIRECTORY_ID } from './file-browser';

export type SearchResultRow =
  | { kind: 'directory'; directory: SearchDirectoryEntry }
  | { kind: 'document'; document: SearchDocumentEntry };

export type SearchDisplayRow =
  | {
      kind: 'group-header';
      parentId: string;
      runIndex: number;
      firstGroup: boolean;
      key: string;
    }
  | {
      kind: 'directory';
      directory: SearchDirectoryEntry;
      parentId: string;
      key: string;
    }
  | {
      kind: 'document';
      document: SearchDocumentEntry;
      parentId: string;
      key: string;
    };

export function normalizeSearchParentId(parentId: string | null | undefined): string {
  return normalizeDirectoryId(parentId) ?? ROOT_DIRECTORY_ID;
}

function searchItemToRow(item: SearchResultItem): SearchResultRow {
  if (item.type === 'directory') {
    const { type: _type, ...directory } = item;
    return { kind: 'directory', directory };
  }
  const { type: _type, ...document } = item;
  return { kind: 'document', document };
}

export function toSearchResultRows(results: SearchFilesResponse | null): SearchResultRow[] {
  if (!results) return [];
  return results.items.map(searchItemToRow);
}

export function mergeSearchResponses(
  previous: SearchFilesResponse,
  page: SearchFilesResponse,
): SearchFilesResponse {
  return {
    ...page,
    items: [...previous.items, ...page.items],
    total_count: previous.total_count + page.total_count,
  };
}

/**
 * Group adjacent search results that share the same normalized parent directory ID.
 *
 * Non-adjacent results with the same parent directory ID are intentionally kept in
 * separate groups so the overall ordering returned by the server is never altered.
 */
export function buildGroupedSearchDisplayRows(
  rows: readonly SearchResultRow[],
): SearchDisplayRow[] {
  const displayRows: SearchDisplayRow[] = [];
  const seenItemKeys = new Map<string, number>();
  let previousParentId: string | null = null;
  let runIndex = -1;

  for (const row of rows) {
    const parentId = normalizeSearchParentId(
      row.kind === 'directory' ? row.directory.parent_id : row.document.parent_id,
    );

    if (parentId !== previousParentId) {
      runIndex += 1;
      displayRows.push({
        kind: 'group-header',
        parentId,
        runIndex,
        firstGroup: runIndex === 0,
        key: `group:${runIndex}:${parentId}`,
      });
      previousParentId = parentId;
    }

    const baseKey =
      row.kind === 'directory'
        ? `directory:${row.directory.id}`
        : `document:${row.document.id}`;
    const occurrence = seenItemKeys.get(baseKey) ?? 0;
    seenItemKeys.set(baseKey, occurrence + 1);
    const key = occurrence === 0 ? baseKey : `${baseKey}#${occurrence}`;

    if (row.kind === 'directory') {
      displayRows.push({
        kind: 'directory',
        directory: row.directory,
        parentId,
        key,
      });
    } else {
      displayRows.push({
        kind: 'document',
        document: row.document,
        parentId,
        key,
      });
    }
  }

  return displayRows;
}
