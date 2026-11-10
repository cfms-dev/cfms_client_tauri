import { describe, expect, it } from 'vitest';
import { escalationMethods, escalationRemaining, formatEscalationRemaining } from '$lib/features/authentication/authentication';
import type { UserAuthentication } from '$lib/api';

describe('authentication policy selection', () => {
  it('keeps authorized alternatives and rejects inactive, missing, and mixed-method steps', () => {
    const inventory: UserAuthentication = {
      user_id: 'alice-id',
      methods: {
        password: { purposes: ['escalation'], schema: {}, throttle_factor: 'password', category: 'primary' },
        totp: { purposes: ['mfa', 'escalation'], schema: {}, throttle_factor: 'password', category: 'secondary' },
      },
      credentials: [
        { method: 'password', credential_id: 'p', active: true, label: null, key_identity: null },
        { method: 'totp', credential_id: 't', active: false, label: null, key_identity: null },
      ],
      policies: {
        login: { revision: 1, chains: [] }, mfa: { revision: 1, chains: [] },
        escalation: { revision: 3, chains: [
          [{ method: 'totp', credential_ids: ['t'] }],
          [{ method: 'password', credential_ids: ['missing', 'p'] }],
          [{ method: 'password', credential_ids: ['p'] }, { method: 'totp', credential_ids: ['t'] }],
          [{ method: 'password', credential_ids: ['missing'] }],
        ] },
      },
    };
    expect(escalationMethods(inventory)).toEqual(['password']);
    inventory.credentials[1].active = true;
    expect(escalationMethods(inventory)).toEqual(['totp', 'password']);
  });

  it('counts down fractional expiration against the clock and clamps expired tokens', () => {
    expect(escalationRemaining(100.125, 99_500)).toBe(1);
    expect(escalationRemaining(100.125, 100_125)).toBe(0);
    expect(escalationRemaining(null, 0)).toBe(0);
    expect(escalationRemaining(1, 2000)).toBe(0);
    expect(formatEscalationRemaining(300)).toBe('05:00');
  });
});
