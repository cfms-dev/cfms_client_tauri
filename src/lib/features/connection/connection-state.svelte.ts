import type { ServerState, ServerInfo, RevocationStatus } from "$lib/api/types";

class ServerStateStoreImpl {
  connectionId = $state<number | null>(null);
  revocation = $state<RevocationStatus | null>(null);
  remoteAddress = $state<string | null>(null);
  serverName = $state<string | null>(null);
  protocolVersion = $state<number | null>(null);
  connected = $state(false);
  lockdown = $state(false);
  lockdownReason = $state<string | null>(null);
  extensionFlags = $state<string[]>([]);

  /** Update connection-related server state.
   *
   *  Accepts raw values only — this store has no knowledge of auth types. */
  updateConnection(connected: boolean, address: string | null, lockdown: boolean) {
    this.connected = connected;
    this.remoteAddress = address;
    this.lockdown = lockdown;
  }

  /** Apply a full ServerState snapshot from the backend. */
  apply(s: ServerState) {
    this.connectionId = s.connection_id ?? null;
    this.revocation = s.revocation ?? null;
    this.connected = s.connected;
    this.remoteAddress = s.server_address;
    this.serverName = s.server_name ?? this.serverName;
    this.protocolVersion = s.protocol_version ?? this.protocolVersion;
    this.lockdown = s.lockdown;
    this.lockdownReason = s.lockdown_reason;
    this.extensionFlags = [...(s.extension_flags ?? [])];
  }

  /** Apply server info from the connect command response. */
  applyServerInfo(info: ServerInfo) {
    this.serverName = info.server_name;
    this.protocolVersion = info.protocol_version;
    this.lockdown = info.lockdown;
    this.lockdownReason = info.lockdown_reason;
    this.extensionFlags = [...(info.extension_flags ?? [])];
    this.connected = true;
  }

  /** Reset all server state to defaults (on disconnect). */
  clear() {
    this.connectionId = null;
    this.revocation = null;
    this.remoteAddress = null;
    this.serverName = null;
    this.protocolVersion = null;
    this.connected = false;
    this.lockdown = false;
    this.lockdownReason = null;
    this.extensionFlags = [];
  }
}

export const serverStateStore = new ServerStateStoreImpl();
