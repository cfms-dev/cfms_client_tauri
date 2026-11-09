// @vitest-environment jsdom
import '../i18n';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import ConnectionSecurity from './ConnectionSecurity.svelte';
import { serverStateStore } from '../stores.svelte';

beforeEach(() => { locale.set('en'); serverStateStore.clear(); });
afterEach(() => { cleanup(); serverStateStore.clear(); });

it('keeps an explicit warning for unknown status and translates its reason', () => {
  serverStateStore.revocation = { state: 'unknown', reasons: ['blocked_address'], checked_at: 1, valid_until: null };
  render(ConnectionSecurity);
  expect(screen.getByRole('status').textContent).toContain('could not be confirmed');
  expect(screen.getByRole('status').textContent).toContain('private or restricted address');
  expect(screen.queryByText('Certificate chain checked against current CRLs')).toBeNull();
});

it('does not present disabled verification as a successful check', () => {
  serverStateStore.revocation = { state: 'skipped', reasons: ['verification_disabled'], checked_at: null, valid_until: null };
  render(ConnectionSecurity);
  expect(screen.getByRole('status').textContent).toContain('skipped');
  expect(screen.getByRole('status').textContent).toContain('verification is disabled');
});

it('shows checked status with timestamps in details', () => {
  serverStateStore.revocation = { state: 'checked', reasons: [], checked_at: 1, valid_until: 1000 };
  render(ConnectionSecurity, { details: true });
  expect(screen.getByRole('status').textContent).toContain('Certificate chain checked');
  expect(screen.getByRole('status').textContent).toContain('CRL valid until');
});

it('shows the Chinese revocation error without raw backend reason codes', () => {
  locale.set('zh_CN');
  serverStateStore.revocation = { state: 'revoked', reasons: ['certificate_revoked'], checked_at: null, valid_until: null };
  render(ConnectionSecurity, { details: true });
  expect(screen.getByRole('status').textContent).toContain('服务器证书已被吊销');
  expect(screen.getByRole('status').textContent).not.toContain('certificate_revoked');
});
