// @vitest-environment jsdom
import '$lib/shared/i18n';
import type { Switch } from '@fluentui/web-components';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConnectionPage from '$lib/app/connection/ConnectionPage.svelte';
import { serverStateStore } from '$lib/features/connection/connection-state.svelte.ts';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), error: vi.fn() }));
vi.mock('$lib/api', () => ({
  connect: mocks.connect, disconnect: mocks.disconnect, cancelConnect: vi.fn(),
  getAuthStatus: vi.fn(), getServerState: vi.fn(),
  getConnectionSettings: async () => ({ remember_connection_addresses: false, recent_connection_addresses: [] }),
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/features/updates/app-info', () => ({ loadAppVersion: async () => '0.59.0' }));
vi.mock('$lib/shared/notifications/notifications.svelte.ts', () => ({ notificationStore: { error: mocks.error } }));
vi.mock('$lib/shared/motion/transitions', () => ({ menuScale: () => ({ duration: 0 }), inlineNotice: () => ({ duration: 0 }) }));
vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }));

beforeEach(() => {
  locale.set('en');
  serverStateStore.clear();
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.connect.mockRejectedValue(new Error('Connection refused'));
});
afterEach(() => { cleanup(); serverStateStore.clear(); vi.clearAllMocks(); });

async function setDisableSsl(checked: boolean) {
  const control = screen.getByRole('switch') as Switch;
  control.checked = checked;
  await fireEvent.change(control);
}

it.each([
  ['en', 'Certificate revocation checking will be skipped', 'SSL verification is disabled. Certificate revocation checking will be skipped when connecting.'],
  ['zh_CN', '将跳过证书吊销检查', '已禁用 SSL 验证，连接时将跳过证书吊销检查。'],
])('explains the upcoming check only while the switch is enabled (%s)', async (language, title, message) => {
  locale.set(language);
  render(ConnectionPage);
  await waitFor(() => expect(mocks.disconnect).toHaveBeenCalledOnce());
  // The default localhost address must not trigger this option-specific notice.
  expect(screen.queryByText(message)).toBeNull();
  expect(screen.queryByText(title)).toBeNull();
  await setDisableSsl(true);
  expect(screen.getByText(title).closest('[role="status"]')).toBe(screen.getByRole('status'));
  expect(screen.getByText(message).closest('[role="status"]')).toBe(screen.getByRole('status'));
  expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  await setDisableSsl(false);
  expect(screen.queryByRole('status')).toBeNull();
});

it('retains switch focus and a single notice through repeated toggles', async () => {
  render(ConnectionPage);
  await waitFor(() => expect(mocks.disconnect).toHaveBeenCalledOnce());
  const control = screen.getByRole('switch');
  control.focus();
  for (const checked of [true, false, true, false, true]) {
    await setDisableSsl(checked);
    expect(screen.queryAllByRole('status')).toHaveLength(checked ? 1 : 0);
    expect(document.activeElement).toBe(control);
  }
});

it('keeps the option notice after a failed connection without reporting a completed check', async () => {
  render(ConnectionPage);
  await waitFor(() => expect(mocks.disconnect).toHaveBeenCalledOnce());
  await setDisableSsl(true);
  await fireEvent.submit(screen.getByRole('button', { name: 'Connect' }).closest('form')!);
  await waitFor(() => expect(mocks.error).toHaveBeenCalledOnce());
  expect(mocks.connect).toHaveBeenCalledWith('wss://localhost:5104', true);
  expect(screen.getByRole('status').textContent).toContain('will be skipped when connecting');
  expect(screen.queryByText('Certificate revocation checking was skipped')).toBeNull();
  await setDisableSsl(false);
  expect(screen.queryByRole('status')).toBeNull();
});
