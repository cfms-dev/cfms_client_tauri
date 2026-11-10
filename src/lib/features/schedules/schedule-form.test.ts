import { describe, expect, it } from 'vitest';
import {
  buildScheduleTrigger,
  isoToZonedDateTimeInput,
  parsePayloadObject,
} from '$lib/features/schedules/schedule-form';

describe('schedule form protocol mapping', () => {
  it('requires payloads to be JSON objects', () => {
    expect(parsePayloadObject('{"report":"weekly"}')).toEqual({ report: 'weekly' });
    expect(() => parsePayloadObject('[]')).toThrow('payloadObject');
    expect(() => parsePayloadObject('{')).toThrow();
  });

  it('builds each protocol 27 trigger shape', () => {
    const base = {
      timezone: 'Asia/Shanghai',
      cronExpression: '',
      runAt: '',
      intervalSeconds: '',
      intervalStartAt: '',
    };
    expect(buildScheduleTrigger({ ...base, type: 'cron', cronExpression: '0 8 * * 1' })).toEqual({
      type: 'cron',
      data: { expression: '0 8 * * 1' },
      timezone: 'Asia/Shanghai',
    });
    expect(buildScheduleTrigger({ ...base, type: 'date', runAt: '2026-09-08T10:00' })).toEqual({
      type: 'date',
      data: { run_at: '2026-09-08T02:00:00.000Z' },
      timezone: 'Asia/Shanghai',
    });
    expect(buildScheduleTrigger({
      ...base,
      type: 'interval',
      intervalSeconds: '900',
      intervalStartAt: '2026-09-08T10:00',
    })).toEqual({
      type: 'interval',
      data: { seconds: 900, start_at: '2026-09-08T02:00:00.000Z' },
      timezone: 'Asia/Shanghai',
    });
  });

  it('rejects invalid interval values', () => {
    expect(() => buildScheduleTrigger({
      type: 'interval',
      timezone: 'UTC',
      cronExpression: '',
      runAt: '',
      intervalSeconds: '1.5',
      intervalStartAt: '2026-09-08T10:00',
    })).toThrow('intervalInvalid');
  });

  it('round-trips instants through the selected IANA time zone', () => {
    expect(isoToZonedDateTimeInput('2026-09-08T02:00:00.000Z', 'Asia/Shanghai'))
      .toBe('2026-09-08T10:00');
    expect(() => buildScheduleTrigger({
      type: 'date',
      timezone: 'America/New_York',
      cronExpression: '',
      runAt: '2026-03-08T02:30',
      intervalSeconds: '',
      intervalStartAt: '',
    })).toThrow('runAtInvalid');
  });
});
