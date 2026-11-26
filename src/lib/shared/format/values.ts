export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

export function formatDate(ts: number | null | undefined, fallback = '—'): string {
  if (!ts || !Number.isFinite(ts) || ts < 0) return fallback;
  return new Date(ts * 1000).toLocaleString();
}

export function isPickerCancel(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('cancel')
    || normalized.includes('no folder was selected');
}
