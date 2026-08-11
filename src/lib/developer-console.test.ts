import { describe, expect, it } from 'vitest';
import { canOpenDeveloperConsole, developerConsoleIdentityKey } from './developer-console';

const availableState = {
  connected: true,
  isLoggedIn: true,
  username: 'developer',
  postLoginPending: false,
  locked: false,
  serverAddress: 'server.example',
};

describe('developer console access', () => {
  it('is available only for an active authenticated and unlocked connection', () => {
    expect(canOpenDeveloperConsole(availableState)).toBe(true);
    expect(canOpenDeveloperConsole({ ...availableState, connected: false })).toBe(false);
    expect(canOpenDeveloperConsole({ ...availableState, isLoggedIn: false })).toBe(false);
    expect(canOpenDeveloperConsole({ ...availableState, username: null })).toBe(false);
    expect(canOpenDeveloperConsole({ ...availableState, postLoginPending: true })).toBe(false);
    expect(canOpenDeveloperConsole({ ...availableState, locked: true })).toBe(false);
  });

  it('uses server and account identity to isolate session history', () => {
    expect(developerConsoleIdentityKey(availableState)).toBe('server.example:developer');
    expect(developerConsoleIdentityKey({ ...availableState, serverAddress: 'other.example' }))
      .toBe('other.example:developer');
    expect(developerConsoleIdentityKey({ ...availableState, locked: true })).toBe('');
  });
});
