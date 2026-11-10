import { beforeEach, describe, expect, it, vi } from 'vitest';

interface NavigationEvent {
  from: { url: URL };
  to: { url: URL };
  type: 'goto' | 'popstate';
  delta: number;
}

const mocks = vi.hoisted(() => ({
  afterNavigate: vi.fn<(callback: (event: NavigationEvent) => void) => void>(),
  goto: vi.fn(),
  getRootBackButtonBehavior: vi.fn(),
  moveAppToBackground: vi.fn(),
  exitAppAfterLauncherTransition: vi.fn(),
}));

vi.mock('$app/navigation', () => ({ afterNavigate: mocks.afterNavigate, goto: mocks.goto }));
vi.mock('$lib/api/settings', () => ({ getRootBackButtonBehavior: mocks.getRootBackButtonBehavior }));
vi.mock('$lib/api/mobile', () => ({
  moveAppToBackground: mocks.moveAppToBackground,
  exitAppAfterLauncherTransition: mocks.exitAppAfterLauncherTransition,
}));
vi.mock('$lib/features/settings/app-lock.svelte.ts', () => ({ appLockStore: { canUseRootBackBackground: true } }));
vi.mock('$lib/features/authentication/auth-state.svelte', () => ({
  authStore: { isLoggedIn: true }
}));

let navigation: typeof import('$lib/app/navigation');

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  navigation = await import('$lib/app/navigation');
  navigation.initNavigationHistory();
});

function completeNavigation(from: string, to: string, type: NavigationEvent['type'] = 'goto', delta = 0) {
  mocks.afterNavigate.mock.calls[0][0]({
    from: { url: new URL(from, 'https://example.test') },
    to: { url: new URL(to, 'https://example.test') },
    type,
    delta,
  });
}

const secondaryRoutes = ['/home/settings', '/home/about', '/home/manage', '/home/trash'];

describe('workspace back navigation', () => {
  it.each(secondaryRoutes)('returns from %s to overview without history', async (path) => {
    expect(navigation.parentRouteFor(`${path}/`)).toBe('/home/overview');
    await navigation.navigateUp(`${path}/`);
    expect(mocks.goto).toHaveBeenCalledWith('/home/overview');
    expect(mocks.getRootBackButtonBehavior).not.toHaveBeenCalled();
    expect(mocks.moveAppToBackground).not.toHaveBeenCalled();
    expect(mocks.exitAppAfterLauncherTransition).not.toHaveBeenCalled();
  });

  it.each(secondaryRoutes)('returns from %s to the actual previous page', async (path) => {
    completeNavigation('/home/files', path);
    await navigation.navigateUp(path);
    expect(mocks.goto).toHaveBeenCalledWith('/home/files');
  });

  it.each(['/home/settings/account', '/home/settings/appearance', '/home/settings/account/'])('keeps %s under settings without history', async (path) => {
    expect(navigation.parentRouteFor(path)).toBe('/home/settings');
    await navigation.navigateUp(path);
    expect(mocks.goto).toHaveBeenCalledWith('/home/settings');
  });

  it('returns through real history without recording each back destination again', async () => {
    completeNavigation('/home/files', '/home/settings');
    completeNavigation('/home/settings', '/home/settings/account');

    await navigation.navigateUp('/home/settings/account');
    expect(mocks.goto).toHaveBeenLastCalledWith('/home/settings');
    completeNavigation('/home/settings/account', '/home/settings');

    await navigation.navigateUp('/home/settings');
    expect(mocks.goto).toHaveBeenLastCalledWith('/home/files');
    completeNavigation('/home/settings', '/home/files');

    completeNavigation('/home/files', '/home/about');
    await navigation.navigateUp('/home/about');
    expect(mocks.goto).toHaveBeenLastCalledWith('/home/files');
  });

  it('uses overview after returning through settings with no earlier history', async () => {
    await navigation.navigateUp('/home/settings/account');
    completeNavigation('/home/settings/account', '/home/settings');
    await navigation.navigateUp('/home/settings');
    expect(mocks.goto).toHaveBeenLastCalledWith('/home/overview');
  });

  it('reconciles browser back before using the remaining history', async () => {
    completeNavigation('/home/files', '/home/settings');
    completeNavigation('/home/settings', '/home/about');
    completeNavigation('/home/about', '/home/settings', 'popstate', -1);
    await navigation.navigateUp('/home/settings');
    expect(mocks.goto).toHaveBeenCalledWith('/home/files');
  });

  it('keeps configured exit behavior on overview', async () => {
    expect(navigation.parentRouteFor('/home/overview')).toBeNull();
    await navigation.navigateUp('/home/overview', { rootBackButtonBehavior: 'exit' });
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(mocks.exitAppAfterLauncherTransition).toHaveBeenCalledOnce();
  });

  it('keeps configured background behavior on overview', async () => {
    await navigation.navigateUp('/home/overview', { rootBackButtonBehavior: 'background' });
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(mocks.moveAppToBackground).toHaveBeenCalledOnce();
  });
});
