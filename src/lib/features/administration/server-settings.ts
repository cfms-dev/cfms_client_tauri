import { Validator, type Schema } from '@cfworker/json-schema';
import type { JsonValue, ServerSettingDefinition, ServerSettingsValues, ServerSettingChange } from '$lib/api/types';

const validators = new WeakMap<Record<string, JsonValue>, Validator>();

export function parseSetting(definition: ServerSettingDefinition, source: string): { value: JsonValue; valid: boolean } | null {
  try {
    const value = JSON.parse(source) as JsonValue;
    try {
      let validator = validators.get(definition.value_schema);
      if (!validator) {
        // The validator annotates schemas; Svelte state proxies reject those descriptors.
        validator = new Validator(JSON.parse(JSON.stringify(definition.value_schema)) as Schema, '2020-12', false);
        validators.set(definition.value_schema, validator);
      }
      return { value, valid: validator.validate(value).valid };
    } catch { return { value, valid: true }; } // Unsupported schemas remain server-validated.
  } catch { return null; }
}
export function settingChanges(definitions: ServerSettingDefinition[], snapshot: ServerSettingsValues | null, draft: Record<string, string>): Record<string, ServerSettingChange> {
  const result: Record<string, ServerSettingChange> = {};
  if (!snapshot) return result;
  for (const definition of definitions) {
    const key = definition.option_key;
    const original = snapshot.settings[key];
    const parsed = parseSetting(definition, draft[key] ?? '');
    if (original && parsed?.valid && JSON.stringify(original.value) !== JSON.stringify(parsed.value)) {
      result[key] = { value: parsed.value, expected_revision: original.revision };
    }
  }
  return result;
}
export function settingControl(definition: ServerSettingDefinition): 'boolean' | 'enum' | 'string' | 'integer' | 'number' | 'json' {
  const schema = definition.value_schema;
  if (Array.isArray(schema.enum)) return 'enum';
  if (['boolean', 'string', 'integer', 'number'].includes(String(schema.type))) return schema.type as 'boolean' | 'string' | 'integer' | 'number';
  return 'json';
}
