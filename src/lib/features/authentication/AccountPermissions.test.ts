import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManagedUserInfo } from '$lib/api';
import AccountPermissions from '$lib/features/authentication/AccountPermissions.svelte';

const now = Date.now() / 1000;
const info: ManagedUserInfo = {
  user_id: 'self-id', username: 'alice', status: 'active', groups: ['staff'],
  effective_permissions: ['read_document'],
  effective_own_permissions: ['set_user_avatar'],
  effective_inherited_permissions: ['read_document', 'set_user_avatar'],
  permissions: [
    { permission: 'set_user_avatar', granted: false, start_time: now - 100, end_time: null },
    { permission: 'scheduled_grant', granted: true, start_time: now + 86400, end_time: null },
    { permission: 'expired_grant', granted: true, start_time: now - 86400, end_time: now - 100 },
  ],
};

beforeEach(() => locale.set('en'));
afterEach(cleanup);

describe('read-only account permissions', () => {
  it('uses the final server result even when a source set contains an overridden grant', async () => {
    render(AccountPermissions, { info });
    const effective = within(screen.getByRole('list', { name: 'Current effective permissions' }));
    expect(effective.getByText('read_document')).toBeTruthy();
    expect(effective.queryByText('set_user_avatar')).toBeNull();
    const details = screen.getByText('Authorization details and sources').closest('details')!;
    expect(details.open).toBe(false);
    await fireEvent.click(screen.getByText('Authorization details and sources'));
    expect(details.open).toBe(true);
    const rules = within(screen.getByRole('list', { name: 'Personal permission entries' }));
    expect(rules.getByText('Revoke')).toBeTruthy();
    expect(rules.getByText('Active')).toBeTruthy();
    expect(rules.getByText('Scheduled')).toBeTruthy();
    expect(rules.getByText('Expired')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add|save|delete/i })).toBeNull();
  });

  it('lists every effective permission once in sorted order without a search control', () => {
    render(AccountPermissions, { info: { ...info, effective_permissions: ['set_user_avatar', 'read_document', 'read_document'] } });
    const effective = within(screen.getByRole('list', { name: 'Current effective permissions' }));
    expect(effective.getAllByRole('listitem').map(item => item.textContent)).toEqual(['read_document', 'set_user_avatar']);
    expect(screen.getByRole('heading', { name: 'Current effective permissions 2' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('shows the empty state when there are no effective permissions', () => {
    render(AccountPermissions, { info: { ...info, effective_permissions: [] } });
    expect(screen.getByRole('status').textContent).toBe('You have no effective permissions.');
    expect(screen.queryByRole('list', { name: 'Current effective permissions' })).toBeNull();
  });

  it('renders long unknown permission identifiers and Chinese labels without a translation catalog', async () => {
    locale.set('zh-CN');
    const permission = `extension_${'very_long_identifier_'.repeat(20)}`;
    render(AccountPermissions, { info: { ...info, effective_permissions: [permission], permissions: [] } });
    expect(screen.getByText(permission)).toBeTruthy();
    expect(screen.getByRole('list', { name: '当前有效权限' })).toBeTruthy();
    await fireEvent.click(screen.getByText('授权明细与来源'));
    expect(screen.getByText('尚未配置直接权限条目。')).toBeTruthy();
  });
});
