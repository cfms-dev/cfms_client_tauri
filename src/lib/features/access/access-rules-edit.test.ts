import { describe, expect, it } from 'vitest';
import { accessRulesDraftFingerprint, accessRulesTemplateKey } from '$lib/features/access/access-rules-edit';

describe('access rules editor baseline', () => {
  it('treats reordered JSON properties and missing empty operations as unchanged', () => {
    expect(accessRulesDraftFingerprint({
      read: [{ match: 'all', match_groups: [{ rights: { match: 'any', require: ['reader'] }, match: 'all' }] }],
    }, true)).toBe(accessRulesDraftFingerprint({
      write: [], read: [{ match_groups: [{ match: 'all', rights: { require: ['reader'], match: 'any' } }], match: 'all' }],
    }, true));
    expect(accessRulesDraftFingerprint({}, false)).toBe(accessRulesDraftFingerprint({ read: [], write: [], move: [], manage: [] }, false));
  });

  it('detects inheritance and rule changes without changing the draft', () => {
    const rules = { read: [{ match: 'all' as const, match_groups: [] }] };
    expect(accessRulesDraftFingerprint(rules, true)).not.toBe(accessRulesDraftFingerprint(rules, false));
    expect(accessRulesDraftFingerprint(rules, true)).not.toBe(accessRulesDraftFingerprint({}, true));
    expect(rules).toEqual({ read: [{ match: 'all', match_groups: [] }] });
  });
});

describe('access rules reference selection', () => {
  const targets = [
    { objectType: 'directory' as const, objectId: 'folder', name: 'Directory' },
    { objectType: 'document' as const, objectId: 'doc', name: 'Document' },
  ];
  it('uses the selected focused object with the API object type', () => {
    expect(accessRulesTemplateKey(targets, 'folder:folder')).toBe('directory:folder');
    expect(accessRulesTemplateKey(targets, 'document:doc')).toBe('document:doc');
  });
  it('uses the first object when focus is absent or outside this selection', () => {
    expect(accessRulesTemplateKey(targets, null)).toBe('directory:folder');
    expect(accessRulesTemplateKey(targets, 'folder:other')).toBe('directory:folder');
  });
  it('prefers the right-clicked object over a different focused object', () => {
    expect(accessRulesTemplateKey(targets, 'folder:folder', 'document:doc')).toBe('document:doc');
    expect(accessRulesTemplateKey(targets, 'document:doc', 'folder:folder')).toBe('directory:folder');
  });
  it('uses the selected focus when the context target is outside the selection', () => {
    expect(accessRulesTemplateKey(targets, 'document:doc', 'folder:other')).toBe('document:doc');
  });
});
