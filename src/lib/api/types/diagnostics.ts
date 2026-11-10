

export interface ServiceStatusInfo {
  name: string;
  running: boolean;
}

/** Permission-protected static server diagnostics introduced in protocol 22. */
export interface ServerDiagnostics {
  schema_version: 1;
  server: {
    server_name: string;
    core_version: string;
    protocol_version: number;
    debug_configured: boolean;
  };
  runtime: {
    python_implementation: string;
    python_version: string;
    openssl_version: string;
    operating_system: string;
    operating_system_release: string;
    architecture: string;
  };
  component_versions: Record<string, string>;
  database: {
    dialect: string;
    driver: string;
  };
  providers: {
    storage: string;
    caching: string;
    event_bus: string;
    rate_limit: string;
    scheduling: string;
  };
  scheduling: {
    available: boolean;
    mode: string;
    detail: string | null;
  };
  extensions: Array<{
    identifier: string;
    name: string;
    version: string;
  }>;
  extension_flags: string[];
  lockdown: {
    enabled: boolean;
    reason: string | null;
  };
}
