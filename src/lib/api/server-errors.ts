const SERVER_STATUS_PATTERN = /\bServer returned\s+(\d{3,4})\s*:/i;
const PARENTHESIZED_STATUS_PATTERN = /^\s*\((\d{3,4})\)\s+/;
const LOGIN_STATUS_PATTERN = /\bLogin failed:\s*\((\d{3,4})\)\s+/i;

/** Extract the server status code preserved in a Tauri command error string. */
export function serverErrorStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(SERVER_STATUS_PATTERN)
    ?? message.match(LOGIN_STATUS_PATTERN)
    ?? message.match(PARENTHESIZED_STATUS_PATTERN);
  if (!match) return null;

  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

/**
 * Access-denied errors currently arrive in two backend formats: generic server
 * actions retain the 403 status, while document downloads use an explicit
 * "Access denied" prefix. Keep this compatibility at the API boundary so UI
 * call sites do not need to inspect backend strings independently.
 */
export function isAccessDeniedError(error: unknown): boolean {
  if (serverErrorStatus(error) === 403) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /^\s*Access denied\s*:/i.test(message);
}
