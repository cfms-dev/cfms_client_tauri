import { describe, expect, it } from 'vitest';
import { parseSetting, settingChanges, settingControl } from './server-settings';
import { canSetAccountName } from '$lib/features/authentication/auth-permissions';
import { canAccessAdministration } from './permissions';
import type { ServerSettingDefinition } from '$lib/api/types';

const definition: ServerSettingDefinition = { namespace: 'n', option_key: 'limit', owner: 'core', schema_version: 1, title: 'Limit', description: '', default: 2, value_schema: { type: 'integer', minimum: 1 } };
describe('server setting drafts', () => {
  it('validates syntax, numeric bounds and integer values without coercion', () => {
    expect(parseSetting(definition, '2')).toEqual({ value: 2, valid: true });
    expect(parseSetting(definition, '0')?.valid).toBe(false);
    expect(parseSetting(definition, '2.5')?.valid).toBe(false);
    expect(parseSetting(definition, '"2"')?.valid).toBe(false);
    expect(parseSetting(definition, '{')).toBeNull();
  });
  it('submits only changed values with the revisions actually read', () => {
    const snapshot = { namespace: 'n', settings: { limit: { value: 2, revision: 7, updated_at: null } } };
    expect(settingChanges([definition], snapshot, { limit: ' 2 ' })).toEqual({});
    expect(settingChanges([definition], snapshot, { limit: '3' })).toEqual({ limit: { value: 3, expected_revision: 7 } });
    expect(settingChanges([definition], snapshot, { limit: '0' })).toEqual({});
  });
  it('uses JSON for composite and nullable schemas and preserves enum types', () => {
    expect(settingControl({ ...definition, value_schema: { type: 'object' } })).toBe('json');
    expect(settingControl({ ...definition, value_schema: { anyOf: [{ type: 'number' }, { type: 'null' }] } })).toBe('json');
    const item = { ...definition, value_schema: { enum: [false, 2, 'two'] } };
    expect(settingControl(item)).toBe('enum');
    expect(parseSetting(item, 'false')).toEqual({ value: false, valid: true });
  });
});
describe('protocol 30 business permissions', () => {
  it.each(['username', 'nickname'] as const)('separates self, delegated and elevated %s access', (kind) => {
    expect(canSetAccountName([`set_${kind}`], kind, true)).toBe(true);
    expect(canSetAccountName([`set_${kind}`], kind, false)).toBe(false);
    expect(canSetAccountName([`super_set_${kind}`], kind, false)).toBe(true);
    expect(canSetAccountName([`super_set_${kind}`], kind, true)).toBe(true);
    expect(canSetAccountName(['manage_system'], kind, true)).toBe(false);
    expect(canSetAccountName([], kind, true)).toBe(false);
  });
  it('admits settings-only administrators and rejects removed blanket permission', () => {
    expect(canAccessAdministration(['view_settings'])).toBe(true);
    expect(canAccessAdministration(['manage_settings'])).toBe(true);
    expect(canAccessAdministration(['manage_system'])).toBe(false);
  });
});
