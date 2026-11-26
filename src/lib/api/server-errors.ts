import type { ServerCaclDiagnostic } from './types/access';

const SERVER_STATUS_PATTERN = /\bServer returned\s+(\d{3,4})\s*:/i;
const CORE_REJECTION_STATUS_PATTERN = /\b(?:connection rejected|server rejected request)\s*\((\d{3,4})\)\s*:/i;
const PARENTHESIZED_STATUS_PATTERN = /^\s*\((\d{3,4})\)\s+/;
const LOGIN_STATUS_PATTERN = /\bLogin failed:\s*\((\d{3,4})\)\s+/i;
const ERROR_DATA_MARKER = "\nCFMS_ERROR_DATA:";
const LOCKDOWN_STATUS = 999;

export type ServerAvailability = {
  kind: 'rate_limited' | 'server_busy';
  retryAfterSeconds: number | null;
};

/** Normalize an unknown thrown value into its string message. */
export function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Extract the server status code preserved in a Tauri command error string. */
export function serverErrorStatus(error: unknown): number | null {
  const message = extractErrorMessage(error);
  const match = message.match(SERVER_STATUS_PATTERN)
    ?? message.match(CORE_REJECTION_STATUS_PATTERN)
    ?? message.match(LOGIN_STATUS_PATTERN)
    ?? message.match(PARENTHESIZED_STATUS_PATTERN);
  if (!match) return null;

  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

/** Extract the structured data appended to a Tauri command error. */
export function serverErrorData(error: unknown): Record<string, unknown> | null {
  const message = extractErrorMessage(error);
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
  const message = extractErrorMessage(error);
  const markerIndex = message.lastIndexOf(ERROR_DATA_MARKER);
  return (markerIndex < 0 ? message : message.slice(0, markerIndex)).trimEnd();
}

/** Return the server-advised authentication retry delay, when available. */
export function serverRetryAfterSeconds(error: unknown): number | null {
  const value = serverErrorData(error)?.retry_after_seconds;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.ceil(value);
}

/** Classify protocol 22 temporary request and capacity responses. */
export function serverAvailability(error: unknown): ServerAvailability | null {
  const status = serverErrorStatus(error);
  if (status === 429) {
    return { kind: 'rate_limited', retryAfterSeconds: serverRetryAfterSeconds(error) };
  }
  if (status === 503) {
    return { kind: 'server_busy', retryAfterSeconds: serverRetryAfterSeconds(error) };
  }
  return null;
}

/** Return whether the server rejected an operation because lockdown is active. */
export function isLockdownError(error: unknown): boolean {
  return serverErrorStatus(error) === LOCKDOWN_STATUS;
}

/**
 * Access-denied errors currently arrive in two backend formats: generic server
 * actions retain the 403 status, while document downloads use an explicit
 * "Access denied" prefix. Keep this compatibility at the API boundary so UI
 * call sites do not need to inspect backend strings independently.
 */
export function isAccessDeniedError(error: unknown): boolean {
  if (serverErrorStatus(error) === 403) return true;
  const message = extractErrorMessage(error);
  return /^\s*Access denied\s*:/i.test(message);
}

export interface CaclSaveErrorDetails {
  status: 400 | 409;
  isSelfLockout: boolean;
  diagnostics: ServerCaclDiagnostic[];
}

function isServerCaclDiagnostic(value: unknown): value is ServerCaclDiagnostic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === 'string'
    && typeof record.message === 'string'
    && (record.severity === 'error' || record.severity === 'warning' || record.severity === 'info');
}

/** Extract CACL compilation diagnostics and 409 self-lockout warnings from a server error. */
export function parseCaclSaveError(error: unknown): CaclSaveErrorDetails | null {
  const status = serverErrorStatus(error);
  if (status !== 400 && status !== 409) return null;
  const data = serverErrorData(error);
  const rawDiagnostics = Array.isArray(data?.diagnostics) ? data.diagnostics : [];
  const diagnostics = rawDiagnostics.filter(isServerCaclDiagnostic);
  const isSelfLockout = status === 409 && data?.self_lockout_warning === true;
  if (!isSelfLockout && diagnostics.length === 0) return null;
  return { status, isSelfLockout, diagnostics };
}
