import { downloadAvatar, getUserAvatar, getUserInfo, type ManagedUserInfo } from '$lib/api';

/** Owned by one log page; clearing also invalidates pending avatar downloads. */
export function createAuditUserPreviewCache() {
  const users = new Map<string, Promise<ManagedUserInfo>>();
  const avatars = new Map<string, Promise<string | null>>();
  let generation = 0;

  return {
    clear() {
      generation += 1;
      users.clear();
      avatars.clear();
    },
    info(userId: string): Promise<ManagedUserInfo> {
      const cached = users.get(userId);
      if (cached) return cached;
      const request = getUserInfo({ userId }).catch((error: unknown) => {
        if (users.get(userId) === request) users.delete(userId);
        throw error;
      });
      users.set(userId, request);
      return request;
    },
    avatar(info: ManagedUserInfo): Promise<string | null> {
      const cached = avatars.get(info.user_id);
      if (cached) return cached;
      const started = generation;
      const request = (async () => {
        try {
          const task = await getUserAvatar(info.user_id);
          if (!task || started !== generation) return null;
          return await downloadAvatar(task, info.username);
        } catch {
          // Avatar access and transfer failures do not hide the user's details.
          return null;
        }
      })();
      avatars.set(info.user_id, request);
      return request;
    },
  };
}

export type AuditUserPreviewCache = ReturnType<typeof createAuditUserPreviewCache>;
