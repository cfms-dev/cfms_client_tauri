export type FileSelectionKind = 'folder' | 'document';

export interface FileSelectionSets {
  folders: Set<string>;
  documents: Set<string>;
}

export function fileSelectionKey(kind: FileSelectionKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseFileSelectionKey(key: string): { kind: FileSelectionKind; id: string } | null {
  const separator = key.indexOf(':');
  if (separator < 1 || separator === key.length - 1) return null;
  const kind = key.slice(0, separator);
  if (kind !== 'folder' && kind !== 'document') return null;
  return { kind, id: key.slice(separator + 1) };
}

export function selectFileRange(
  orderedKeys: readonly string[],
  anchorKey: string,
  targetKey: string,
  existing: FileSelectionSets = { folders: new Set(), documents: new Set() },
  preserveExisting = false,
): FileSelectionSets {
  const anchorIndex = orderedKeys.indexOf(anchorKey);
  const targetIndex = orderedKeys.indexOf(targetKey);
  if (anchorIndex < 0 || targetIndex < 0) {
    return {
      folders: new Set(existing.folders),
      documents: new Set(existing.documents),
    };
  }

  const folders = preserveExisting ? new Set(existing.folders) : new Set<string>();
  const documents = preserveExisting ? new Set(existing.documents) : new Set<string>();
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);

  for (const key of orderedKeys.slice(start, end + 1)) {
    const item = parseFileSelectionKey(key);
    if (!item) continue;
    if (item.kind === 'folder') folders.add(item.id);
    else documents.add(item.id);
  }

  return { folders, documents };
}
