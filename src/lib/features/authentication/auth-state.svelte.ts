import type { AuthStatus } from "$lib/api/types";
import { downloadStore } from "$lib/features/transfers/download-state.svelte";
import { uploadStore } from "$lib/features/transfers/upload-state.svelte";

class AuthStoreImpl {
  userId = $state<string | null>(null);
  username = $state<string | null>(null);
  nickname = $state<string | null>(null);
  hasToken = $state(false);
  tokenExp = $state<number | null>(null);
  escalationExp = $state<number | null>(null);
  permissions = $state<string[]>([]);
  permissionSnapshotRevision = $state(0);
  groups = $state<string[]>([]);
  avatarPath = $state<string | null>(null);

  // 2FA state
  requires2fa = $state(false);
  authenticationMethods = $state<string[]>([]);

  // True while the login page is still running post-login initialization
  // such as preference recovery prompts and task/avatar loading.
  postLoginPending = $state(false);

  /** Returns true if the user is authenticated and has a token. */
  get isLoggedIn() {
    return this.hasToken && this.username !== null;
  }

  /** Returns true when the server has requested 2FA but it hasn't been
   *  completed yet.  Components can use this to show the 2FA dialog. */
  get isPending2FA() {
    return this.requires2fa && this.username !== null && !this.hasToken;
  }

  get displayName() {
    return this.nickname ?? this.username;
  }

  /** Apply a full AuthStatus snapshot from the backend.
   *
   *  Only handles auth-specific fields.  Server-state fields (connection status,
   *  server address, lockdown) must be applied to `serverStateStore` separately
   *  by the caller — the two stores are fully independent. */
  apply(s: AuthStatus) {
    this.userId = s.user_id;
    this.username = s.username;
    this.nickname = normalizeNickname(s.nickname, s.username);
    this.hasToken = s.has_token;
    this.tokenExp = s.token_exp;
    this.escalationExp = s.escalation_exp ?? null;
    this.permissions = s.permissions;
    this.permissionSnapshotRevision += 1;
    this.groups = s.groups;
    this.avatarPath = s.avatar_path ?? this.avatarPath;
    this.requires2fa = s.requires_2fa ?? false;
    this.authenticationMethods = s.authentication_methods ?? [];
  }

  beginPostLogin() {
    this.postLoginPending = true;
  }

  finishPostLogin() {
    this.postLoginPending = false;
  }

  /** Clear all auth state (used on logout / token expiry).
   *
   *  Server state must be cleared separately via `serverStateStore.clear()` if
   *  needed — the two stores are fully independent. */
  clear() {
    this.userId = null;
    this.username = null;
    this.nickname = null;
    this.hasToken = false;
    this.tokenExp = null;
    this.escalationExp = null;
    this.permissions = [];
    this.permissionSnapshotRevision += 1;
    this.groups = [];
    this.avatarPath = null;
    this.requires2fa = false;
    this.authenticationMethods = [];
    this.postLoginPending = false;
    downloadStore.clear();
    uploadStore.clear();
  }
}

export const authStore = new AuthStoreImpl();

function normalizeNickname(nickname: string | null, username: string | null) {
  const cleanNickname = nickname?.trim();
  if (cleanNickname) return cleanNickname;

  const cleanUsername = username?.trim();
  return cleanUsername || null;
}
