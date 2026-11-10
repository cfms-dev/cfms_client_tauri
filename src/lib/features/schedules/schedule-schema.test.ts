import { describe, expect, it } from 'vitest';
import type { JsonValue } from '$lib/api';
import {
  buildPayloadDefaults,
  parsePayloadSource,
  preparePayloadSchema,
  validatePayloadAgainstSchema,
  valueCanRender,
} from '$lib/features/schedules/schedule-schema';

const lockdownSchema: Record<string, JsonValue> = {
  additionalProperties: false,
  description: 'Strict persisted contract for one scheduled lockdown occurrence.',
  properties: {
    duration_seconds: {
      exclusiveMinimum: 0,
      title: 'Duration Seconds',
      type: 'integer',
    },
    reason: {
      anyOf: [
        { maxLength: 1024, minLength: 1, type: 'string' },
        { type: 'null' },
      ],
      default: null,
      title: 'Reason',
    },
  },
  required: ['duration_seconds'],
  title: 'ScheduledLockdownWindowPayload',
  type: 'object',
};

describe('scheduled payload JSON Schema', () => {
  it('prepares the Pydantic lockdown contract and applies explicit defaults', () => {
    const prepared = preparePayloadSchema(lockdownSchema);

    expect(prepared.renderable).toBe(true);
    expect(prepared.root?.properties?.map((property) => property.key))
      .toEqual(['duration_seconds', 'reason']);
    expect(buildPayloadDefaults(prepared)).toEqual({ reason: null });
  });

  it('validates values against the advertised draft 2020-12 contract', () => {
    expect(validatePayloadAgainstSchema(lockdownSchema, {
      duration_seconds: 3600,
      reason: 'Scheduled maintenance',
    })).toMatchObject({ valid: true, available: true, issues: [] });

    const invalid = validatePayloadAgainstSchema(lockdownSchema, {
      duration_seconds: 0,
      reason: '',
    });
    expect(invalid.available).toBe(true);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('supports nested local references, enums, and homogeneous arrays', () => {
    const schema: Record<string, JsonValue> = {
      $defs: {
        target: {
          additionalProperties: false,
          properties: { mode: { enum: ['audit', 'enforce'] } },
          required: ['mode'],
          type: 'object',
        },
      },
      additionalProperties: false,
      properties: {
        targets: { type: 'array', items: { $ref: '#/$defs/target' } },
      },
      required: ['targets'],
      type: 'object',
    };
    const prepared = preparePayloadSchema(schema);

    expect(prepared.renderable).toBe(true);
    expect(prepared.root && valueCanRender(prepared.root, { targets: [{ mode: 'audit' }] }))
      .toBe(true);
    expect(prepared.root && valueCanRender(prepared.root, { targets: [{ mode: 4 }] }))
      .toBe(false);
  });

  it('falls back for lossy compound and external-reference schemas', () => {
    expect(preparePayloadSchema({
      type: 'object',
      properties: { destination: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
    }).unsupportedKeyword).toBe('oneOf');
    expect(preparePayloadSchema({ $ref: 'https://example.invalid/task.json' }).unsupportedKeyword)
      .toBe('$ref');
  });

  it('parses only JSON objects for the schedule wire contract', () => {
    expect(parsePayloadSource('{"enabled":true}')).toEqual({ enabled: true });
    expect(() => parsePayloadSource('[]')).toThrow('payloadObject');
    expect(() => parsePayloadSource('{')).toThrow(SyntaxError);
  });
});
