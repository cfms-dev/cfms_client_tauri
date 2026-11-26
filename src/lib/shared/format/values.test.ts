import { describe, expect, it } from 'vitest';
import { formatBytes } from '$lib/shared/format/values';

describe('file size formatting', () => {
  it('includes the byte unit for an empty document', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('keeps missing sizes distinct from empty documents', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });

  it('formats terabyte and larger sizes without overflowing unit labels', () => {
    expect(formatBytes(1024 ** 4)).toBe('1.0 TiB');
    expect(formatBytes(1024 ** 5)).toBe('1024.0 TiB');
  });
});
