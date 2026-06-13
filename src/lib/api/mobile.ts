// Mobile platform helpers.
import { invoke } from '@tauri-apps/api/core';

/** Ask Android to move this task to the background without terminating it. */
export async function moveAppToBackground(): Promise<void> {
  return invoke("move_app_to_background");
}
