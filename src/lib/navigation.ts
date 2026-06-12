import { goto } from '$app/navigation';
import { invoke } from '@tauri-apps/api/core';

const HOME_ROOT_ROUTES = new Set([
  '/home/overview',
  '/home/files',
  '/home/tasks',
  '/home/more',
]);

export function parentRouteFor(pathname: string): string | null {
  const path = normalizePath(pathname);
  if (path === '/' || path === '/home' || HOME_ROOT_ROUTES.has(path)) {
    return null;
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

export async function navigateUp(pathname: string): Promise<void> {
  const parent = parentRouteFor(pathname);
  if (parent) {
    await goto(parent);
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
