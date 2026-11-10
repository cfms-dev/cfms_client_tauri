import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedUserInfo } from '$lib/api';
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import AuditUserIdentity from '$lib/features/administration/AuditUserIdentity.svelte';

vi.mock('$lib/shared/motion/transitions', () => ({ menuScale: () => ({ duration: 0 }) }));
const user: ManagedUserInfo = {
  user_id: 'aabbccdd-0000-4000-8000-000000000002', username: 'alice', nickname: 'Alice',
  status: 'active', permissions: [], effective_permissions: [], effective_own_permissions: [],
  effective_inherited_permissions: [], groups: ['staff'], last_login: 1786600000, created_time: 1700000000,
};
const cache = { info: vi.fn(), avatar: vi.fn(), clear: vi.fn() };
const details = vi.fn();
const writeText = vi.fn();
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function mount(value: string | null = user.user_id) {
  return render(AuditUserIdentity, { value, previewKey: 'row', activeKey: null, cache, onViewDetails: details });
}

function pointer(element: Element, type: string, pointerType = 'mouse', x = 0, y = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerType, button: 0, clientX: x, clientY: y });
  return fireEvent(element, event);
}

async function hover() {
  const trigger = screen.getByRole('button', { name: `Preview user ${user.user_id}` });
  await pointer(trigger, 'pointerenter');
  await vi.advanceTimersByTimeAsync(300);
  return trigger;
}

