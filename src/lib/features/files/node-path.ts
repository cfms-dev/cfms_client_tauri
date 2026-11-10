import { ROOT_DIRECTORY_ID } from '$lib/features/files/file-browser';

export interface ResolvedNodePathSegment {
  id: string;
  label: string;
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
