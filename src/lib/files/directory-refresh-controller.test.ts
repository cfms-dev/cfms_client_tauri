import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListDirectoryPageResponse } from '$lib/api';
import { DirectoryRefreshController } from './directory-refresh-controller';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function page(id: string, cursor: string | null = null): ListDirectoryPageResponse {
  return {
    folders: [], documents: [{ id, title: id, size: 1, last_modified: 1 }],
    parent_id: 'parent', page_size: 128, next_cursor: cursor, has_more: cursor !== null,
  };
}

afterEach(() => vi.useRealTimers());

describe('automatic directory refreshes', () => {
  it('publishes all pages together, keeping the existing list until the replacement is ready', async () => {
    const last = deferred<ListDirectoryPageResponse>();
    const fetcher = vi.fn().mockResolvedValueOnce(page('first', 'next')).mockReturnValueOnce(last.promise);
    const apply = vi.fn().mockResolvedValue(undefined);
    const refresh = new DirectoryRefreshController(fetcher, apply, vi.fn());
    refresh.setBlocked(false);
    const result = refresh.request('folder');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(apply).not.toHaveBeenCalled();
    last.resolve(page('last'));
    await expect(result).resolves.toBe(true);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0]).toMatchObject({ parent_id: 'parent', documents: [{ id: 'first' }, { id: 'last' }] });
  });

  it('coalesces requests during explicit loading and waits for it to settle', async () => {
    const fetcher = vi.fn().mockResolvedValue(page('complete'));
    const apply = vi.fn().mockResolvedValue(undefined);
    const refresh = new DirectoryRefreshController(fetcher, apply, vi.fn());
    const results = [refresh.request('folder'), refresh.request('folder'), refresh.request('folder')];
    expect(fetcher).not.toHaveBeenCalled();
    refresh.setBlocked(false);
    await expect(Promise.all(results)).resolves.toEqual([true, true, true]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('serializes refreshes and merges events received during an active request into one follow-up', async () => {
    const first = deferred<ListDirectoryPageResponse>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(page('updated'));
    const refresh = new DirectoryRefreshController(fetcher, vi.fn().mockResolvedValue(undefined), vi.fn());
    refresh.setBlocked(false);
    const results = [refresh.request('folder'), refresh.request('folder'), refresh.request('folder')];
    expect(fetcher).toHaveBeenCalledOnce();
    first.resolve(page('initial'));
    await expect(Promise.all(results)).resolves.toEqual([true, true, true]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('discards an incomplete refresh and reports its error once', async () => {
    const cause = new Error('offline');
    const fetcher = vi.fn().mockResolvedValueOnce(page('partial', 'next')).mockRejectedValueOnce(cause);
    const apply = vi.fn();
    const onError = vi.fn();
    const refresh = new DirectoryRefreshController(fetcher, apply, onError);
    refresh.setBlocked(false);
    await expect(refresh.request('folder')).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledExactlyOnceWith('folder', cause);
  });

  it('invalidates active and queued work on navigation or unmount and ignores late errors', async () => {
    const pending = deferred<ListDirectoryPageResponse>();
    const apply = vi.fn();
    const onError = vi.fn();
    const refresh = new DirectoryRefreshController(() => pending.promise, apply, onError);
    refresh.setBlocked(false);
    const results = [refresh.request('old'), refresh.request('old')];
    refresh.setBlocked(true);
    refresh.invalidate();
    await expect(Promise.all(results)).resolves.toEqual([false, false]);
    pending.reject(new Error('late failure'));
    await Promise.resolve();
    await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not apply a result when its directory or account context has changed', async () => {
    const pending = deferred<ListDirectoryPageResponse>();
    const apply = vi.fn();
    const refresh = new DirectoryRefreshController(() => pending.promise, apply, vi.fn());
    refresh.setBlocked(false);
    let current = true;
    const result = refresh.request('folder', () => current);
    current = false;
    pending.resolve(page('stale'));
    await expect(result).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it('aborts staged sorting when an explicit load takes over', async () => {
    let signal!: AbortSignal;
    const apply = vi.fn((_listing, abort: AbortSignal) => new Promise<void>((resolve) => {
      signal = abort;
      abort.addEventListener('abort', () => resolve(), { once: true });
    }));
    const refresh = new DirectoryRefreshController(async () => page('ready'), apply, vi.fn());
    refresh.setBlocked(false);
    const result = refresh.request('folder');
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    refresh.setBlocked(true);
    refresh.invalidate();
    expect(signal.aborted).toBe(true);
    await expect(result).resolves.toBe(false);
  });

  it('times out stalled requests and allows a later retry', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(page('retry'));
    const onError = vi.fn();
    const refresh = new DirectoryRefreshController(fetcher, vi.fn().mockResolvedValue(undefined), onError);
    refresh.setBlocked(false);
    const result = refresh.request('folder');
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toBe(false);
    expect(onError.mock.calls[0][1].name).toBe('DirectoryRequestTimeoutError');
    await expect(refresh.request('folder')).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
