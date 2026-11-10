import { describe, expect, it } from 'vitest';
import { canReadAuthentication, canConfigureAuthentication } from '$lib/features/authentication/auth-permissions';

describe('authentication permissions', () => {
  it.each([
    [[], true, false, false, false],
    [['configure_auth_methods'], true, true, false, false],
    [['super_configure_auth_methods'], true, true, false, true],
    [['super_list_user_auth_methods'], true, false, true, false],
    [['super_configure_auth_methods', 'super_list_user_auth_methods'], true, true, true, true],
    [['set_passwd', 'super_set_passwd', 'manage_2fa', 'manage_user_authentication', 'manage_system'], true, false, false, false],
  ] as const)('separates inventory from configuration for %j', (permissions, selfRead, selfWrite, otherRead, otherWrite) => {
    expect(canReadAuthentication(permissions, false)).toBe(selfRead);
    expect(canConfigureAuthentication(permissions, false)).toBe(selfWrite);
    expect(canReadAuthentication(permissions, true)).toBe(otherRead);
    expect(canConfigureAuthentication(permissions, true)).toBe(otherWrite);
  });
});
