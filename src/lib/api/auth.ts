// CFMS Client - typed Tauri IPC wrappers.
import { Channel, invoke } from '@tauri-apps/api/core';
import type { AuthPolicy, AuthPolicyReplacement, AuthPurpose, AuthStatus, TwoFactorSetup, TwoFactorStatus, UserAuthentication } from './types/authentication';
import type { JsonValue } from './types/common';
import type { ServerInfo, ServerState } from './types/connection';

/** Log in with username + password. Derives KEK via PBKDF2 on the Rust side.
 *
 * If the server requires 2FA (code 202), the returned `AuthStatus` will have
 * `requires_2fa: true`.  The caller should then prompt the user for a
 * verification code and call `completeLoginMfa` with the offered method.
 */
export async function login(
  username: string,
  password: string,
): Promise<AuthStatus> {
  return invoke("login", { username, password });
}

export async function completeLoginMfa(method: string, data: Record<string, JsonValue>): Promise<AuthStatus> {
  return invoke('complete_login_mfa', { method, data });
}

export interface AuthPrivateKeyInfo {
  keyRef: string;
  filename: string;
  algorithm: string;
  fingerprint: string;
  encrypted: boolean;
}
export type PublicKeyInteraction = { kind: 'signing' } | { kind: 'select_key'; interaction_id: string };
export const pickAuthPrivateKey = (): Promise<AuthPrivateKeyInfo | null> => invoke('pick_auth_private_key');
export const releaseAuthPrivateKey = (keyRef: string): Promise<void> => invoke('release_auth_private_key', { keyRef });
export const cancelPublicKeyAuthentication = (): Promise<void> => invoke('cancel_public_key_authentication');
export const respondPublicKeyInteraction = (interactionId: string, keyRef: string, passphrase: string): Promise<void> =>
  invoke('respond_public_key_interaction', { interactionId, keyRef, passphrase });
export function loginWithPublicKey(username: string, keyRef: string, passphrase: string, onInteraction: (event: PublicKeyInteraction) => void, mfa = false): Promise<AuthStatus> {
  const channel = new Channel<PublicKeyInteraction>();
  channel.onmessage = onInteraction;
  return invoke('login_with_public_key', { username, keyRef, passphrase, onInteraction: channel, mfa });
}
export const preparePreferenceUnlock = (): Promise<'ready' | 'password_required'> => invoke('prepare_preference_unlock');
export const unlockPreferenceDek = (password: string): Promise<void> => invoke('unlock_preference_dek', { password });
/** Discard this account's local encrypted data and create a device-only key. */
export const discardLockedPreferenceData = (): Promise<void> => invoke('discard_locked_preference_data');

export async function getUserAuthentication(userId?: string): Promise<UserAuthentication> {
  return invoke('get_user_authentication', { userId: userId ?? null });
}

export async function setUserAuthPolicies(policies: AuthPolicyReplacement[], userId?: string): Promise<{ policies: Partial<Record<AuthPurpose, AuthPolicy>> }> {
  return invoke('set_user_auth_policies', { policies, userId: userId ?? null });
}

export async function registerUserAuthPublicKey(publicKey: string, label: string | null, userId?: string): Promise<{ credential_id: string; fingerprint: string; label: string | null }> {
  return invoke('register_user_auth_public_key', { publicKey, label, userId: userId ?? null });
}

export async function updateUserAuthPublicKey(credentialId: string, label: string | null, userId?: string): Promise<{ credential_id: string; label: string | null }> {
  return invoke('update_user_auth_public_key', { credentialId, label, userId: userId ?? null });
}

export async function deleteUserAuthPublicKey(credentialId: string, userId?: string): Promise<{ credential_id: string }> {
  return invoke('delete_user_auth_public_key', { credentialId, userId: userId ?? null });
}

export async function dropEscalation(): Promise<AuthStatus> {
  return invoke('drop_escalation');
}

export async function requestEscalation(method?: string, data?: Record<string, JsonValue>): Promise<AuthStatus> {
  return invoke('request_escalation', { method: method ?? null, data: data ?? null });
}

/** Change the current account's password using elevation or native POST_AUTH. */
export async function changePassword(username: string, newPassword: string): Promise<void> {
  return invoke('change_password', { username, newPassword });
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
 *  - `"server_update_required:<server_ver>:<max_supported_ver>"` — server is newer.
 *  - `"server_too_old:<server_ver>:<min_supported_ver>"` — server is too old.
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

/** Cancel the WSS connection attempt currently in progress. */
export async function cancelConnect(): Promise<boolean> {
  return invoke("cancel_connect");
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

/** Get the authenticated user's TOTP credential status. */
export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  return invoke("get_2fa_status");
}

/** Start TOTP setup for the authenticated user. */
export async function setupTwoFactor(): Promise<TwoFactorSetup> {
  return invoke("setup_2fa");
}

/** Activate the TOTP credential without changing authentication policies. */
export async function validateTwoFactor(token: string): Promise<void> {
  return invoke("validate_2fa", { token });
}

/** Cancel a pending TOTP setup before verification. */
export async function cancelTwoFactorSetup(): Promise<void> {
  return invoke("cancel_2fa_setup");
}

/** Delete the authenticated user's TOTP credential and prune its policy references. */
export async function disableTwoFactor(password: string): Promise<void> {
  return invoke("disable_2fa", { password });
}

// ---------------------------------------------------------------------------
