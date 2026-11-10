import { Validator, type Schema } from '@cfworker/json-schema';

export const ACCESS_OPERATIONS = ['read', 'write', 'move', 'manage'] as const;
export const MATCH_MODES = ['all', 'any'] as const;
export const CONDITION_TYPES = ['rights', 'groups'] as const;

export type AccessOperation = (typeof ACCESS_OPERATIONS)[number];
export type MatchMode = (typeof MATCH_MODES)[number];
export type ConditionType = (typeof CONDITION_TYPES)[number];

export interface AccessConditionBlock {
  match: MatchMode;
  require: string[];
}

export interface AccessSubRule {
  match: MatchMode;
  rights?: AccessConditionBlock;
  groups?: AccessConditionBlock;
}

export interface AccessRuleGroup {
  match: MatchMode;
  match_groups: AccessSubRule[];
}

export type AccessRulesRecord = Partial<Record<AccessOperation, AccessRuleGroup[]>> &
  Record<string, unknown>;

export function createConditionBlock(match: MatchMode = 'any'): AccessConditionBlock {
  return {
    match,
    require: [],
  };
}

export function createSubRule(match: MatchMode = 'all'): AccessSubRule {
  return {
    match,
  };
}

export function createRuleGroup(match: MatchMode = 'any'): AccessRuleGroup {
  return {
    match,
    match_groups: [],
  };
}

export function cloneAccessRules(rules: AccessRulesRecord): AccessRulesRecord {
  return cloneJsonRecord(rules);
}

export function formatAccessRules(rules: AccessRulesRecord): string {
  return JSON.stringify(rules, null, 2);
}

export function parseAccessRulesJson(value: string): AccessRulesRecord {
  const parsed = value.trim() ? JSON.parse(value) : {};
  validateAccessRules(parsed);
  return normalizeAccessRules(parsed);
}

// Mirrors reference/src/include/domains/access/authorization/access_rules.py.
// Validate original JSON before normalization can discard invalid fields.
const conditionSchema = {
  type: 'object',
  properties: {
    match: { enum: ['any', 'all'] },
    require: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
};
const operationSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      match: { enum: ['any', 'all'] },
      match_groups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            match: { enum: ['any', 'all'] },
            rights: conditionSchema,
            groups: conditionSchema,
          },
          additionalProperties: false,
        },
      },
    },
    required: ['match', 'match_groups'],
    additionalProperties: false,
  },
};
const accessRulesValidator = new Validator({
  type: 'object',
  properties: Object.fromEntries(ACCESS_OPERATIONS.map((operation) => [operation, operationSchema])),
  additionalProperties: false,
} as Schema, '2020-12', false);

export function validateAccessRules(value: unknown): asserts value is AccessRulesRecord {
  const result = accessRulesValidator.validate(value);
  if (result.valid) return;
  const issue = result.errors.find((error) => !['properties', 'items'].includes(error.keyword))
    ?? result.errors[0];
  throw new TypeError(`${issue.instanceLocation || '#'}: ${issue.error}`);
}

export function normalizeAccessRules(value: unknown): AccessRulesRecord {
  const normalized: AccessRulesRecord = cloneJsonRecord(value);

  for (const operation of ACCESS_OPERATIONS) {
    const rawGroups = Array.isArray(normalized[operation])
      ? (normalized[operation] as unknown[])
      : [];
    normalized[operation] = rawGroups.map(normalizeRuleGroup);
  }

  return normalized;
}

function normalizeRuleGroup(value: unknown): AccessRuleGroup {
  const raw = isRecord(value) ? value : {};
  return {
    match: normalizeMatchMode(raw.match, 'any'),
    match_groups: Array.isArray(raw.match_groups)
      ? raw.match_groups.map(normalizeSubRule)
      : [],
  };
}

function normalizeSubRule(value: unknown): AccessSubRule {
  const raw = isRecord(value) ? value : {};
  const normalized: AccessSubRule = {
    match: normalizeMatchMode(raw.match, 'all'),
  };

  for (const type of CONDITION_TYPES) {
    if (isRecord(raw[type])) {
      normalized[type] = normalizeConditionBlock(raw[type]);
    }
  }

  return normalized;
}

function normalizeConditionBlock(value: unknown): AccessConditionBlock {
  const raw = isRecord(value) ? value : {};
  return {
    match: normalizeMatchMode(raw.match, 'any'),
    require: Array.isArray(raw.require)
      ? raw.require
          .map((entry) => String(entry).trim())
          .filter(Boolean)
      : [],
  };
}

function normalizeMatchMode(value: unknown, fallback: MatchMode): MatchMode {
  return value === 'all' || value === 'any' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value);
}

function cloneJsonRecord(value: unknown): AccessRulesRecord {
  return isPlainRecord(value) ? cloneJsonValue(value) as AccessRulesRecord : {};
}

function cloneJsonValue(value: unknown): unknown {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map(cloneJsonValue)
      .filter((entry) => entry !== undefined);
  }

  if (!isPlainRecord(value)) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const cloned = cloneJsonValue(entry);
    if (cloned !== undefined) {
      result[key] = cloned;
    }
  }
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
