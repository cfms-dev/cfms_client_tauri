import { describe, expect, it } from 'vitest';
import { isAccountProfileRoute, isPublicUtilityRoute, shouldOfferConnectionReturn } from '$lib/app/public-utility-navigation';

describe('public utility connection recovery', () => {
  it.each([
    '/home/settings',
    '/home/settings/connection',
    '/home/about',
  ])('offers a connection return from %s while signed out and disconnected', (pathname) => {
    expect(shouldOfferConnectionReturn(pathname, false, false)).toBe(true);
  });

  it('does not replace normal session navigation', () => {
    expect(shouldOfferConnectionReturn('/home/settings', true, false)).toBe(false);
    expect(shouldOfferConnectionReturn('/home/settings', false, true)).toBe(false);
    expect(shouldOfferConnectionReturn('/home/files', false, false)).toBe(false);
  });

  it.each(['/home/settings/account', '/home/settings/account/', '/home/settings/account/details'])('requires authentication for the personal profile route %s', (pathname) => {
    expect(isAccountProfileRoute(pathname)).toBe(true);
    expect(isPublicUtilityRoute(pathname)).toBe(false);
    expect(shouldOfferConnectionReturn(pathname, false, false)).toBe(false);
  });

  it('keeps other settings available before sign-in', () => {
    expect(isAccountProfileRoute('/home/settings/connection')).toBe(false);
    expect(isPublicUtilityRoute('/home/settings/connection')).toBe(true);
    expect(isPublicUtilityRoute('/home/settings/accounting')).toBe(true);
  });
});
