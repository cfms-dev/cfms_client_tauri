// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { UserPreference } from './types';

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
