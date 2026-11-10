import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';

const keys = new Set(['invalidFile', 'unsupportedAlgorithm', 'wrongPassphrase', 'signingFailed', 'selectAgain', 'cancelled', 'busy', 'expired', 'invalidChallenge', 'storageUnavailable', 'storageInvalidated', 'migrationFailed', 'missingRecoveryKey', 'discardFailed']);
export function publicKeyError(error: unknown, translate: (key: string) => string): string {
  const value = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return value.startsWith('publicKey.') && keys.has(value.slice(10)) ? translate(value) : formatUserFacingError(error);
}
