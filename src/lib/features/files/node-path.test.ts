import { describe, expect, it } from 'vitest';
import { encodeNodePathSegment, formatAbsoluteNodePath, knownAbsoluteNodePath } from './node-path';
describe('node address presentation', () => {
  it('escapes percent before slash and preserves readable names', () => {
    expect(formatAbsoluteNodePath(['项目 A', 'teams/security', '100%', '%2F'])).toBe('/项目 A/teams%2Fsecurity/100%25/%252F');
    expect(encodeNodePathSegment('%/')).toBe('%25%2F');
  });
  it('only presents absolute paths from known root navigation', () => {
    expect(formatAbsoluteNodePath([])).toBe('/');
    expect(knownAbsoluteNodePath(null, ['Projects'])).toBe('/Projects');
    expect(knownAbsoluteNodePath('search-root', ['Projects'])).toBeNull();
  });
});
