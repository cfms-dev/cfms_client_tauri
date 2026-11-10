const PUBLIC_UTILITY_ROUTES = ['/home/about', '/home/settings'] as const;

export function isAccountProfileRoute(pathname: string): boolean {
  return pathname === '/home/settings/account' || pathname.startsWith('/home/settings/account/');
}

export function isPublicUtilityRoute(pathname: string): boolean {
  if (isAccountProfileRoute(pathname)) return false;
  return PUBLIC_UTILITY_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function shouldOfferConnectionReturn(
  pathname: string,
  connected: boolean,
  isLoggedIn: boolean,
): boolean {
  return !connected && !isLoggedIn && isPublicUtilityRoute(pathname);
}
