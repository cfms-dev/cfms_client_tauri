import type { JsonValue, ScheduleTrigger, ScheduleTriggerType } from '$lib/api';

export type ScheduleValidationCode =
  | 'payloadJson'
  | 'payloadObject'
  | 'payloadSchema'
  | 'timezoneRequired'
  | 'timezoneInvalid'
  | 'cronRequired'
  | 'runAtRequired'
  | 'runAtInvalid'
  | 'intervalInvalid'
  | 'startAtRequired'
  | 'startAtInvalid';

export class ScheduleValidationError extends Error {
  constructor(readonly code: ScheduleValidationCode) {
    super(code);
    this.name = 'ScheduleValidationError';
  }
}

export interface ScheduleTriggerDraft {
  type: ScheduleTriggerType;
  timezone: string;
  cronExpression: string;
  runAt: string;
  intervalSeconds: string;
  intervalStartAt: string;
}

interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function formatterFor(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new ScheduleValidationError('timezoneInvalid');
  }
}

function partsAt(instant: Date, timezone: string): DateTimeParts {
  const values = Object.fromEntries(
    formatterFor(timezone).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function asUtcMilliseconds(parts: DateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function sameParts(left: DateTimeParts, right: DateTimeParts): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute;
}

function parseLocalDateTime(
  value: string,
  requiredCode: ScheduleValidationCode,
  invalidCode: ScheduleValidationCode,
): DateTimeParts {
  if (!value) throw new ScheduleValidationError(requiredCode);
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) throw new ScheduleValidationError(invalidCode);
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const normalized = new Date(asUtcMilliseconds(parts));
  if (
    normalized.getUTCFullYear() !== parts.year
    || normalized.getUTCMonth() + 1 !== parts.month
    || normalized.getUTCDate() !== parts.day
    || normalized.getUTCHours() !== parts.hour
    || normalized.getUTCMinutes() !== parts.minute
  ) {
    throw new ScheduleValidationError(invalidCode);
  }
  return parts;
}

/** Format an instant as a datetime-local value in the schedule's IANA time zone. */
export function toZonedDateTimeInput(value: Date, timezone: string): string {
  if (Number.isNaN(value.getTime())) return '';
  const parts = partsAt(value, timezone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function isoToZonedDateTimeInput(value: unknown, timezone: string): string {
  if (typeof value !== 'string') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : toZonedDateTimeInput(date, timezone);
}

export function parsePayloadObject(source: string): Record<string, JsonValue> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new ScheduleValidationError('payloadJson');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ScheduleValidationError('payloadObject');
  }
  return parsed as Record<string, JsonValue>;
}

function zonedDateTimeToIso(
  localValue: string,
  timezone: string,
  requiredCode: ScheduleValidationCode,
  invalidCode: ScheduleValidationCode,
): string {
  const desired = parseLocalDateTime(localValue, requiredCode, invalidCode);
  const desiredMilliseconds = asUtcMilliseconds(desired);
  let candidate = desiredMilliseconds;

  // Repeating the named-zone offset correction handles offset changes close to
  // daylight-saving transitions without relying on the device's local zone.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = partsAt(new Date(candidate), timezone);
    const correction = desiredMilliseconds - asUtcMilliseconds(rendered);
    candidate += correction;
    if (correction === 0) break;
  }

  if (!sameParts(partsAt(new Date(candidate), timezone), desired)) {
    throw new ScheduleValidationError(invalidCode);
  }
  return new Date(candidate).toISOString();
}

export function buildScheduleTrigger(draft: ScheduleTriggerDraft): ScheduleTrigger {
  const timezone = draft.timezone.trim();
  if (!timezone) throw new ScheduleValidationError('timezoneRequired');
  formatterFor(timezone);

  if (draft.type === 'cron') {
    const expression = draft.cronExpression.trim();
    if (!expression) throw new ScheduleValidationError('cronRequired');
    return { type: 'cron', data: { expression }, timezone };
  }

  if (draft.type === 'date') {
    return {
      type: 'date',
      data: { run_at: zonedDateTimeToIso(draft.runAt, timezone, 'runAtRequired', 'runAtInvalid') },
      timezone,
    };
  }

  const seconds = Number(draft.intervalSeconds);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new ScheduleValidationError('intervalInvalid');
  }
  return {
    type: 'interval',
    data: {
      seconds,
      start_at: zonedDateTimeToIso(
        draft.intervalStartAt,
        timezone,
        'startAtRequired',
        'startAtInvalid',
      ),
    },
    timezone,
  };
}
