import { describe, expect, it } from 'vitest';
import {
  canSetAvatarFor,
  canSetOtherUserAvatar,
  canSetOwnAvatar,
} from './avatar-permissions';

describe('avatar permissions', () => {
  it('allows the ordinary avatar permission only for the current user', () => {
    const permissions = ['set_user_avatar'];

    expect(canSetOwnAvatar(permissions)).toBe(true);
    expect(canSetOtherUserAvatar(permissions)).toBe(false);
    expect(canSetAvatarFor(permissions, 'alice', 'alice')).toBe(true);
    expect(canSetAvatarFor(permissions, 'alice', 'bob')).toBe(false);
  });

  it('allows the super avatar permission for both current and other users', () => {
    const permissions = ['super_set_user_avatar'];

    expect(canSetOwnAvatar(permissions)).toBe(true);
    expect(canSetOtherUserAvatar(permissions)).toBe(true);
    expect(canSetAvatarFor(permissions, 'alice', 'bob')).toBe(true);
  });

  it('denies avatar changes without either permission', () => {
    expect(canSetAvatarFor([], 'alice', 'alice')).toBe(false);
    expect(canSetAvatarFor([], null, 'alice')).toBe(false);
  });
});
