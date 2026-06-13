import { afterNavigate, goto } from '$app/navigation';
import { invoke } from '@tauri-apps/api/core';
import {
  getRootBackButtonBehavior,
  type RootBackButtonBehavior,
} from '$lib/api/settings';
import { moveAppToBackground } from '$lib/api/mobile';

export type { RootBackButtonBehavior } from '$lib/api/settings';

const HOME_ROOT_ROUTES = new Set([
  '/home/overview',
  '/home/files',
  '/home/tasks',
  '/home/more',
]);

const HOME_SECONDARY_PARENT_ROUTES = new Map([
  ['/home/about', '/home/more'],
  ['/home/manage', '/home/more'],
  ['/home/settings', '/home/more'],
  ['/home/trash', '/home/more'],
]);

const routeHistory: string[] = [];
let skipNextRecord: { from: string; to: string } | null = null;
let initialized = false;

interface NavigateUpOptions {
  rootBackButtonBehavior?: RootBackButtonBehavior;
}

export function initNavigationHistory(): void {
  if (typeof window === 'undefined') return;
  if (initialized) return;
  initialized = true;

  afterNavigate((navigation) => {
    const from = navigation.from?.url.pathname;
    const to = navigation.to?.url.pathname;
    if (!from || !to) return;

    const fromPath = normalizePath(from);
    const toPath = normalizePath(to);
    if (fromPath === toPath) return;

    if (
      skipNextRecord
      && skipNextRecord.from === fromPath
      && skipNextRecord.to === toPath
    ) {
      skipNextRecord = null;
      return;
    }

    if (navigation.type === 'popstate') {
      reconcilePopstateHistory(fromPath, toPath, navigation.delta);
      return;
    }

    rememberRoute(fromPath);
  });
}

export function parentRouteFor(pathname: string): string | null {
  const path = normalizePath(pathname);
  if (path === '/' || path === '/home' || HOME_ROOT_ROUTES.has(path)) {
    return null;
  }

  const mappedParent = HOME_SECONDARY_PARENT_ROUTES.get(path);
  if (mappedParent) {
    return mappedParent;
  }

  if (path.startsWith('/home/settings/')) {
    return '/home/settings';
  }

  if (path.startsWith('/home/')) {
    const rest = path.slice('/home/'.length);
    if (!rest.includes('/')) {
      return '/home';
    }
  }

  const parent = path.slice(0, path.lastIndexOf('/'));
  return parent && parent !== path ? parent : null;
}

export async function navigateUp(pathname: string, options: NavigateUpOptions = {}): Promise<void> {
  const path = normalizePath(pathname);
  const parent = parentRouteFor(path);
  if (parent) {
    const target = takePreviousRoute(path) ?? normalizePath(parent);
    skipNextRecord = { from: path, to: target };
    await goto(target);
    return;
  }

  if ((options.rootBackButtonBehavior ?? await getRootBackButtonBehavior()) === 'background') {
    try {
      await moveAppToBackground();
      return;
    } catch {
      // Desktop and unsupported mobile targets do not expose Android task backgrounding.
    }
    await exitApp();
    return;
  }

  await exitApp();
}

async function exitApp(): Promise<void> {
  try {
    await invoke('plugin:app|exit');
    return;
  } catch {
    const { exit } = await import('@tauri-apps/plugin-process');
    await exit(0);
  }
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function rememberRoute(path: string) {
  const normalized = normalizePath(path);
  if (routeHistory.at(-1) === normalized) return;
  routeHistory.push(normalized);
  if (routeHistory.length > 30) routeHistory.shift();
}

function takePreviousRoute(currentPath: string): string | null {
  const current = normalizePath(currentPath);
  while (routeHistory.length > 0) {
    const previous = routeHistory.pop();
    if (previous && previous !== current) return previous;
  }
  return null;
}

function reconcilePopstateHistory(fromPath: string, toPath: string, delta: number) {
  if (delta < 0) {
    for (let i = 0; i < Math.abs(delta); i += 1) {
      routeHistory.pop();
    }
    return;
  }

  if (delta > 0) {
    rememberRoute(fromPath);
    return;
  }

  rememberRoute(toPath);
}
