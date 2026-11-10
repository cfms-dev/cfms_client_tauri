export function isAndroidTreeUri(path: string): boolean {
  return path.startsWith('content://') && path.includes('/tree/');
}

export function uploadDisplayName(path: string): string {
  return stripUploadCachePrefix(basename(path));
}

export function basename(path: string): string {
  if (path.includes('://')) {
    try {
      const url = new URL(path);
      const candidate = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
      if (candidate) return candidate;
    } catch {
      // Fall through to plain path parsing.
    }
  }
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function stripUploadCachePrefix(name: string): string {
  return name
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_/i, '')
    .replace(/^[0-9a-f]{32}_/i, '')
    .replace(/^\d{10,}[-_][0-9a-f]{6,}[-_]/i, '');
}