beforeEach(() => {
  vi.useFakeTimers();
  locale.set('en');
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  cache.info.mockReset().mockResolvedValue(user);
  cache.avatar.mockReset().mockResolvedValue(null);
  writeText.mockReset().mockResolvedValue(undefined);
  details.mockReset();
  notificationStore.clear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('audit user preview', () => {
  it('does not query for missing IDs, desktop clicks, or brief hovers', async () => {
    const view = mount(null);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    await view.rerender({ value: user.user_id });
    const trigger = screen.getByRole('button');
    await fireEvent.click(trigger);
    await pointer(trigger, 'pointerenter');
    await vi.advanceTimersByTimeAsync(299);
    expect(cache.info).not.toHaveBeenCalled();
    await pointer(trigger, 'pointerleave');
    await vi.advanceTimersByTimeAsync(201);
    expect(cache.info).not.toHaveBeenCalled();
    expect(trigger.textContent).toBe('aabbccd…');
  });

  it('keeps a placeholder and copy action while loading, then reuses details', async () => {
    const pending = deferred<ManagedUserInfo>();
    const avatar = deferred<string | null>();
    cache.info.mockReturnValue(pending.promise);
    cache.avatar.mockReturnValue(avatar.promise);
    const view = mount();
    await hover();
    const panel = screen.getByRole('dialog', { name: 'User preview' });
    expect(panel.parentElement).toBe(document.body);
    expect(view.container.contains(panel)).toBe(false);
    expect(screen.getByText('Loading user information…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'View user details' }).getAttribute('aria-disabled')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Copy user ID' }));
    expect(writeText).toHaveBeenCalledWith(user.user_id);
    pending.resolve(user);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('@alice')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'View user details' }));
    expect(details).toHaveBeenCalledWith(user.user_id, user);
    avatar.resolve('alice.png');
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('allows entering the card and closes after leaving it', async () => {
    mount();
    const trigger = await hover();
    await pointer(trigger, 'pointerleave');
    await vi.advanceTimersByTimeAsync(150);
    const panel = screen.getByRole('dialog');
    await pointer(panel, 'pointerenter');
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.getByRole('dialog')).toBe(panel);
    await pointer(panel, 'pointerleave');
    await vi.advanceTimersByTimeAsync(200);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([[403, 'You do not have permission to view this user.'], [404, 'This user no longer exists.'],
    [500, 'Could not load user information. Open the preview again to retry.']])('shows a %s failure inline and retries on reopen', async (status, message) => {
    cache.info.mockRejectedValueOnce(`Server returned ${status}: unavailable`);
    mount();
    const trigger = await hover();
    expect(screen.getByText(message)).toBeTruthy();
    expect(cache.avatar).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Copy user ID' }));
    expect(writeText).toHaveBeenCalledWith(user.user_id);
    await pointer(trigger, 'pointerleave');
    await vi.advanceTimersByTimeAsync(200);
    await hover();
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it.each(['resize', 'scroll', 'outside'])('dismisses on %s and ignores late responses', async (action) => {
    const pending = deferred<ManagedUserInfo>();
    cache.info.mockReturnValue(pending.promise);
    mount();
    await hover();
    if (action === 'outside') await pointer(document.body, 'pointerdown');
    else await fireEvent(window, new Event(action));
    pending.resolve(user);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cache.avatar).not.toHaveBeenCalled();
  });

  it('supports keyboard focus, entering the actions, and Escape without reopening', async () => {
    mount();
    const trigger = screen.getByRole('button');
    trigger.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
    await fireEvent.keyDown(trigger, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View user details' }));
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await vi.advanceTimersByTimeAsync(0);
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([false, true])('uses the same delayed preview for touch with hover support=%s', async (supportsHover) => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: supportsHover })));
    mount();
    const trigger = screen.getByRole('button');
    await pointer(trigger, 'pointerenter', 'touch');
    await pointer(trigger, 'pointerdown', 'touch');
    trigger.focus();
    await pointer(trigger, 'pointerup', 'touch');
    await fireEvent.click(trigger);
    await vi.advanceTimersByTimeAsync(299);
    expect(cache.info).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.getByRole('dialog', { name: 'User preview' })).toBeTruthy();
    expect(details).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'View user details' }));
    expect(details).toHaveBeenCalledExactlyOnceWith(user.user_id, user);
  });

  it('supports the same keyboard preview on devices without hover', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    mount();
    const trigger = screen.getByRole('button');
    trigger.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByRole('dialog', { name: 'User preview' })).toBeTruthy();
    await fireEvent.keyDown(trigger, { key: 'Tab' });
    const action = screen.getByRole('button', { name: 'View user details' });
    expect(document.activeElement).toBe(action);
    await fireEvent.click(action);
    expect(details).toHaveBeenCalledExactlyOnceWith(user.user_id, user);
  });

  it('copies on long press without opening details or duplicating the context menu copy', async () => {
    mount();
    const trigger = screen.getByRole('button');
    await pointer(trigger, 'pointerdown', 'touch');
    await vi.advanceTimersByTimeAsync(550);
    await fireEvent.contextMenu(trigger);
    await pointer(trigger, 'pointerup', 'touch');
    await fireEvent.click(trigger);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(user.user_id);
    expect(details).not.toHaveBeenCalled();
  });

  it.each(['move', 'cancel'])('ignores taps and long presses after touch %s', async (action) => {
    mount();
    const trigger = screen.getByRole('button');
    await pointer(trigger, 'pointerdown', 'touch');
    if (action === 'move') await pointer(trigger, 'pointermove', 'touch', 0, 20);
    else await pointer(trigger, 'pointercancel', 'touch');
    await vi.advanceTimersByTimeAsync(600);
    await pointer(trigger, 'pointerup', 'touch');
    await fireEvent.click(trigger);
    expect(details).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('reports clipboard failures without closing the card', async () => {
    const error = vi.spyOn(notificationStore, 'error');
    writeText.mockRejectedValueOnce(new Error('denied'));
    mount();
    await hover();
    await fireEvent.click(screen.getByRole('button', { name: 'Copy user ID' }));
    expect(error).toHaveBeenCalledWith('Failed to copy user ID.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy user ID' }).querySelector('[data-icon="contentCopy"]')).toBeTruthy();
    await tick();
  });

  it('silently confirms copies with a temporary checkmark and restarts its duration on another copy', async () => {
    mount();
    await hover();
    const button = screen.getByRole('button', { name: 'Copy user ID' });
    await fireEvent.click(button);
    await vi.advanceTimersByTimeAsync(0);
    expect(button.querySelector('[data-icon="check"]')).toBeTruthy();
    expect(notificationStore.entries).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    await fireEvent.click(button);
    await vi.advanceTimersByTimeAsync(1000);
    expect(button.querySelector('[data-icon="check"]')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(600);
    expect(button.querySelector('[data-icon="contentCopy"]')).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(notificationStore.entries).toHaveLength(0);
  });
});
