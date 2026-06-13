export function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

export function formatDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

export function formatUnknown(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isPickerCancel(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('cancelled')
    || normalized.includes('canceled')
    || normalized.includes('cancel')
    || normalized.includes('no folder was selected');
}
