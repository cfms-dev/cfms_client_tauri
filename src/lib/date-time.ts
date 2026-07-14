/**
 * Format an instant as an unambiguous, administrator-friendly UTC timestamp.
 * The fixed layout stays comparable across locales and always names the zone.
 */
export function formatUtcDateTime(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';

  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}
