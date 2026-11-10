import { describe, expect, it } from 'vitest';
import { normalizeAccessRules, parseAccessRulesJson, validateAccessRules } from '$lib/features/access/access-rules';

describe('access rule source validation', () => {
  it.each(['null', '[]', 'true', '"rules"', '{"read":null}', '{"delete":[]}',
    '{"read":[{}]}', '{"read":[{"match":"none","match_groups":[]}]}',
    '{"read":[{"match":"all","match_groups":[{"groups":{"require":[1]}}]}]}',
    '{"read":[{"match":"all","match_groups":[{"typo":true}]}]}',
    '{"read":[{"match":"all","match_groups":[],"typo":true}]}',
    '{"read":[{"match":"all","match_groups":[{"rights":{"typo":true}}]}]}',
  ])('rejects invalid source before normalization: %s', (source) => {
    expect(() => parseAccessRulesJson(source)).toThrow(TypeError);
  });

  it('accepts empty rules and valid server-supported optional subgroup fields', () => {
    expect(parseAccessRulesJson('')).toEqual(normalizeAccessRules({}));
    expect(() => validateAccessRules({
      read: [{ match: 'all', match_groups: [{ rights: { require: ['read_document'] } }] }],
    })).not.toThrow();
  });

  it('retains all four operations and valid conditions in the parsed draft', () => {
    const rules = { manage: [{ match: 'any', match_groups: [{ match: 'all', groups: { match: 'any', require: ['staff'] } }] }] };
    expect(parseAccessRulesJson(JSON.stringify(rules))).toEqual({ read: [], write: [], move: [], ...rules });
  });
});
