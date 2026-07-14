import { describe, expect, it } from 'vitest';
import { formatUtcDateTime } from './date-time';

describe('UTC date-time formatting', () => {
  it('uses a fixed layout with an explicit UTC indicator', () => {
    expect(formatUtcDateTime(new Date('2026-07-14T13:45:06.789Z'))).toBe(
      '2026-07-14 13:45:06 UTC',
    );
  });

  it('formats numeric timestamps as UTC regardless of the host time zone', () => {
    expect(formatUtcDateTime(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe(
      '2026-01-02 03:04:05 UTC',
    );
  });

  it('returns an empty value for an invalid timestamp', () => {
    expect(formatUtcDateTime(Number.NaN)).toBe('');
  });
});
