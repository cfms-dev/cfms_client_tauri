// @vitest-environment jsdom
import '$lib/shared/i18n';
import { locale } from 'svelte-i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import type { TextInput } from '@fluentui/web-components';
import ConnectionSettings from '$lib/app/settings/ConnectionSettingsPage.svelte';
import { serverStateStore } from '$lib/features/connection/connection-state.svelte.ts';

const mocks = vi.hoisted(() => ({ save: vi.fn(async () => {}) }));
vi.mock('$lib/api', () => ({
  getConnectionSettings: async () => ({ enable_proxy: false, follow_system_proxy: false, custom_proxy: '', force_ipv4: false,
    client_cert_path: '', client_key_path: '', remember_connection_addresses: false, recent_connection_addresses: [], crl_allowed_hosts: [] }),
  getCaCertificateStatus: async () => ({ caDir: '/ca', certificateCount: 1, lastChecked: null }),
  setConnectionSettings: mocks.save,
  updateCaCertificates: vi.fn(),
}));

afterEach(() => { cleanup(); mocks.save.mockClear(); serverStateStore.clear(); });

it.each(['checking', 'checked', 'unknown', 'revoked', 'skipped'] as const)(
  'shows %s connection status below the page title and outside all settings cards', async (state) => {
    locale.set('en');
    serverStateStore.revocation = {
      state,
      reasons: state === 'skipped' ? ['verification_disabled'] : [],
      checked_at: 1,
      valid_until: 1000,
    };
    render(ConnectionSettings);
    await waitFor(() => expect(document.getElementById('crl-allowed-hosts')!.hasAttribute('disabled')).toBe(false));
    const notice = screen.getByRole('status');
    const title = screen.getByRole('heading', { name: 'Connection', level: 1 });
    const list = document.querySelector('.settings-section-list')!;
    expect(notice.closest('.settings-section')).toBeNull();
    expect(notice.parentElement).toBe(list.parentElement);
    expect(title.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.nextElementSibling).toBe(list);
    expect(notice.textContent).toContain('Last checked');
    expect(notice.textContent).toContain('CRL valid until');
    if (state === 'skipped') expect(notice.textContent).toContain('verification is disabled');
  },
);

it('preserves delimiters while editing and saves multiple exact CRL hosts on blur', async () => {
  locale.set('en'); render(ConnectionSettings);
  const field = document.getElementById('crl-allowed-hosts') as TextInput;
  await waitFor(() => expect(field.hasAttribute('disabled')).toBe(false));
  field.value = 'ca.internal, ';
  await fireEvent.input(field);
  expect(field.value).toBe('ca.internal, ');
  expect(mocks.save).not.toHaveBeenCalled();
  field.value = 'ca.internal, 192.168.1.10';
  await fireEvent.input(field);
  await fireEvent.focusOut(field);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ crl_allowed_hosts: ['ca.internal', '192.168.1.10'] })));
});
