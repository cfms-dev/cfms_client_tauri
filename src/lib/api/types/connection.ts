

export interface RevocationStatus {
  state: 'checking' | 'checked' | 'unknown' | 'revoked' | 'skipped';
  reasons: string[];
  checked_at: number | null;
  valid_until: number | null;
}

export interface ServerState {
  connection_id?: number | null;
  revocation?: RevocationStatus | null;
  connected: boolean;
  server_address: string | null;
  /** Human-readable display name reported by the server via server_info. */
  server_name: string | null;
  /** Wire-protocol version the connected server speaks. */
  protocol_version: number | null;
  lockdown: boolean;
  lockdown_reason: string | null;
  extension_flags: string[];
}

/** Metadata returned by the connect command after a successful server_info
 *  handshake.  Mirrors cfms_core::ServerInfo on the Rust side. */
export interface ServerInfo {
  server_name: string;
  protocol_version: number;
  lockdown: boolean;
  lockdown_reason: string | null;
  extension_flags: string[];
}

export interface ConnectionSettings {
  crl_allowed_hosts: string[];
  enable_proxy: boolean;
  follow_system_proxy: boolean;
  custom_proxy: string;
  force_ipv4: boolean;
  client_cert_path: string;
  client_key_path: string;
  remember_connection_addresses: boolean;
  recent_connection_addresses: string[];
}

export interface CaCertificateStatus {
  caDir: string;
  certificateCount: number;
  lastChecked: number | null;
}

export interface CaCertificateUpdateResult {
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  errors: string[];
  lastChecked: number | null;
}
