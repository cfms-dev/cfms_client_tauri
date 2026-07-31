import type { AuthStatus, ServerState } from './api';

const BYPASS_LOCKDOWN_PERMISSION = 'bypass_lockdown';

/**
 * A freshly verified login must postpone its initialization when the server
 * is locked, unless the authenticated account can explicitly bypass it.
 */
export function shouldDeferPostLoginForLockdown(
  serverState: Pick<ServerState, 'lockdown'>,
  authStatus: Pick<AuthStatus, 'permissions'>,
): boolean {
  return serverState.lockdown
    && !authStatus.permissions.includes(BYPASS_LOCKDOWN_PERMISSION);
}
