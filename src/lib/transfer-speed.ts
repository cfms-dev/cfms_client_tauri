interface TransferSpeedSample {
  bytes: number;
  measuredAt: number;
  bytesPerSecond: number;
}

const MIN_SAMPLE_INTERVAL_MS = 250;
const INSTANT_RATE_WEIGHT = 0.35;

export class TransferSpeedTracker {
  private samples = new Map<string, TransferSpeedSample>();

  update(id: string, bytes: number, measuredAt = Date.now()): number {
    const safeBytes = Math.max(0, bytes);
    const previous = this.samples.get(id);
    if (!previous || safeBytes < previous.bytes || measuredAt <= previous.measuredAt) {
      this.samples.set(id, { bytes: safeBytes, measuredAt, bytesPerSecond: 0 });
      return 0;
    }

    const elapsed = measuredAt - previous.measuredAt;
    if (elapsed < MIN_SAMPLE_INTERVAL_MS) return previous.bytesPerSecond;

    const instantRate = Math.max(0, safeBytes - previous.bytes) * 1000 / elapsed;
    const bytesPerSecond = previous.bytesPerSecond > 0
      ? previous.bytesPerSecond * (1 - INSTANT_RATE_WEIGHT) + instantRate * INSTANT_RATE_WEIGHT
      : instantRate;
    this.samples.set(id, { bytes: safeBytes, measuredAt, bytesPerSecond });
    return bytesPerSecond;
  }

  forget(id: string) {
    this.samples.delete(id);
  }

  retain(ids: ReadonlySet<string>) {
    for (const id of this.samples.keys()) {
      if (!ids.has(id)) this.samples.delete(id);
    }
  }
}

export function formatByteRate(bytesPerSecond: number): string {
  const safeRate = Math.max(0, bytesPerSecond);
  const units = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s', 'TiB/s'];
  if (safeRate < 1024) return `${Math.round(safeRate)} ${units[0]}`;

  const unitIndex = Math.min(Math.floor(Math.log(safeRate) / Math.log(1024)), units.length - 1);
  const value = safeRate / 1024 ** unitIndex;
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}
