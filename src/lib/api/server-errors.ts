const SERVER_STATUS_PATTERN = /\bServer returned\s+(\d{3,4})\s*:/i;
const PARENTHESIZED_STATUS_PATTERN = /^\s*\((\d{3,4})\)\s+/;
const LOGIN_STATUS_PATTERN = /\bLogin failed:\s*\((\d{3,4})\)\s+/i;
const ERROR_DATA_MARKER = "\nCFMS_ERROR_DATA:";

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

/** Extract the structured data appended to a Tauri command error. */
export function serverErrorData(error: unknown): Record<string, unknown> | null {
  const message = error instanceof Error ? error.message : String(error);
  const markerIndex = message.lastIndexOf(ERROR_DATA_MARKER);
  if (markerIndex < 0) return null;

  try {
    const data = JSON.parse(message.slice(markerIndex + ERROR_DATA_MARKER.length));
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** Return the human-readable portion without the structured metadata suffix. */
export function serverErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const markerIndex = message.lastIndexOf(ERROR_DATA_MARKER);
  return (markerIndex < 0 ? message : message.slice(0, markerIndex)).trimEnd();
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
