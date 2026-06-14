// Mobile platform helpers.
import { invoke } from '@tauri-apps/api/core';

/** Ask Android to move this task to the background without terminating it. */
export async function moveAppToBackground(): Promise<void> {
  return invoke("move_app_to_background");
}

/** Move to the launcher first on Android, then terminate after the transition. */
export async function exitAppAfterLauncherTransition(): Promise<void> {
  return invoke("exit_app_after_launcher_transition");
}

/** Toggle Android FLAG_SECURE for screenshot and screen-recording protection. */
export async function setAndroidContentProtected(enabled: boolean): Promise<void> {
  return invoke("set_android_content_protected", { enabled });
}
