export interface DeveloperConsoleAccessState {
  connected: boolean;
  isLoggedIn: boolean;
  username: string | null;
  postLoginPending: boolean;
  locked: boolean;
  serverAddress: string | null;
}

export function canOpenDeveloperConsole(state: DeveloperConsoleAccessState): boolean {
  return state.connected
    && state.isLoggedIn
    && Boolean(state.username)
    && !state.postLoginPending
    && !state.locked;
}

export function developerConsoleIdentityKey(state: DeveloperConsoleAccessState): string {
  if (!canOpenDeveloperConsole(state)) return '';
  return `${state.serverAddress ?? 'local'}:${state.username ?? ''}`;
}
