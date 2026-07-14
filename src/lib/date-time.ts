/** Format a UTC offset expressed as local time minus UTC. */
export function formatUtcOffset(offsetMinutes: number): string {
  const normalizedOffset = Math.trunc(offsetMinutes);
  const sign = normalizedOffset < 0 ? '-' : '+';
  const absoluteOffset = Math.abs(normalizedOffset);
  const hours = Math.floor(absoluteOffset / 60).toString().padStart(2, '0');
  const minutes = (absoluteOffset % 60).toString().padStart(2, '0');

  return `${sign}${hours}:${minutes}`;
}

/**
 * Format an instant as local wall time with its numeric UTC offset.
 * The fixed layout stays comparable across locales, while the offset is
 * resolved for the supplied instant so daylight-saving transitions remain
 * accurate.
 */
export function formatLocalDateTimeWithUtcOffset(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';

  const dateParts = [
    date.getFullYear().toString().padStart(4, '0'),
    (date.getMonth() + 1).toString().padStart(2, '0'),
    date.getDate().toString().padStart(2, '0'),
  ];
  const timeParts = [
    date.getHours().toString().padStart(2, '0'),
    date.getMinutes().toString().padStart(2, '0'),
    date.getSeconds().toString().padStart(2, '0'),
  ];
  const utcOffset = formatUtcOffset(-date.getTimezoneOffset());

  return `${dateParts.join('-')} ${timeParts.join(':')} UTC${utcOffset}`;
}
