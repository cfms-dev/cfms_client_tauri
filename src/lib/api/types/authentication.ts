import type { JsonValue } from './common';

export interface UserKeyMetadata {
  id: string;
  label?: string | null;
  is_preference_dek?: boolean;
  created_time?: number | null;
}

export interface UserKeyDetails extends UserKeyMetadata {
  key_id: string;
  user_id: string;
  key_content: string;
}

// ---------------------------------------------------------------------------
// Auth / Connection types
// ---------------------------------------------------------------------------

export interface AuthStatus {
  user_id: string | null;
  username: string | null;
  nickname: string | null;
  has_token: boolean;
  token_exp: number | null;
  /** Expiration read from the elevated JWT payload; tokens remain native-only. */
  escalation_exp?: number | null;
  permissions: string[];
  groups: string[];
  /** Local filesystem path to the cached user avatar. */
  avatar_path?: string | null;
  /** True when the current login response included a server-side encrypted preference DEK. */
  has_server_preference_dek?: boolean;
  /** True when this client session has a usable decrypted preference DEK. */
  has_preference_dek?: boolean;
  /** True when the post-login encryption setup phase should run DEK setup. */
  needs_preference_dek_setup?: boolean;
  /** When true, the server requires 2FA verification before completing login. */
  requires_2fa?: boolean;
  /** Methods offered by the AUTH continuation response. */
  authentication_methods?: string[];
}

export interface AuthPolicyStep {
  method: string;
  credential_ids: string[];
}

export type AuthPurpose = 'login' | 'mfa' | 'escalation';

export interface AuthPolicy { revision: number; chains: AuthPolicyStep[][] }

export interface AuthPolicyReplacement {
  purpose: AuthPurpose;
  expected_revision: number;
  chains: AuthPolicyStep[][];
}

export interface UserAuthentication {
  user_id: string;
  methods: Record<string, { purposes: AuthPurpose[]; schema: JsonValue; category: string; throttle_factor: string }>;
  credentials: { method: string; credential_id: string; active: boolean; label: string | null; key_identity: string | null }[];
  policies: Record<AuthPurpose, AuthPolicy>;
}

export interface TwoFactorStatus {
  /** TOTP credential registration, independent of the account's MFA policy. */
  configured: boolean;
  enabled: boolean;
  backup_codes_count: number;
}

export interface TwoFactorSetup {
  secret: string;
  provisioning_uri: string;
  backup_codes: string[];
}
