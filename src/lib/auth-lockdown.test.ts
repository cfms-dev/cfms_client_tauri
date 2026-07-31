import { describe, expect, it } from 'vitest';
import { shouldDeferPostLoginForLockdown } from './auth-lockdown';

describe('post-login lockdown gating', () => {
  it('defers initialization for a locked server without bypass permission', () => {
    expect(shouldDeferPostLoginForLockdown(
      { lockdown: true },
      { permissions: ['list_directory'] },
    )).toBe(true);
  });

  it('allows a user with bypass permission to finish initialization', () => {
    expect(shouldDeferPostLoginForLockdown(
      { lockdown: true },
      { permissions: ['bypass_lockdown'] },
    )).toBe(false);
  });

  it('allows ordinary initialization when lockdown is inactive', () => {
    expect(shouldDeferPostLoginForLockdown(
      { lockdown: false },
      { permissions: [] },
    )).toBe(false);
  });
});
