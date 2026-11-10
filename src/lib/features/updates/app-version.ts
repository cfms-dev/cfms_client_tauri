export interface ParsedAppVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<number | string>;
}

const appVersionPattern = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

export function compareAppVersions(left: string, right: string): number {
  const parsedLeft = parseAppVersion(left);
  const parsedRight = parseAppVersion(right);
  if (!parsedLeft || !parsedRight) return left.trim().localeCompare(right.trim());

  for (const key of ['major', 'minor', 'patch'] as const) {
    if (parsedLeft[key] !== parsedRight[key]) return parsedLeft[key] > parsedRight[key] ? 1 : -1;
  }

  if (parsedLeft.prerelease.length === 0 || parsedRight.prerelease.length === 0) {
    if (parsedLeft.prerelease.length === parsedRight.prerelease.length) return 0;
    return parsedLeft.prerelease.length === 0 ? 1 : -1;
  }

  const identifierCount = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = parsedLeft.prerelease[index];
    const rightIdentifier = parsedRight.prerelease[index];
    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      if (leftIdentifier === rightIdentifier) return 0;
      return leftIdentifier === undefined ? -1 : 1;
    }
    if (leftIdentifier === rightIdentifier) continue;
    if (typeof leftIdentifier === 'number' && typeof rightIdentifier === 'number') {
      return leftIdentifier > rightIdentifier ? 1 : -1;
    }
    if (typeof leftIdentifier === 'number') return -1;
    if (typeof rightIdentifier === 'number') return 1;
    return leftIdentifier.localeCompare(rightIdentifier);
  }

  return 0;
}

export function parseAppVersion(value: string): ParsedAppVersion | null {
  const match = value.trim().match(appVersionPattern);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
      ? match[4].split('.').map((identifier) => /^\d+$/u.test(identifier) ? Number(identifier) : identifier)
      : [],
  };
}

export function normalizeAppVersion(value: string): string {
  return value.trim().replace(/^v/u, '');
}
