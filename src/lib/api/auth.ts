// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { AuthStatus, ServerInfo, ServerState, TwoFactorSetup, TwoFactorStatus } from './types';

/** Log in with username + password. Derives KEK via PBKDF2 on the Rust side.
 *
 * If the server requires 2FA (code 202), the returned `AuthStatus` will have
 * `requires_2fa: true`.  The caller should then prompt the user for a
 * verification code and re-invoke this function with `twofaToken`.
 */
export async function login(
  username: string,
  password: string,
  twofaToken?: string,
): Promise<AuthStatus> {
  return invoke("login", { username, password, twofaToken: twofaToken ?? null });
}

/** Change the current user's password via the server `set_passwd` action.
 *
 * Used for the self-change flow when the server rejects login with code
 * 4001/4002 (password must be changed before login).  No authentication token
 * is required — the server verifies `oldPassword` directly.  Throws with the
 * server's `(code) message` on failure (e.g. password-rule violations).
 */
export async function changePassword(
  username: string,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  return invoke("change_password", { username, oldPassword, newPassword });
}

/** Recover a server-returned encrypted preference DEK with a previous password,
 * then rewrap it with the password used for the current login session. */
export async function recoverPreferenceDek(
  recoveryPassword: string,
  currentPassword: string,
): Promise<void> {
  return invoke("recover_preference_dek", { recoveryPassword, currentPassword });
}

/** Log out — clears auth state and closes the connection. */
export async function logout(): Promise<void> {
  return invoke("logout");
}

/** Clear auth state while preserving the current server connection. */
export async function clearAuthSession(): Promise<void> {
  return invoke("clear_auth_session");
}

/** Request the native shell to terminate the application. */
export async function quitApplication(): Promise<void> {
  return invoke("quit_application");
}

/** Establish WSS connection to a CFMS server and perform the initial
 *  server_info handshake.
 *
 *  Returns [`ServerInfo`] on success.  Throws with a specially-formatted
 *  error string on protocol version mismatch:
 *
 *  - `"server_update_required:<server_ver>:<client_ver>"` — server is newer.
 *  - `"server_too_old:<server_ver>:<client_ver>"` — server is too old.
 */
export async function connect(
  url: string,
  disableSslEnforcement: boolean,
): Promise<ServerInfo> {
  return invoke("connect", {
    url,
    disableSslEnforcement,
  });
}

/** Close the WSS connection. */
export async function disconnect(): Promise<void> {
  return invoke("disconnect");
}

/** Get the current authentication status (username, token, permissions, etc.). */
export async function getAuthStatus(): Promise<AuthStatus> {
  return invoke("get_auth_status");
}

/** Get the current server-connection state (connected, address, lockdown). */
export async function getServerState(): Promise<ServerState> {
  return invoke("get_server_state");
}

/** Get the authenticated user's two-factor authentication status. */
export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  return invoke("get_2fa_status");
}

/** Start TOTP setup for the authenticated user. */
export async function setupTwoFactor(): Promise<TwoFactorSetup> {
  return invoke("setup_2fa");
}

/** Verify the TOTP setup code and enable two-factor authentication. */
export async function validateTwoFactor(token: string): Promise<void> {
  return invoke("validate_2fa", { token });
}

/** Cancel a pending TOTP setup before verification. */
export async function cancelTwoFactorSetup(): Promise<void> {
  return invoke("cancel_2fa_setup");
}

/** Disable two-factor authentication for the authenticated user. */
export async function disableTwoFactor(password: string): Promise<void> {
  return invoke("disable_2fa", { password });
}

// ---------------------------------------------------------------------------
