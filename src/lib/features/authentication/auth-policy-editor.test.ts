import { describe, expect, it } from 'vitest';
import { canCompleteChain, invalidPolicyDraft, type AuthCredential } from '$lib/features/authentication/auth-policy-editor';

const key = (id: string, identity = id, active = true): AuthCredential => ({ method: 'publickey', credential_id: id, key_identity: identity, active, label: null });
const step = (...ids: string[]) => ({ method: 'publickey', credential_ids: ids });

describe('authentication flow availability', () => {
  it('finds distinct keys even when candidate pools overlap and need reassignment', () => {
    expect(canCompleteChain([step('a', 'b'), step('a')], [key('a'), key('b')])).toBe(true);
    expect(canCompleteChain([step('a'), step('a')], [key('a')])).toBe(false);
  });
  it('counts actual key identities and ignores inactive keys', () => {
    expect(canCompleteChain([step('a'), step('alias')], [key('a'), key('alias', 'a')])).toBe(false);
    expect(canCompleteChain([step('a'), step('b')], [key('a'), key('b', 'b', false)])).toBe(false);
  });
  it('does not present repeated password or TOTP steps as usable', () => {
    for (const method of ['password', 'totp']) {
      const credential = { ...key('id'), method };
      const entry = { method, credential_ids: ['id'] };
      expect(canCompleteChain([entry], [credential])).toBe(true);
      expect(canCompleteChain([entry, entry], [credential])).toBe(false);
    }
  });
  it('blocks empty and missing selectors without banning inactive standby alternatives', () => {
    expect(invalidPolicyDraft([[step()]], [key('a')])).toBe(true);
    expect(invalidPolicyDraft([[step('missing')]], [key('a')])).toBe(true);
    expect(invalidPolicyDraft([[step('a')]], [key('a', 'a', false)])).toBe(false);
    expect(invalidPolicyDraft([], [])).toBe(false);
  });
  it('rejects duplicate alternatives irrespective of credential pool order, preserving step order', () => {
    const credentials = [key('a'), key('b')];
    expect(invalidPolicyDraft([[step('a', 'b')], [step('b', 'a')]], credentials)).toBe(true);
    expect(invalidPolicyDraft([[step('a'), step('b')], [step('b'), step('a')]], credentials)).toBe(false);
    expect(invalidPolicyDraft([[step('a')], [step('b')]], credentials)).toBe(false);
  });
});
