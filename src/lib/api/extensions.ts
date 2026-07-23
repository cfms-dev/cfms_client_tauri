import { invoke } from '@tauri-apps/api/core';

export type ExtensionCapability =
  | 'files.metadata.read'
  | 'files.list'
  | 'files.search'
  | 'tasks.read'
  | 'transfers.download.enqueue'
  | 'account.summary.read'
  | 'preferences.read'
  | 'preferences.write'
  | 'events.subscribe'
  | 'ui.confirm'
  | 'ui.notify';

export type ExtensionBackgroundTrigger =
  | { type: 'on_enable'; workflow: string }
  | { type: 'on_login'; workflow: string }
  | { type: 'interval'; workflow: string; minutes: number }
  | { type: 'event'; workflow: string; event: string };

export interface ExtensionNavigationEntry {
  id: string;
  label: string;
  icon: string;
  page: string;
}

export interface ExtensionManifest {
  schema_version: number;
  id: string;
  name: string;
  description: string;
  publisher: string;
  version: string;
  host_api: string;
  min_client_version: string;
  platforms: string[];
  entrypoints: {
    navigation: ExtensionNavigationEntry[];
    settings: Array<{ id: string; label: string; page: string }>;
    workflows: Array<{ id: string; label: string; workflow: string }>;
  };
  requested_capabilities: ExtensionCapability[];
  background_triggers: ExtensionBackgroundTrigger[];
  content_hashes: Record<string, string>;
}

export interface ExtensionInstallation {
  manifest: ExtensionManifest;
  package_digest: string;
  install_epoch: string;
  state: 'installed' | 'error' | 'suspended' | string;
  installed_at: number;
  previous_version: string | null;
  last_error: string | null;
  disk_bytes: number;
}

export interface ExtensionAccountState {
  enabled: boolean;
  installEpoch: string;
  grantedCapabilities: ExtensionCapability[];
  settings: unknown;
  staleInstallation: boolean;
}

export interface CatalogExtension {
  manifest: ExtensionManifest;
  download_url: string;
  sha256: string;
  signature: string;
  key_id: string;
  revoked: boolean;
  revocation_reason: string | null;
}

export interface ExtensionCatalog {
  schema_version: number;
  generated_at: number;
  extensions: CatalogExtension[];
}

export interface ExtensionOverview {
  installed: ExtensionInstallation[];
  accountStates: Record<string, ExtensionAccountState>;
  catalog: ExtensionCatalog | null;
  trustedKeysConfigured: boolean;
  hostApiVersion: string;
}

export interface DeclarativePage {
  schema_version: number;
  title: string;
  description?: string;
  blocks: DeclarativeBlock[];
}

export type DeclarativeBlock =
  | { type: 'text'; text: string; style?: 'body' | 'caption' | 'heading' }
  | { type: 'status_card'; title: string; value: string; description?: string; tone?: 'default' | 'success' | 'warning' | 'danger' }
  | { type: 'alert'; title?: string; message: string; tone?: 'info' | 'success' | 'warning' | 'danger' }
  | { type: 'progress'; label: string; value: number; max?: number }
  | { type: 'list'; title?: string; items: Array<{ title: string; description?: string; value?: string }> }
  | { type: 'table'; title?: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>> }
  | { type: 'empty_state'; title: string; description?: string }
  | { type: 'form'; id: string; fields: Array<{ id: string; label: string; type: 'text' | 'number' | 'toggle' | 'select'; options?: string[]; default?: unknown }> }
  | { type: 'actions'; actions: Array<{ id: string; label: string; workflow: string; tone?: 'primary' | 'secondary' | 'danger' }> };

export interface DeclarativeWorkflow {
  schema_version: number;
  start: string;
  nodes: Array<Record<string, unknown> & { id: string; type: string }>;
}

export function getExtensionOverview(): Promise<ExtensionOverview> {
  return invoke('get_extension_overview');
}

export function importExtensionPackage(path: string): Promise<ExtensionInstallation> {
  return invoke('import_extension_package', { path });
}

export function refreshExtensionCatalog(): Promise<ExtensionCatalog> {
  return invoke('refresh_extension_catalog');
}

export function installExtensionFromCatalog(extensionId: string): Promise<ExtensionInstallation> {
  return invoke('install_extension_from_catalog', { extensionId });
}

export function rollbackExtension(extensionId: string): Promise<ExtensionInstallation> {
  return invoke('rollback_extension', { extensionId });
}

export function uninstallExtension(extensionId: string): Promise<void> {
  return invoke('uninstall_extension', { extensionId });
}

export function setExtensionEnabled(
  extensionId: string,
  enabled: boolean,
  grantedCapabilities: ExtensionCapability[],
): Promise<void> {
  return invoke('set_extension_enabled', { extensionId, enabled, grantedCapabilities });
}

export function readExtensionPage(extensionId: string, page: string): Promise<DeclarativePage> {
  return invoke('read_extension_page', { extensionId, page });
}

export function readExtensionWorkflow(extensionId: string, workflow: string): Promise<DeclarativeWorkflow> {
  return invoke('read_extension_workflow', { extensionId, workflow });
}

export function executeExtensionHostCall<T = unknown>(
  extensionId: string,
  capability: ExtensionCapability,
  args: unknown = {},
  userConfirmed?: boolean,
): Promise<T> {
  return invoke('execute_extension_host_call', {
    extensionId,
    capability,
    arguments: args,
    userConfirmed,
  });
}
