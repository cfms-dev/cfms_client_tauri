import type { JsonValue } from './common';

export interface ServerSettingDefinition {
  namespace: string;
  option_key: string;
  owner: string;
  schema_version: number;
  title: string;
  description: string;
  default: JsonValue;
  value_schema: Record<string, JsonValue>;
}
export interface ServerSettingValue { value: JsonValue; revision: number; updated_at: number | null }
export interface ServerSettingsValues { namespace: string; settings: Record<string, ServerSettingValue> }
export interface ServerSettingChange { value: JsonValue; expected_revision: number }
