import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { writable, type Writable } from 'svelte/store';
import { page } from '$app/stores';
import { locale } from 'svelte-i18n';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
import WorkspaceLayout from '$lib/app/WorkspaceShell.svelte';

const mocks = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/stores', () => ({ page: writable({ url: new URL('https://example.test/home/files') }) }));
vi.mock('$lib/shared/platform/platform', () => ({ supportsKeyboardShortcuts: () => false, isMobilePlatform: () => false }));
vi.mock('$lib/api', async (original) => ({
  ...await original<typeof import('$lib/api')>(),
  loadUserPreference: async () => ({}),
  listDirectory: async () => ({ folders: [], documents: [], parent_id: null }),
}));
vi.mock('$lib/shared/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));
vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }));

beforeEach(() => {
  locale.set('en');
  (page as unknown as Writable<{ url: URL }>).set({ url: new URL('https://example.test/home/files') });
  authStore.apply({ user_id: 'self-id', username: 'alice', nickname: 'Alice', has_token: true, token_exp: 1_900_000_000, groups: [], permissions: [] });
  serverStateStore.updateConnection(true, 'wss://example.test', false);
  mocks.goto.mockReset();
});
afterEach(() => { cleanup(); authStore.clear(); serverStateStore.clear(); });
afterAll(() => vi.unstubAllGlobals());

it('opens User account from the account menu for an ordinary user and closes the flyout', async () => {
  render(WorkspaceLayout, { children: createRawSnippet(() => ({ render: () => '<div>Workspace content</div>' })) });
  await fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
  const entry = screen.getByRole('menuitem', { name: 'User account' });
  const menuItems = screen.getAllByRole('menuitem');
  expect(menuItems.indexOf(entry)).toBeLessThan(menuItems.findIndex((item) => item.textContent?.includes('Log out')));
  await fireEvent.click(entry);
  expect(mocks.goto).toHaveBeenCalledWith('/home/settings/account');
  expect(screen.queryByRole('menu')).toBeNull();
});

it.each([
  ['Settings', '/home/settings'],
  ['About', '/home/about'],
  ['Administration', '/home/manage'],
])('opens %s directly from workspace navigation', async (label, href) => {
  authStore.permissions = ['list_users'];
  render(WorkspaceLayout, { children: createRawSnippet(() => ({ render: () => '<div>Workspace content</div>' })) });
  await fireEvent.click(screen.getByRole('button', { name: label }));
  expect(mocks.goto).toHaveBeenCalledWith(href);
});

it('keeps the avatar picker accessible from the account menu', async () => {
  authStore.permissions = ['set_user_avatar'];
  render(WorkspaceLayout, { children: createRawSnippet(() => ({ render: () => '<div>Workspace content</div>' })) });
  await fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
  await fireEvent.click(screen.getByRole('menuitem', { name: 'Change avatar' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.queryByRole('menu')).toBeNull();
});

it.each(['/home/settings', '/home/about'])('returns from public %s to connection while signed out', async (path) => {
  authStore.clear();
  serverStateStore.clear();
  (page as unknown as Writable<{ url: URL }>).set({ url: new URL(path, 'https://example.test') });
  render(WorkspaceLayout, { children: createRawSnippet(() => ({ render: () => '<div>Workspace content</div>' })) });
  const close = screen.getByRole('button', { name: 'Return to connection' });
  expect(close.hasAttribute('icon-only')).toBe(true);
  expect(close.querySelector('[data-icon="close"]')).toBeTruthy();
  expect(close.textContent?.trim()).toBe('');
  expect(close.getAttribute('title')).toBe('Return to connection');
  expect(close.getAttribute('aria-keyshortcuts')).toBe('Escape');
  await fireEvent.click(close);
  expect(mocks.goto).toHaveBeenCalledWith('/connect');
});
