import { get } from 'svelte/store';
import { _ as t } from 'svelte-i18n';
import { getGithubAuthStatus, type GithubAuthStatus } from '$lib/api';
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";

type WarningMode = Extract<GithubAuthStatus['mode'], 'needs_attention' | 'unavailable'>;

let lastNotifiedMode: WarningMode | null = null;

/** Surface native GitHub credential failures without interrupting public requests. */
export async function notifyGithubAuthFallback(): Promise<void> {
  let mode: GithubAuthStatus['mode'];
  try {
    mode = (await getGithubAuthStatus()).mode;
  } catch {
    // Credential status is advisory; a failed status lookup must not break updates.
    return;
  }

  if (mode !== 'needs_attention' && mode !== 'unavailable') {
    lastNotifiedMode = null;
    return;
  }
  if (mode === lastNotifiedMode) return;

  lastNotifiedMode = mode;
  const key = mode === 'needs_attention'
    ? 'settings.githubApi.authFallbackWarning'
    : 'settings.githubApi.storeUnavailableWarning';
  notificationStore.warning(get(t)(key), 8_000);
}

/** A saved replacement or explicit removal starts a fresh warning cycle. */
export function resetGithubAuthNotice(): void {
  lastNotifiedMode = null;
}
