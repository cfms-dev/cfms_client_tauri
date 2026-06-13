// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { CaCertificateStatus, CaCertificateUpdateResult, ConnectionSettings, FileEntry } from './types';

export type RootBackButtonBehavior = 'background' | 'exit';

export const ROOT_BACK_BUTTON_BEHAVIOR_KEY = 'root_back_button_behavior';
export const DEFAULT_ROOT_BACK_BUTTON_BEHAVIOR: RootBackButtonBehavior = 'background';

/** Scan a local directory recursively. */
export async function scanDirectory(
  path: string,
  pattern?: string,
): Promise<FileEntry[]> {
  return invoke("scan_directory", { path, pattern: pattern ?? null });
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

/** Read a user setting by key. */
export async function getSetting(key: string): Promise<string | null> {
  return invoke("get_setting", { key });
}

/** Write a user setting. */
export async function setSetting(key: string, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

/** Load the configured behavior for pressing Android back on a root page. */
export async function getRootBackButtonBehavior(): Promise<RootBackButtonBehavior> {
  try {
    return normalizeRootBackButtonBehavior(await getSetting(ROOT_BACK_BUTTON_BEHAVIOR_KEY));
  } catch {
    return DEFAULT_ROOT_BACK_BUTTON_BEHAVIOR;
  }
}

/** Persist the configured behavior for pressing Android back on a root page. */
export async function setRootBackButtonBehavior(behavior: RootBackButtonBehavior): Promise<void> {
  return setSetting(ROOT_BACK_BUTTON_BEHAVIOR_KEY, behavior);
}

export function normalizeRootBackButtonBehavior(
  value: string | null | undefined,
): RootBackButtonBehavior {
  return value === 'exit' ? 'exit' : DEFAULT_ROOT_BACK_BUTTON_BEHAVIOR;
}

/** Get the active backend locale. */
export async function getLocale(): Promise<string> {
  return invoke("get_locale");
}

/** Set the active frontend/backend locale. */
export async function setLocale(language: string): Promise<string> {
  return invoke("set_locale", { language });
}

/** Translate a backend Fluent message key using the active locale. */
export async function translateBackend(key: string): Promise<string> {
  return invoke("translate_backend", { key });
}

/** Load connection settings that are consumed by backend connections. */
export async function getConnectionSettings(): Promise<ConnectionSettings> {
  return invoke("get_connection_settings");
}

/** Save connection settings consumed by backend connections. */
export async function setConnectionSettings(
  settings: ConnectionSettings,
): Promise<void> {
  return invoke("set_connection_settings", { settings });
}

/** Get local CA certificate store status. */
export async function getCaCertificateStatus(): Promise<CaCertificateStatus> {
  return invoke("get_ca_certificate_status");
}

/** Check the remote CA repository and update the local CA certificate store. */
export async function updateCaCertificates(): Promise<CaCertificateUpdateResult> {
  return invoke("update_ca_certificates");
}

// ---------------------------------------------------------------------------
