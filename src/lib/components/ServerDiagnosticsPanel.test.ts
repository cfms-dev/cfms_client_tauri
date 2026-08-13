// @vitest-environment jsdom

import '$lib/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ServerDiagnosticsPanel from './ServerDiagnosticsPanel.svelte';

const mocks = vi.hoisted(() => ({
  getServerDiagnostics: vi.fn(),
  formatUserFacingError: vi.fn((reason: unknown) => String(reason)),
}));

vi.mock('$lib/api', () => ({
  getServerDiagnostics: mocks.getServerDiagnostics,
}));

vi.mock('$lib/user-facing-errors', () => ({
  formatUserFacingError: mocks.formatUserFacingError,
}));

const diagnostics = {
  schema_version: 1 as const,
  server: {
    server_name: 'CFMS Test Server',
    core_version: '0.5.0.260812_alpha',
    protocol_version: 22,
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
  component_versions: { pydantic: '2.13.4' },
  database: { dialect: 'sqlite', driver: 'pysqlite' },
  providers: {
    storage: 'local',
    caching: 'memory',
    event_bus: 'local',
    rate_limit: 'memory',
  },
  extensions: [{ identifier: 'builtin', name: 'Built-in', version: '0.5.0' }],
  extension_flags: ['documents'],
  lockdown: { enabled: false, reason: null },
};

beforeEach(() => {
  locale.set('en');
  mocks.getServerDiagnostics.mockReset();
  mocks.formatUserFacingError.mockClear();
});

afterEach(cleanup);

describe('ServerDiagnosticsPanel', () => {
  it('loads and renders every diagnostic group', async () => {
    mocks.getServerDiagnostics.mockResolvedValue(diagnostics);
    render(ServerDiagnosticsPanel);

    await waitFor(() => expect(mocks.getServerDiagnostics).toHaveBeenCalledOnce());
    expect(await screen.findByText('CFMS Test Server')).toBeTruthy();
    expect(screen.getByText('0.5.0.260812_alpha')).toBeTruthy();
    expect(screen.getByText('CPython 3.14.6')).toBeTruthy();
    expect(screen.getByText('sqlite · pysqlite')).toBeTruthy();
    expect(screen.getByText('2.13.4')).toBeTruthy();
    expect(screen.getByText('Built-in')).toBeTruthy();
    expect(screen.getByText('documents')).toBeTruthy();
  });

  it('surfaces load failures and supports retrying', async () => {
    mocks.getServerDiagnostics.mockRejectedValueOnce(new Error('permission denied'));
    render(ServerDiagnosticsPanel);

    expect((await screen.findByRole('alert')).textContent).toContain('permission denied');
    expect(mocks.formatUserFacingError).toHaveBeenCalledOnce();

    mocks.getServerDiagnostics.mockResolvedValueOnce(diagnostics);
    await fireEvent.click(screen.getByRole('button', { name: /Load diagnostics/ }));

    expect(await screen.findByText('CFMS Test Server')).toBeTruthy();
    expect(mocks.getServerDiagnostics).toHaveBeenCalledTimes(2);
  });
});
