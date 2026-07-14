import { describe, expect, it } from 'vitest';
import { isAccessDeniedError, serverErrorStatus } from './server-errors';

describe('server errors', () => {
  it('extracts status codes from generic server command failures', () => {
    expect(serverErrorStatus('Server returned 403: permission denied')).toBe(403);
    expect(serverErrorStatus(new Error('(404) missing'))).toBe(404);
  });

  it('recognizes both directory and document access-denied formats', () => {
    expect(isAccessDeniedError('Server returned 403: permission denied')).toBe(true);
    expect(isAccessDeniedError(new Error('Access denied: permission denied'))).toBe(true);
  });

  it('does not consume unrelated server and connection failures', () => {
    expect(isAccessDeniedError('Server returned 404: missing')).toBe(false);
    expect(isAccessDeniedError('Failed to create stream for list_directory')).toBe(false);
    expect(isAccessDeniedError('Permission denied while reading local cache')).toBe(false);
  });
});
