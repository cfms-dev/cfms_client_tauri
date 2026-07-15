// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { AppearancePreference, UserPreference } from './types';

export interface PreferenceDekSetupResult {
  status: 'ready' | 'recovery_required' | 'reset_required';
}

/** Load the current user's preferences from the encrypted local file. */
export async function loadUserPreference(): Promise<UserPreference> {
  return invoke("load_user_preference");
}

/** Save the current user's preferences to an encrypted local file. */
export async function saveUserPreference(
  preferences: UserPreference,
): Promise<void> {
  return invoke("save_user_preference", { preferences });
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
