import type { UserAuthentication } from '$lib/api/types';

export const supportedVerificationMethods = ['totp', 'password'];

/** Preserve ordered OR alternatives, requiring every referenced step to be usable. */
export function escalationMethods(authentication: UserAuthentication): string[] {
  const active = new Map(authentication.credentials.filter((c) => c.active).map((c) => [c.credential_id, c.method]));
  return [...new Set(authentication.policies.escalation.chains
    .filter((chain) => chain.length > 0 && chain.every((step) =>
      step.method === chain[0].method
        && authentication.methods[step.method]?.purposes.includes('escalation')
        && step.credential_ids.some((id) => active.get(id) === step.method),
    ))
    .map((chain) => chain[0].method))];
}

export function escalationRemaining(expiry: number | null, now: number): number {
  return expiry === null ? 0 : Math.max(0, Math.ceil(expiry - now / 1000));
}

export function formatEscalationRemaining(seconds: number): string {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}
