// @vitest-environment jsdom
import '$lib/shared/i18n';
import { locale } from 'svelte-i18n';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, it, vi } from 'vitest';
import type { TextInput } from '@fluentui/web-components';
import ConnectionSettings from '$lib/app/settings/ConnectionSettingsPage.svelte';

const mocks = vi.hoisted(() => ({ save: vi.fn(async () => {}) }));
vi.mock('$lib/api', () => ({
  getConnectionSettings: async () => ({ enable_proxy: false, follow_system_proxy: false, custom_proxy: '', force_ipv4: false,
    client_cert_path: '', client_key_path: '', remember_connection_addresses: false, recent_connection_addresses: [], crl_allowed_hosts: [] }),
  getCaCertificateStatus: async () => ({ caDir: '/ca', certificateCount: 1, lastChecked: null }),
  setConnectionSettings: mocks.save,
  updateCaCertificates: vi.fn(),
}));

afterEach(() => { cleanup(); mocks.save.mockClear(); });

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
