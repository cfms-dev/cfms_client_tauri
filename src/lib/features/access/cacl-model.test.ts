import { describe, expect, it } from 'vitest';
import {
  caclDraftFingerprint,
  computeRuleEffectiveMask,
  extractUserAnnotations,
  localInputToRfc3339Utc,
  parseCaclToModel,
  rfc3339ToLocalInput,
  ruleTimeWindowState,
  serializeModelToCacl,
  setInheritDirectiveInSource,
  toggleAtomicOpOnItems,
  togglePresetMacroOnItems,
} from './cacl-model';

const ALICE_UUID = 'aabbccdd-0000-4000-8000-000000000001';
const BOB_UUID = 'aabbccdd-0000-4000-8000-000000000002';

describe('cacl-model', () => {
  it('parses and serializes policies losslessly including macros, subtractions, scopes, time windows, and remarks', () => {
    const source = [
      'inherit off;',
      `allow [PRESET_RW, -DELETE] on docs to user("${ALICE_UUID}"), group("editors") from "2026-11-01T00:00:00Z" until "2026-12-31T23:59:59Z" remark "Editors"; # @alice`,
      `deny [READ_CONTENT] when user("${BOB_UUID}") and not perm("bypass_dacl");`,
    ].join('\n');

    const parsed = parseCaclToModel(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.document.inherit).toBe(false);
    expect(parsed.document.userHints[ALICE_UUID]).toBe('alice');
    expect(parsed.document.rules).toHaveLength(2);
    expect(parsed.document.rules[0]).toMatchObject({
      effect: 'allow',
      opItems: [
        { name: 'PRESET_RW', subtract: false },
        { name: 'DELETE', subtract: true },
      ],
      scope: 'docs',
      match: {
        kind: 'to',
        principals: [
          { kind: 'user', value: ALICE_UUID },
          { kind: 'group', value: 'editors' },
        ],
      },
      validFrom: '2026-11-01T00:00:00Z',
      validUntil: '2026-12-31T23:59:59Z',
      remark: 'Editors',
    });
    expect(parsed.document.rules[1]).toMatchObject({
      effect: 'deny',
      scope: 'all',
      match: {
        kind: 'when',
        expression: `user("${BOB_UUID}") and not perm("bypass_dacl")`,
      },
    });

    const roundTrip = serializeModelToCacl(parsed.document, { annotateUsers: true });
    expect(roundTrip).toContain('# @alice');
    const reparsed = parseCaclToModel(roundTrip);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(caclDraftFingerprint(roundTrip)).toBe(caclDraftFingerprint(source));
  });

  it('blocks switching to visual mode when syntax errors exist', () => {
    const broken = 'allow [PRESET_READ to any';
    const parsed = parseCaclToModel(broken);
    expect(parsed.ok).toBe(false);
    expect(caclDraftFingerprint(broken)).toBe('raw:allow [PRESET_READ to any');
  });

  it('extracts user annotations and updates inherit directive in place', () => {
    const annotated = `inherit on;\nallow [READ_CONTENT] to user("${ALICE_UUID}"); # @alice_ops\n`;
    expect(extractUserAnnotations(annotated)).toEqual({ [ALICE_UUID]: 'alice_ops' });
    expect(setInheritDirectiveInSource(annotated, false)).toContain('inherit off;');
    expect(setInheritDirectiveInSource('allow [READ_CONTENT] to any;\n', false)).toBe(
      'inherit off;\nallow [READ_CONTENT] to any;\n',
    );
  });

  it('handles macro and atomic operation subtraction algebra cleanly', () => {
    let items = [{ name: 'PRESET_READ', subtract: false }];
    items = toggleAtomicOpOnItems(items, 'LIST_DIRECTORY');
    expect(items).toEqual([
      { name: 'PRESET_READ', subtract: false },
      { name: 'LIST_DIRECTORY', subtract: true },
    ]);
    expect(computeRuleEffectiveMask(items) & 2).toBe(0);

    items = toggleAtomicOpOnItems(items, 'LIST_DIRECTORY');
    expect(items).toEqual([{ name: 'PRESET_READ', subtract: false }]);

    items = togglePresetMacroOnItems(
      [{ name: 'TRAVERSE', subtract: false }],
      'PRESET_READ',
    );
    expect(items).toEqual([{ name: 'PRESET_READ', subtract: false }]);
  });

  it('converts RFC 3339 timestamps and evaluates rule time window states', () => {
    const iso = '2026-11-25T12:00:00Z';
    const local = rfc3339ToLocalInput(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(localInputToRfc3339Utc(local)).toBe(iso);

    const nowMs = Date.parse('2026-11-25T12:00:00Z');
    expect(ruleTimeWindowState(null, null, nowMs)).toBe('none');
    expect(ruleTimeWindowState('2026-11-25T11:00:00Z', '2026-11-25T13:00:00Z', nowMs)).toBe('active');
    expect(ruleTimeWindowState('2026-11-25T13:00:00Z', null, nowMs)).toBe('scheduled');
    expect(ruleTimeWindowState(null, '2026-11-25T12:00:00Z', nowMs)).toBe('expired');
    expect(ruleTimeWindowState('2026-11-25T13:00:00Z', '2026-11-25T12:00:00Z', nowMs)).toBe('invalid');
  });
});
