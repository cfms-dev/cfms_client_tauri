import { ROOT_DIRECTORY_ID, sameDirectoryId } from '$lib/file-browser';
import type { ServerDocumentInfo } from '$lib/api';

export interface ResolvedNodePathSegment {
  id: string;
  label: string;
}

export type NodePathTerminal =
  | { kind: 'directory'; id: string; label: string }
  | { kind: 'document'; id: string; label: string; parentId: string | null };

export async function classifyNodePathTerminal(options: {
  terminal: ResolvedNodePathSegment;
  expectedParentId: string | null;
  getDirectoryInfo: (id: string) => Promise<unknown>;
  getDocumentInfo: (id: string) => Promise<ServerDocumentInfo>;
  errorStatus: (error: unknown) => number | null;
}): Promise<NodePathTerminal> {
  const {
    terminal,
    expectedParentId,
    getDirectoryInfo,
    getDocumentInfo,
    errorStatus,
  } = options;
  try {
    await getDirectoryInfo(terminal.id);
    return { kind: 'directory', ...terminal };
  } catch (directoryError) {
    if (errorStatus(directoryError) !== 404) throw directoryError;
  }

  const documentInfo = await getDocumentInfo(terminal.id);
  if (
    documentInfo.parent_id === undefined
    || !sameDirectoryId(documentInfo.parent_id, expectedParentId)
  ) {
    throw new Error('node_lookup document parent does not match get_document_info');
  }
  return {
    kind: 'document',
    id: terminal.id,
    label: documentInfo.title ?? terminal.label,
    parentId: expectedParentId,
  };
}

export function decodeResolvedNodePath(
  path: string,
  nodeIds: readonly string[],
): ResolvedNodePathSegment[] {
  if (nodeIds[0] !== ROOT_DIRECTORY_ID) {
    throw new Error('node_lookup response does not start at the root');
  }

  if (path === ROOT_DIRECTORY_ID) {
    if (nodeIds.length !== 1) throw new Error('Root path returned unexpected node IDs');
    return [];
  }
  if (!path.startsWith(ROOT_DIRECTORY_ID)) {
    throw new Error('Resolved node path is not absolute');
  }

  const encodedSegments = path.slice(1).split('/');
  if (encodedSegments.some((segment) => segment.length === 0)) {
    throw new Error('Resolved node path contains an empty segment');
  }
  if (nodeIds.length !== encodedSegments.length + 1) {
    throw new Error('node_lookup response does not match the resolved path');
  }

  return encodedSegments.map((segment, index) => ({
    id: nodeIds[index + 1],
    label: decodeURIComponent(segment),
  }));
}

export function encodeNodePathSegment(label: string): string {
  return label.replaceAll('%', '%25').replaceAll('/', '%2F');
}

export function formatAbsoluteNodePath(labels: readonly string[]): string {
  if (labels.length === 0) return ROOT_DIRECTORY_ID;
  return `${ROOT_DIRECTORY_ID}${labels.map(encodeNodePathSegment).join('/')}`;
}

export function knownAbsoluteNodePath(
  navigationRootId: string | null,
  labels: readonly string[],
): string | null {
  return navigationRootId === null ? formatAbsoluteNodePath(labels) : null;
}
