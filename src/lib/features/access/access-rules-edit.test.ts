import { describe, expect, it } from 'vitest';
import { accessRulesDraftFingerprint, accessRulesTemplateKey } from '$lib/features/access/access-rules-edit';

describe('access rules editor baseline', () => {
  it('treats whitespace differences and @username annotations as unchanged', () => {
    const plain = 'inherit on;\nallow [PRESET_READ] to user("00000000-0000-4000-8000-000000000001");\n';
    const annotated = 'inherit on;\n  allow [PRESET_READ] to user("00000000-0000-4000-8000-000000000001"); # @alice\n';
    expect(accessRulesDraftFingerprint(plain)).toBe(accessRulesDraftFingerprint(annotated));
  });

  it('detects semantic inheritance and rule changes', () => {
    const base = 'inherit on;\nallow [PRESET_READ] to any;\n';
    const inheritOff = 'inherit off;\nallow [PRESET_READ] to any;\n';
    const deny = 'inherit on;\ndeny [PRESET_READ] to any;\n';
    expect(accessRulesDraftFingerprint(base)).not.toBe(accessRulesDraftFingerprint(inheritOff));
    expect(accessRulesDraftFingerprint(base)).not.toBe(accessRulesDraftFingerprint(deny));
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
