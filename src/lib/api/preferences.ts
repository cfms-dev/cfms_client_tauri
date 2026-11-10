// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { AppearancePreference, UserPreference, RecentVisitPreferenceRecord } from './types/settings';

export type UserPreferencePatch = Partial<Pick<UserPreference, 'appearance' | 'record_recent_visits' | 'use_external_storage' | 'external_storage_path' | 'root_back_button_behavior' | 'privacy' | 'task_concurrency' | 'transfer'>>;
export function updateUserPreferences(patch: UserPreferencePatch): Promise<UserPreference> {
  return invoke('update_user_preferences', { patch });
}
type FilePreferenceRecord = Omit<RecentVisitPreferenceRecord, 'visitedAt'> & { visitedAt?: number };
export type FilePreferenceMutation =
  | { operation: 'visit' | 'remove_visit'; record: FilePreferenceRecord }
  | { operation: 'clear_visits' | 'clear_favorites' }
  | { operation: 'import_visits'; records: RecentVisitPreferenceRecord[] }
  | { operation: 'favorite'; record: FilePreferenceRecord; favorite: boolean };
export function mutateFilePreferences(mutation: FilePreferenceMutation): Promise<UserPreference> {
  return invoke('mutate_file_preferences', { mutation });
}

export interface PreferenceDekSetupResult {
  status: 'ready' | 'recovery_required' | 'reset_required';
}

/** Load the current user's preferences from the encrypted local file. */
export async function loadUserPreference(): Promise<UserPreference> {
  return invoke("load_user_preference");
}

/** Load appearance settings from the user preference when authenticated,
 * or from application-wide preferences while signed out. */
export async function loadAppearancePreference(): Promise<AppearancePreference> {
  return invoke('load_appearance_preference');
}

/** Save appearance settings to the same effective scope used for reads. */
export async function saveAppearancePreference(
  appearance: AppearancePreference,
): Promise<void> {
  return invoke('save_appearance_preference', { appearance });
}

/** Set up preference encryption during the post-login loading flow. */
export async function setupPreferenceDek(
  currentPassword: string,
): Promise<PreferenceDekSetupResult> {
  return invoke("setup_preference_dek", { currentPassword });
}

/** Delete the current user's local preference file. */
export async function discardUserPreference(): Promise<void> {
  return invoke("discard_user_preference");
}

/** Create a fresh preference DEK when the current session cannot decrypt the old one. */
export async function resetPreferenceDek(currentPassword: string): Promise<void> {
  return invoke("reset_preference_dek", { currentPassword });
}

// ---------------------------------------------------------------------------

/** Reload download tasks for the current user from the encrypted persistence file.
 *
 * Returns the number of tasks loaded.  Must be called after login (when
 * the DEK is available). */
export async function reloadTasksForUser(): Promise<number> {
  return invoke("reload_tasks_for_user");
}
