import { describe, expect, it } from 'vitest';
import {
  isAccessDeniedError,
  isLockdownError,
  serverErrorData,
  serverErrorMessage,
  serverErrorStatus,
  serverAvailability,
  serverRetryAfterSeconds,
} from './server-errors';

describe('server errors', () => {
  it('extracts status codes from generic server command failures', () => {
    expect(serverErrorStatus('Server returned 403: permission denied')).toBe(403);
    expect(serverErrorStatus(new Error('(404) missing'))).toBe(404);
    expect(serverErrorStatus('Login failed: (4003) User account is not active')).toBe(4003);
  });

  it('extracts structured server error data without exposing it as display copy', () => {
    const error = 'Login failed: (4003) User account is not active\nCFMS_ERROR_DATA:{"reason":"Policy violation"}';
    expect(serverErrorStatus(error)).toBe(4003);
    expect(serverErrorData(error)).toEqual({ reason: 'Policy violation' });
    expect(serverErrorData('Login failed: (4003) User account is not active')).toBeNull();
    expect(serverErrorData('failure\nCFMS_ERROR_DATA:not-json')).toBeNull();
    expect(serverErrorData(
      'Login failed: (429) Too many attempts\nCFMS_ERROR_DATA:{"retry_after_seconds":45}',
    )).toEqual({ retry_after_seconds: 45 });
  });

  it('recognizes both directory and document access-denied formats', () => {
    expect(isAccessDeniedError('Server returned 403: permission denied')).toBe(true);
    expect(isAccessDeniedError(new Error('Access denied: permission denied'))).toBe(true);
  });

  it('keeps structured metadata out of user-facing error text', () => {
    expect(serverErrorMessage(
      'Login failed: (429) Too many attempts\nCFMS_ERROR_DATA:{"retry_after_seconds":45}',
    )).toBe('Login failed: (429) Too many attempts');
  });

  it('recognizes lockdown responses and preserves their reason as metadata', () => {
    const error = 'Server returned 999: lockdown\nCFMS_ERROR_DATA:{"status":true,"reason":"Emergency maintenance"}';
    expect(isLockdownError(error)).toBe(true);
    expect(serverErrorData(error)).toEqual({
      status: true,
      reason: 'Emergency maintenance',
    });
    expect(serverErrorMessage(error)).toBe('Server returned 999: lockdown');
    expect(isLockdownError('Server returned 500: failure')).toBe(false);
  });

  it('reads and validates the retry delay from throttling errors', () => {
    expect(serverRetryAfterSeconds(
      'Login failed: (429) Too many attempts\nCFMS_ERROR_DATA:{"retry_after_seconds":45.2}',
    )).toBe(46);
    expect(serverRetryAfterSeconds('failure\nCFMS_ERROR_DATA:{"retry_after_seconds":0}')).toBeNull();
    expect(serverRetryAfterSeconds('failure\nCFMS_ERROR_DATA:{"retry_after_seconds":"45"}')).toBeNull();
  });

  it('classifies protocol 22 rate and capacity responses', () => {
    expect(serverAvailability(
      'Server returned 429: slow down\nCFMS_ERROR_DATA:{"retry_after_seconds":8}',
    )).toEqual({ kind: 'rate_limited', retryAfterSeconds: 8 });
    expect(serverAvailability('Server returned 503: busy')).toEqual({
      kind: 'server_busy',
      retryAfterSeconds: null,
    });
    expect(serverAvailability('Server returned 403: denied')).toBeNull();
  });

  it('does not consume unrelated server and connection failures', () => {
    expect(isAccessDeniedError('Server returned 404: missing')).toBe(false);
    expect(isAccessDeniedError('Failed to create stream for list_directory')).toBe(false);
    expect(isAccessDeniedError('Permission denied while reading local cache')).toBe(false);
  });
});
