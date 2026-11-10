import type { AuthPolicy, AuthPolicyReplacement, AuthPolicyStep, AuthPurpose, UserAuthentication } from '$lib/api/types';

export const AUTH_PURPOSES: AuthPurpose[] = ['login', 'mfa', 'escalation'];

/** Send only edited purposes with the revisions from the loaded snapshot. */
export function changedAuthPolicies(
  original: Record<AuthPurpose, AuthPolicy>,
  draft: Record<AuthPurpose, AuthPolicyStep[][]>,
): AuthPolicyReplacement[] {
  return AUTH_PURPOSES.filter((purpose) => JSON.stringify(original[purpose].chains) !== JSON.stringify(draft[purpose]))
    .map((purpose) => ({ purpose, expected_revision: original[purpose].revision, chains: draft[purpose] }));
}

export type AuthCredential = UserAuthentication['credentials'][number];

export function authMethodName(method: string, translate: (key: string) => string): string {
  return method === 'totp' ? translate('authManagement.totpName')
    : ['password', 'publickey'].includes(method) ? translate(`authentication.${method}`) : method;
}

export function shortKeyIdentity(value: string): string {
  return value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

export function credentialName(credential: AuthCredential, methodName: string): string {
  return credential.label || (credential.method === 'publickey'
    ? `${methodName} · ${shortKeyIdentity(credential.key_identity || credential.credential_id)}`
    : methodName);
}

/** Match actual key identities, allowing overlapping candidate pools between steps. */
export function canCompleteChain(chain: AuthPolicyStep[], credentials: AuthCredential[]): boolean {
  if (!chain.length || chain.some((step) => step.method !== chain[0].method)) return false;
  const active = credentials.filter((credential) => credential.active);
  const pools = chain.map((step) => active.filter((credential) => credential.method === step.method && step.credential_ids.includes(credential.credential_id)));
  if (pools.some((pool) => !pool.length)) return false;
  if (chain[0].method !== 'publickey') return chain.length === 1 || !['password', 'totp', 'oidc'].includes(chain[0].method);
  const assignments = new Map<string, number>();
  function assign(position: number, visited: Set<string>): boolean {
    for (const credential of pools[position]) {
      const identity = credential.key_identity;
      if (!identity || visited.has(identity)) continue;
      visited.add(identity);
      const previous = assignments.get(identity);
      if (previous === undefined || assign(previous, visited)) {
        assignments.set(identity, position);
        return true;
      }
    }
    return false;
  }
  return chain.every((_, position) => assign(position, new Set()));
}

export function hasDuplicateAuthChains(chains: AuthPolicyStep[][]): boolean {
  const identities = chains.map((chain) => JSON.stringify(chain.map((step) => ({
    method: step.method, credential_ids: [...new Set(step.credential_ids)].sort(),
  }))));
  return new Set(identities).size !== identities.length;
}

export function invalidPolicyDraft(chains: AuthPolicyStep[][], credentials: AuthCredential[]): boolean {
  return hasDuplicateAuthChains(chains)
    || chains.some((chain) => !chain.length || chain.some((step) => !step.credential_ids.length
    || step.credential_ids.some((id) => !credentials.some((credential) => credential.credential_id === id && credential.method === step.method))));
}
