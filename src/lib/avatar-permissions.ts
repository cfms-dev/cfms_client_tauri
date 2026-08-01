export const SET_OWN_AVATAR_PERMISSION = 'set_user_avatar';
export const SET_ANY_AVATAR_PERMISSION = 'super_set_user_avatar';

/** Mirrors the server's set_user_avatar authorization for the current user. */
export function canSetOwnAvatar(permissions: readonly string[]): boolean {
  return permissions.includes(SET_OWN_AVATAR_PERMISSION)
    || permissions.includes(SET_ANY_AVATAR_PERMISSION);
}

/** Mirrors the server's set_user_avatar authorization for another user. */
export function canSetOtherUserAvatar(permissions: readonly string[]): boolean {
  return permissions.includes(SET_ANY_AVATAR_PERMISSION);
}

export function canSetAvatarFor(
  permissions: readonly string[],
  currentUsername: string | null,
  targetUsername: string,
): boolean {
  return currentUsername === targetUsername
    ? canSetOwnAvatar(permissions)
    : canSetOtherUserAvatar(permissions);
}
