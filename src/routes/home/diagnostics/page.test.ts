// @vitest-environment jsdom

import '$lib/i18n';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore, serverStateStore } from '$lib/stores.svelte';
import DiagnosticsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  getServerDiagnostics: vi.fn(),
}));

vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  getServerDiagnostics: mocks.getServerDiagnostics,
}));

const diagnostics = {
  schema_version: 1 as const,
  server: {
    server_name: 'CFMS Test Server',
    core_version: '0.5.0.260812_alpha',
    protocol_version: 23,
    debug_configured: false,
  },
  runtime: {
    python_implementation: 'CPython',
    python_version: '3.14.6',
    openssl_version: 'OpenSSL 3.5.7',
    operating_system: 'Windows',
    operating_system_release: '11',
    architecture: 'AMD64',
  },
  component_versions: {},
  database: { dialect: 'sqlite', driver: 'pysqlite' },
  providers: {
    storage: 'local',
    caching: 'memory',
    event_bus: 'local',
    rate_limit: 'memory',
  },
  extensions: [],
  extension_flags: [],
  lockdown: { enabled: false, reason: null },
};

function signIn(permissions: string[]) {
  authStore.apply({
    username: 'alice',
    nickname: 'Alice',
    has_token: true,
    token_exp: 1_900_000_000,
    permissions,
    groups: [],
  });
}

beforeEach(() => {
  locale.set('en');
  authStore.clear();
  serverStateStore.clear();
  mocks.getServerDiagnostics.mockReset();
  mocks.getServerDiagnostics.mockResolvedValue(diagnostics);
});

afterEach(() => {
  cleanup();
  authStore.clear();
  serverStateStore.clear();
  vi.clearAllMocks();
});

describe('diagnostics page', () => {
  it('loads diagnostics for a connected account with diagnostics permission', async () => {
    signIn(['diagnostics']);
    serverStateStore.connected = true;

    render(DiagnosticsPage);

    expect(screen.getByRole('heading', { level: 1, name: 'Diagnostics' })).toBeTruthy();
    await waitFor(() => expect(mocks.getServerDiagnostics).toHaveBeenCalledOnce());
    expect(await screen.findByText('CFMS Test Server')).toBeTruthy();
  });

  it.each([
    { state: 'signed out', connected: true, permissions: null },
    { state: 'disconnected', connected: false, permissions: ['diagnostics'] },
    { state: 'missing permission', connected: true, permissions: [] },
  ])('does not load diagnostics when $state', ({ connected, permissions }) => {
    if (permissions) signIn(permissions);
    serverStateStore.connected = connected;

    render(DiagnosticsPage);

    expect(screen.getByRole('heading', { level: 2, name: 'Diagnostics unavailable' })).toBeTruthy();
    expect(mocks.getServerDiagnostics).not.toHaveBeenCalled();
  });
});
