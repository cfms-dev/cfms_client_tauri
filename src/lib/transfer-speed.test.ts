import { describe, expect, it } from 'vitest';
import { formatByteRate, TransferSpeedTracker } from './transfer-speed';

describe('TransferSpeedTracker', () => {
  it('measures byte deltas after a stable sampling interval', () => {
    const tracker = new TransferSpeedTracker();

    expect(tracker.update('task', 1024, 1_000)).toBe(0);
    expect(tracker.update('task', 2048, 1_100)).toBe(0);
    expect(tracker.update('task', 4096, 2_000)).toBe(3072);
  });

  it('resets when transferred bytes move backwards', () => {
    const tracker = new TransferSpeedTracker();
    tracker.update('task', 4096, 1_000);
    tracker.update('task', 8192, 2_000);

    expect(tracker.update('task', 128, 3_000)).toBe(0);
    expect(tracker.update('task', 1152, 4_000)).toBe(1024);
  });
});

describe('formatByteRate', () => {
  it('formats transfer rates with binary units', () => {
    expect(formatByteRate(512)).toBe('512 B/s');
    expect(formatByteRate(1536)).toBe('1.5 KiB/s');
    expect(formatByteRate(2 * 1024 * 1024)).toBe('2.0 MiB/s');
  });
});
