import { Validator, type Schema, type ValidationResult } from '@cfworker/json-schema';
import type { JsonValue } from '$lib/api';

export type VisualSchemaKind = 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean';

export interface VisualSchemaProperty {
  key: string;
  required: boolean;
  node: VisualSchemaNode;
}

export interface VisualSchemaNode {
  kind: VisualSchemaKind;
  title: string | null;
  description: string | null;
  nullable: boolean;
  defaultValue?: JsonValue;
  constValue?: JsonValue;
  enumValues?: JsonValue[];
  properties?: VisualSchemaProperty[];
  items?: VisualSchemaNode;
  additionalProperties: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export interface PreparedPayloadSchema {
  renderable: boolean;
  root: VisualSchemaNode | null;
  unsupportedPath: string | null;
  unsupportedKeyword: string | null;
}

export interface PayloadValidationIssue {
  keyword: string;
  instancePath: string;
  message: string;
}

export interface PayloadValidationResult {
  valid: boolean;
  available: boolean;
  issues: PayloadValidationIssue[];
  unavailableReason?: string;
}

const MAX_SCHEMA_DEPTH = 12;
const MAX_SCHEMA_NODES = 240;
const validatorCache = new WeakMap<Record<string, JsonValue>, Validator>();
const UNSUPPORTED_VISUAL_KEYWORDS = [
  'allOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'patternProperties',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
  'dependencies',
  'unevaluatedProperties',
  'prefixItems',
  'contains',
  'unevaluatedItems',
] as const;

interface PreparationState {
  root: Record<string, JsonValue>;
  seenRefs: Set<string>;
  nodeCount: number;
  failure: { path: string; keyword: string } | null;
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fail(state: PreparationState, path: string, keyword: string): null {
  state.failure ??= { path, keyword };
  return null;
}

function decodePointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolveLocalRef(
  state: PreparationState,
  reference: string,
  path: string,
): Record<string, JsonValue> | null {
  if (!reference.startsWith('#/')) return fail(state, path, '$ref');
  if (state.seenRefs.has(reference)) return fail(state, path, '$ref-cycle');

  let current: JsonValue = state.root;
  for (const rawSegment of reference.slice(2).split('/')) {
    if (!isRecord(current)) return fail(state, path, '$ref');
    const segment = decodePointerSegment(rawSegment);
    if (!Object.hasOwn(current, segment)) return fail(state, path, '$ref');
    current = current[segment];
  }
  if (!isRecord(current)) return fail(state, path, '$ref');
  return current;
}

function textAnnotation(schema: Record<string, JsonValue>, key: 'title' | 'description'): string | null {
  return typeof schema[key] === 'string' ? schema[key] : null;
}

function numericKeyword(schema: Record<string, JsonValue>, key: string): number | undefined {
  return typeof schema[key] === 'number' && Number.isFinite(schema[key])
    ? schema[key]
    : undefined;
}

function integerKeyword(schema: Record<string, JsonValue>, key: string): number | undefined {
  const value = numericKeyword(schema, key);
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function nullableBranch(
  schema: Record<string, JsonValue>,
): { schema: Record<string, JsonValue>; nullable: boolean } | null {
  const anyOf = schema.anyOf;
  if (!Array.isArray(anyOf)) return { schema, nullable: false };
  if (anyOf.length !== 2 || !anyOf.every(isRecord)) return null;

  const nullIndex = anyOf.findIndex((branch) => branch.type === 'null');
  if (nullIndex < 0) return null;
  const valueSchema = anyOf[nullIndex === 0 ? 1 : 0];
  if (!isRecord(valueSchema)) return null;
  return { schema: valueSchema, nullable: true };
}

function inferKind(schema: Record<string, JsonValue>): VisualSchemaKind | null {
  if (typeof schema.type === 'string' && schema.type !== 'null') {
    return ['object', 'array', 'string', 'integer', 'number', 'boolean'].includes(schema.type)
      ? schema.type as VisualSchemaKind
      : null;
  }
  if (Array.isArray(schema.type)) {
    const nonNull = schema.type.filter((item) => item !== 'null');
    return nonNull.length === 1 && typeof nonNull[0] === 'string'
      && ['object', 'array', 'string', 'integer', 'number', 'boolean'].includes(nonNull[0])
      ? nonNull[0] as VisualSchemaKind
      : null;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const types = new Set(schema.enum.filter((item) => item !== null).map((item) => typeof item));
    if (types.size === 1) {
      const type = [...types][0];
      if (type === 'string' || type === 'number' || type === 'boolean') return type;
    }
  }
  if (Object.hasOwn(schema, 'const')) {
    const type = typeof schema.const;
    if (type === 'string' || type === 'number' || type === 'boolean') return type;
  }
  if (isRecord(schema.properties)) return 'object';
  return null;
}

function prepareNode(
  rawSchema: Record<string, JsonValue>,
  state: PreparationState,
  path: string,
  depth: number,
): VisualSchemaNode | null {
  state.nodeCount += 1;
  if (depth > MAX_SCHEMA_DEPTH) return fail(state, path, 'max-depth');
  if (state.nodeCount > MAX_SCHEMA_NODES) return fail(state, path, 'max-nodes');

  for (const keyword of UNSUPPORTED_VISUAL_KEYWORDS) {
    if (Object.hasOwn(rawSchema, keyword)) return fail(state, path, keyword);
  }

  let schema = rawSchema;
  let ref: string | null = null;
  if (typeof schema.$ref === 'string') {
    ref = schema.$ref;
    const resolved = resolveLocalRef(state, ref, `${path}/$ref`);
    if (!resolved) return null;
    state.seenRefs.add(ref);
    schema = { ...resolved, ...schema };
    delete schema.$ref;
  }

  const normalized = nullableBranch(schema);
  if (!normalized) return fail(state, path, 'anyOf');
  schema = normalized.schema;
  const nullableByType = Array.isArray(schema.type) && schema.type.includes('null');
  const kind = inferKind(schema);
  if (!kind) return fail(state, path, 'type');

  const enumValues = Array.isArray(schema.enum) ? cloneJson(schema.enum) : undefined;
  if (enumValues?.some((value) => value !== null && typeof value === 'object')) {
    return fail(state, path, 'enum');
  }

  const node: VisualSchemaNode = {
    kind,
    title: textAnnotation(rawSchema, 'title') ?? textAnnotation(schema, 'title'),
    description: textAnnotation(rawSchema, 'description') ?? textAnnotation(schema, 'description'),
    nullable: normalized.nullable || nullableByType || enumValues?.includes(null) === true,
    additionalProperties: schema.additionalProperties !== false,
    minimum: numericKeyword(schema, 'minimum'),
    maximum: numericKeyword(schema, 'maximum'),
    exclusiveMinimum: numericKeyword(schema, 'exclusiveMinimum'),
    exclusiveMaximum: numericKeyword(schema, 'exclusiveMaximum'),
    multipleOf: numericKeyword(schema, 'multipleOf'),
    minLength: integerKeyword(schema, 'minLength'),
    maxLength: integerKeyword(schema, 'maxLength'),
    pattern: typeof schema.pattern === 'string' ? schema.pattern : undefined,
    format: typeof schema.format === 'string' ? schema.format : undefined,
    minItems: integerKeyword(schema, 'minItems'),
    maxItems: integerKeyword(schema, 'maxItems'),
    uniqueItems: schema.uniqueItems === true || undefined,
  };

  if (Object.hasOwn(rawSchema, 'default')) node.defaultValue = cloneJson(rawSchema.default as JsonValue);
  else if (Object.hasOwn(schema, 'default')) node.defaultValue = cloneJson(schema.default as JsonValue);
  if (Object.hasOwn(schema, 'const')) node.constValue = cloneJson(schema.const as JsonValue);
  if (enumValues) node.enumValues = enumValues;

  if (kind === 'object') {
    const properties = schema.properties;
    if (properties !== undefined && !isRecord(properties)) return fail(state, `${path}/properties`, 'properties');
    if (isRecord(schema.additionalProperties)) {
      return fail(state, `${path}/additionalProperties`, 'additionalProperties');
    }
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((item): item is string => typeof item === 'string')
        : [],
    );
    node.properties = [];
    for (const [key, propertySchema] of Object.entries(properties ?? {})) {
      if (!isRecord(propertySchema)) return fail(state, `${path}/properties/${key}`, 'boolean-schema');
      const child = prepareNode(propertySchema, state, `${path}/properties/${key}`, depth + 1);
      if (!child) return null;
      node.properties.push({ key, required: required.has(key), node: child });
    }
  }

  if (kind === 'array') {
    if (!isRecord(schema.items)) return fail(state, `${path}/items`, 'items');
    const itemNode = prepareNode(schema.items, state, `${path}/items`, depth + 1);
    if (!itemNode) return null;
    node.items = itemNode;
  }

  if (ref) state.seenRefs.delete(ref);
  return node;
}

export function preparePayloadSchema(schema: Record<string, JsonValue>): PreparedPayloadSchema {
  const state: PreparationState = {
    root: schema,
    seenRefs: new Set(),
    nodeCount: 0,
    failure: null,
  };
  const root = prepareNode(schema, state, '#', 0);
  if (!root || root.kind !== 'object') {
    const failure = state.failure ?? { path: '#', keyword: 'root-object' };
    return {
      renderable: false,
      root: null,
      unsupportedPath: failure.path,
      unsupportedKeyword: failure.keyword,
    };
  }
  return { renderable: true, root, unsupportedPath: null, unsupportedKeyword: null };
}

function defaultForNode(node: VisualSchemaNode, required: boolean): JsonValue | undefined {
  if (node.defaultValue !== undefined) return cloneJson(node.defaultValue);
  if (node.constValue !== undefined) return cloneJson(node.constValue);
  if (node.kind === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const property of node.properties ?? []) {
      const childDefault = defaultForNode(property.node, property.required);
      if (childDefault !== undefined) result[property.key] = childDefault;
    }
    return required || Object.keys(result).length > 0 ? result : undefined;
  }
  if (node.kind === 'array' && required) return [];
  return undefined;
}

export function buildPayloadDefaults(prepared: PreparedPayloadSchema): Record<string, JsonValue> {
  if (!prepared.root) return {};
  const value = defaultForNode(prepared.root, true);
  return isRecord(value) ? value : {};
}

export function valueCanRender(node: VisualSchemaNode, value: JsonValue | undefined): boolean {
  if (value === undefined) return true;
  if (value === null) return node.nullable;
  if (node.kind === 'string') return typeof value === 'string';
  if (node.kind === 'boolean') return typeof value === 'boolean';
  if (node.kind === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (node.kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (node.kind === 'array') {
    return Array.isArray(value) && Boolean(node.items)
      && value.every((item) => valueCanRender(node.items!, item));
  }
  if (!isRecord(value)) return false;
  return (node.properties ?? []).every((property) =>
    valueCanRender(property.node, value[property.key]),
  );
}

export function validatePayloadAgainstSchema(
  schema: Record<string, JsonValue>,
  value: Record<string, JsonValue>,
): PayloadValidationResult {
  try {
    let validator = validatorCache.get(schema);
    if (!validator) {
      validator = new Validator(schema as Schema, '2020-12', false);
      validatorCache.set(schema, validator);
    }
    const result: ValidationResult = validator.validate(value);
    const issues = result.errors.map((error) => {
      let instancePath = error.instanceLocation.replace(/^#/, '');
      if (error.keyword === 'required') {
        const missing = /required property ["']([^"']+)["']/.exec(error.error)?.[1];
        if (missing) instancePath = `${instancePath}/${missing.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      }
      return {
        keyword: error.keyword,
        instancePath,
        message: error.error,
      };
    }).filter((issue) => issue.keyword !== 'properties' && issue.keyword !== 'items');
    return {
      valid: result.valid,
      available: true,
      issues,
    };
  } catch (error) {
    return {
      valid: true,
      available: false,
      issues: [],
      unavailableReason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parsePayloadSource(source: string): Record<string, JsonValue> {
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed)) throw new TypeError('payloadObject');
  return parsed;
}

export function jsonPointer(path: Array<string | number>): string {
  if (path.length === 0) return '';
  return `/${path.map((part) => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

export function issueMatchesPath(issuePath: string, fieldPath: string): boolean {
  return issuePath === fieldPath || issuePath.startsWith(`${fieldPath}/`);
}
