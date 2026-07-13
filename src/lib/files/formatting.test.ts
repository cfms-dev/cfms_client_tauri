import { describe, expect, it } from 'vitest';
import { formatBytes } from './formatting';

describe('file size formatting', () => {
  it('includes the byte unit for an empty document', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('keeps missing sizes distinct from empty documents', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
  });
});
