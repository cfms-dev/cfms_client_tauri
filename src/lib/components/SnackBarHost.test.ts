import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '$lib/i18n';
import SnackBarHost from './SnackBarHost.svelte';
import { chromeStore, floatingProgressStore, notificationStore } from '$lib/stores.svelte';

vi.hoisted(() => {
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({
    matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  Element.prototype.getAnimations = () => [];
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T00:00:00Z'));
  locale.set('en');
  document.documentElement.dataset.reduceMotion = 'true';
  notificationStore.clear();
  floatingProgressStore.clear();
});

afterEach(() => {
  cleanup();
  notificationStore.clear();
  floatingProgressStore.clear();
  vi.useRealTimers();
  delete document.documentElement.dataset.reduceMotion;
});

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await tick();
}

describe('shared floating notifications', () => {
  it('renders a notification action, pauses its timer on focus, and dismisses before invoking it', async () => {
    render(SnackBarHost);
    const onClick = vi.fn(() => expect(notificationStore.entries).toHaveLength(0));
    notificationStore.success('Uploads queued', undefined, { action: { label: 'View transfers', onClick } });
    await tick();
    const action = screen.getByRole('button', { name: 'View transfers' });
    expect(document.activeElement).not.toBe(action);
    await advance(2000);
    await fireEvent.focusIn(action);
    await advance(10000);
    expect(screen.getByText('Uploads queued')).toBeTruthy();
    await fireEvent.click(action);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByText('Uploads queued')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves an existing grouped action and replaces it when a new action is supplied', async () => {
    render(SnackBarHost);
    const first = vi.fn();
    const latest = vi.fn();
    notificationStore.info('First', 0, { groupKey: 'action', action: { label: 'First action', onClick: first } });
    notificationStore.info('Second', 0, { groupKey: 'action' });
    await tick();
    expect(screen.getByRole('button', { name: 'First action' })).toBeTruthy();
    notificationStore.info('Third', 0, { groupKey: 'action', action: { label: 'Latest action', onClick: latest } });
    await tick();
    expect(screen.queryByRole('button', { name: 'First action' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Latest action' }));
    expect(latest).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it('uses seven seconds for every default notification method', async () => {
    render(SnackBarHost);
    notificationStore.info('Info');
    notificationStore.success('Success');
    notificationStore.warning('Warning');
    notificationStore.error('Error');
    expect(notificationStore.entries.every((entry) => entry.timeoutMs === 7000)).toBe(true);
    await tick();
    await advance(6999);
    expect(notificationStore.entries).toHaveLength(4);
    await advance(1);
    expect(notificationStore.entries).toHaveLength(0);
  });

  it('honors explicit and persistent durations', async () => {
    render(SnackBarHost);
    notificationStore.info('Brief', 1500);
    notificationStore.warning('Persistent', 0);
    await tick();
    await advance(1500);
    expect(screen.queryByText('Brief')).toBeNull();
    await advance(30000);
    expect(screen.getByText('Persistent')).toBeTruthy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses overlapping hover and focus, then resumes only the remaining time', async () => {
    render(SnackBarHost);
    notificationStore.success('Restored');
    await tick();
    const toast = screen.getByRole('status');
    const close = within(toast).getByRole('button', { name: 'Close' });
    await advance(2000);
    await fireEvent.mouseEnter(toast);
    await advance(10000);
    await fireEvent.focusIn(close);
    await fireEvent.mouseLeave(toast);
    await advance(10000);
    expect(screen.getByText('Restored')).toBeTruthy();
    await fireEvent.focusOut(close, { relatedTarget: document.body });
    await advance(4999);
    expect(screen.getByText('Restored')).toBeTruthy();
    await advance(1);
    expect(screen.queryByText('Restored')).toBeNull();
  });

  it('preserves paused timers when unrelated messages arrive and refreshes grouped messages', async () => {
    render(SnackBarHost);
    const options = { groupKey: 'restore', groupTitle: 'Restoring files' };
    const id = notificationStore.success('First', undefined, options);
    await tick();
    await advance(2000);
    const toast = screen.getByRole('status');
    await fireEvent.mouseEnter(toast);
    notificationStore.info('Unrelated', 0);
    await tick();
    await advance(8000);
    expect(screen.getByText('First')).toBeTruthy();
    expect(notificationStore.success('Second', undefined, options)).toBe(id);
    await tick();
    await advance(8000);
    expect(screen.getByText('Second')).toBeTruthy();
    await fireEvent.mouseLeave(toast);
    await advance(6999);
    expect(screen.getByText('Second')).toBeTruthy();
    await advance(1);
    expect(screen.queryByText('Second')).toBeNull();
    expect(screen.getByText('Unrelated')).toBeTruthy();
  });

  it('keeps focus movement within grouped controls paused and exposes localized expansion', async () => {
    locale.set('zh-CN');
    const { container } = render(SnackBarHost);
    notificationStore.info('第一项', 1000, { groupKey: 'batch', groupTitle: '批量操作' });
    notificationStore.info('第二项', 1000, { groupKey: 'batch', groupTitle: '批量操作' });
    await tick();
    expect(container.querySelector('.snackbar-host')).toBeNull();
    expect(document.querySelector('.snackbar-host')?.parentElement).toBe(document.body);
    const toast = screen.getByRole('status');
    const expand = within(toast).getByRole('button', { name: '显示详细信息' });
    const close = within(toast).getByRole('button', { name: '关闭' });
    await fireEvent.focusIn(expand);
    await fireEvent.click(expand);
    expect(expand.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(expand.getAttribute('aria-controls')!)).toBeTruthy();
    await fireEvent.focusOut(expand, { relatedTarget: close });
    await fireEvent.focusIn(close);
    await advance(5000);
    expect(screen.getByText('第一项')).toBeTruthy();
    await fireEvent.click(close);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('refreshes a group twice in the same millisecond without keeping the stale timer', async () => {
    render(SnackBarHost);
    const options = { groupKey: 'same-timestamp' };
    notificationStore.success('First', 7000, options);
    await tick();
    await advance(1000);
    notificationStore.success('Second', 7000, options);
    await tick();
    notificationStore.success('Third', 2000, options);
    await tick();
    await advance(1999);
    expect(screen.getByText('Third')).toBeTruthy();
    await advance(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('orders the newest message at the bottom even when timestamps match', async () => {
    render(SnackBarHost);
    notificationStore.info('First');
    notificationStore.success('Second');
    notificationStore.error('Third');
    await tick();
    const messages = [...document.querySelectorAll('.snackbar-copy')].map((node) => node.textContent?.trim());
    expect(messages).toEqual(['First', 'Second', 'Third']);
    expect(screen.getByRole('alert').textContent).toContain('Third');
  });

  it('delays each task independently and uses actual progress without a spinner', async () => {
    render(SnackBarHost);
    floatingProgressStore.upsert('first', 'Restoring', '2 of 10', 2, 10);
    await tick();
    await advance(500);
    floatingProgressStore.upsert('second', 'Scanning', 'Finding files', 0, 0);
    await tick();
    await advance(499);
    expect(screen.queryByText('Restoring')).toBeNull();
    await advance(1);
    const bar = screen.getByRole('progressbar', { name: 'Restoring' }) as HTMLProgressElement;
    expect(bar.value).toBe(20);
    expect(bar.closest('.snackbar')?.querySelector('fluent-spinner')).toBeNull();
    expect(screen.queryByText('Scanning')).toBeNull();
    await advance(500);
    const scan = screen.getByText('Scanning').closest('.snackbar')!;
    expect(scan.querySelector('fluent-spinner')).toBeTruthy();
    expect(scan.querySelector('progress')).toBeNull();
    floatingProgressStore.upsert('first', 'Restoring', '12 of 10', 12, 10);
    await tick();
    expect(bar.value).toBe(100);
  });

  it('never flashes completed short tasks and clears pending work on unmount', async () => {
    const { unmount } = render(SnackBarHost);
    floatingProgressStore.upsert('quick', 'Quick task', '', 0, 0);
    await tick();
    await advance(999);
    floatingProgressStore.remove('quick');
    await tick();
    await advance(1);
    expect(screen.queryByText('Quick task')).toBeNull();
    notificationStore.info('Timed');
    floatingProgressStore.upsert('pending', 'Pending task', '', 0, 0);
    await tick();
    expect(vi.getTimerCount()).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('.snackbar-host')).toBeNull();
    expect(chromeStore.snackbarStackHeight).toBe(0);
  });
});
