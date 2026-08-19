import { describe, expect, it } from 'vitest';
import { compareAppVersions, normalizeAppVersion, parseAppVersion } from './app-version';

describe('app version helpers', () => {
  it('compares stable and prerelease versions using SemVer precedence', () => {
    expect(compareAppVersions('v0.43.0', '0.42.9')).toBeGreaterThan(0);
    expect(compareAppVersions('0.43.0', '0.43.0-rc.2')).toBeGreaterThan(0);
    expect(compareAppVersions('0.43.0-beta.2', '0.43.0-beta.11')).toBeLessThan(0);
    expect(compareAppVersions('0.43.0+desktop', 'v0.43.0+android')).toBe(0);
  });

  it('parses valid versions and rejects partial versions', () => {
    expect(parseAppVersion('v1.2.3-alpha.4')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['alpha', 4],
    });
    expect(parseAppVersion('1.2')).toBeNull();
  });

  it('normalizes a leading release tag prefix', () => {
    expect(normalizeAppVersion(' v0.43.0 ')).toBe('0.43.0');
  });
});
