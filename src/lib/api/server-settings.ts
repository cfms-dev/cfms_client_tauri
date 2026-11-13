import { invoke } from '@tauri-apps/api/core';
import type { ServerSettingChange, ServerSettingDefinition, ServerSettingsValues } from './types/server-settings';

export function listServerSettings(namespace?: string): Promise<{ items: ServerSettingDefinition[] }> {
  return invoke('list_server_settings', { namespace: namespace ?? null });
}
export function getServerSettings(namespace: string, keys?: string[]): Promise<ServerSettingsValues> {
  return invoke('get_server_settings', { namespace, keys: keys ?? null });
}
export function updateServerSettings(namespace: string, changes: Record<string, ServerSettingChange>): Promise<ServerSettingsValues> {
  return invoke('update_server_settings', { namespace, changes });
}
