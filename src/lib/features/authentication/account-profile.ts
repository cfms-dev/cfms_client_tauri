/** Server account dates are Unix seconds; zero means no timestamp was supplied. */
export function formatAccountTimestamp(value: number | null | undefined, locale: string, unavailable: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return unavailable;
  const date = new Date(value * 1000);
  if (!Number.isFinite(date.getTime())) return unavailable;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function filterAccountPermissions(permissions: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  return [...new Set(permissions)].sort().filter((permission) => permission.toLowerCase().includes(needle));
}
