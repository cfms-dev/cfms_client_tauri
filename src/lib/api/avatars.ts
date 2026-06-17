// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from './core';

/** Get the avatar task data for a user from the server. */
export async function getUserAvatar(
  username: string,
): Promise<object | null> {
  return invoke("get_user_avatar", { username });
}

/** Download an avatar file from the server and cache it locally.
 *
 *  Returns the local filesystem path to the cached avatar, or null on failure. */
export async function downloadAvatar(
  taskData: object,
  username: string,
  forceDownload?: boolean,
): Promise<string | null> {
  return invoke("download_avatar", {
    taskData,
    username,
    forceDownload: forceDownload ?? false,
  });
}

/** Check whether a cached avatar exists locally for a username on the
 *  currently-connected server.
 *
 *  Returns the local filesystem path to the cached file if it exists,
 *  or `null` otherwise.  Safe to call before login — it only reads the
 *  local filesystem and does not talk to the server. */
export async function checkCachedAvatar(
  username: string,
): Promise<string | null> {
  return invoke("check_cached_avatar", { username });
}

/** Set a user's avatar to a specific document ID on the server. */
export async function setUserAvatar(
  username: string,
  documentId: string,
): Promise<boolean> {
  return invoke("set_user_avatar", { username, documentId });
}

// ---------------------------------------------------------------------------
