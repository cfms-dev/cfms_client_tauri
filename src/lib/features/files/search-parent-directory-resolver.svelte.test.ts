import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerDirectoryInfo } from '#lib/api.ts';
import { createSearchParentDirectoryResolver } from './search-parent-directory-resolver.svelte.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('search-parent-directory-resolver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips root directory IDs without calling getDirectoryInfo', async () => {
    const fetchDirectoryInfo = vi.fn();
    const resolver = createSearchParentDirectoryResolver({
      delayMs: 250,
      fetchDirectoryInfo,
    });

    const releaseRoot = resolver.observe('/');
    const releaseBlank = resolver.observe('   ');
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchDirectoryInfo).not.toHaveBeenCalled();
    expect(resolver.resolutions).toEqual({});
    releaseRoot();
    releaseBlank();
  });

  it('delays fetching until the settle delay elapses and cancels if unobserved early', async () => {
    const fetchDirectoryInfo = vi.fn().mockResolvedValue({
      directory_id: 'dir-a',
      name: 'Configs',
    });
    const resolver = createSearchParentDirectoryResolver({
      delayMs: 250,
      fetchDirectoryInfo,
    });

    // Scrolled past before delay elapses -> never fetched
    const releaseFast = resolver.observe('dir-fast');
    await vi.advanceTimersByTimeAsync(150);
    releaseFast();
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchDirectoryInfo).not.toHaveBeenCalled();

    // Remains visible past delay -> fetched once and resolved
    const releaseA = resolver.observe('dir-a');
    await vi.advanceTimersByTimeAsync(249);
    expect(fetchDirectoryInfo).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchDirectoryInfo).toHaveBeenCalledOnce();
    expect(fetchDirectoryInfo).toHaveBeenCalledWith('dir-a');

    await Promise.resolve();
    expect(resolver.resolutions['dir-a']).toEqual({
      status: 'resolved',
      name: 'Configs',
      revealed: false,
    });

    resolver.markRevealed('dir-a');
    expect(resolver.resolutions['dir-a']).toEqual({
      status: 'resolved',
      name: 'Configs',
      revealed: true,
    });
    releaseA();
  });

  it('deduplicates repeated observations and enforces max concurrency in FIFO order', async () => {
    const d1 = deferred<ServerDirectoryInfo>();
    const d2 = deferred<ServerDirectoryInfo>();
    const d3 = deferred<ServerDirectoryInfo>();
    const fetchDirectoryInfo = vi
      .fn()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise)
      .mockReturnValueOnce(d3.promise);

    const resolver = createSearchParentDirectoryResolver({
      delayMs: 100,
      maxConcurrency: 2,
      fetchDirectoryInfo,
    });

    const r1a = resolver.observe('dir-1');
    const r1b = resolver.observe('dir-1');
    const r2 = resolver.observe('dir-2');
    const r3 = resolver.observe('dir-3');

    await vi.advanceTimersByTimeAsync(100);
    expect(fetchDirectoryInfo).toHaveBeenCalledTimes(2);
    expect(fetchDirectoryInfo.mock.calls.map(([id]) => id)).toEqual(['dir-1', 'dir-2']);

    // Releasing one of two observations for dir-1 keeps it observed
    r1a();
    d1.resolve({ directory_id: 'dir-1', name: 'Alpha' });
    await vi.waitFor(() => expect(fetchDirectoryInfo).toHaveBeenCalledTimes(3));
    expect(fetchDirectoryInfo).toHaveBeenLastCalledWith('dir-3');

    d2.resolve({ directory_id: 'dir-2', name: 'Beta' });
    d3.resolve({ directory_id: 'dir-3', name: 'Gamma' });
    await vi.waitFor(() => expect(resolver.resolutions['dir-3']?.status).toBe('resolved'));

    expect(resolver.resolutions['dir-1']).toEqual({ status: 'resolved', name: 'Alpha', revealed: false });
    expect(resolver.resolutions['dir-2']).toEqual({ status: 'resolved', name: 'Beta', revealed: false });
    expect(resolver.resolutions['dir-3']).toEqual({ status: 'resolved', name: 'Gamma', revealed: false });

    r1b();
    r2();
    r3();
  });

  it('marks 403/404/410 and access-denied errors as inaccessible, pauses on 429/503, and keeps transient errors unresolved', async () => {
    const fetchDirectoryInfo = vi.fn(async (id: string) => {
      if (id === 'dir-403') throw new Error('Server returned 403: Forbidden');
      if (id === 'dir-404') throw new Error('Server returned 404: Not Found');
      if (id === 'dir-denied') throw new Error('Access denied: missing read permission');
      if (id === 'dir-net') throw new Error('WebSocket timeout');
      if (id === 'dir-429') throw new Error('Server returned 429: Too Many Requests');
      return { directory_id: id, name: 'ShouldNotRun' };
    });

    const resolver = createSearchParentDirectoryResolver({
      delayMs: 50,
      maxConcurrency: 4,
      fetchDirectoryInfo,
    });

    resolver.observe('dir-403');
    resolver.observe('dir-404');
    resolver.observe('dir-denied');
    resolver.observe('dir-net');

    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => expect(resolver.resolutions['dir-denied']?.status).toBe('inaccessible'));

    expect(resolver.resolutions['dir-403']).toEqual({ status: 'inaccessible' });
    expect(resolver.resolutions['dir-404']).toEqual({ status: 'inaccessible' });
    expect(resolver.resolutions['dir-denied']).toEqual({ status: 'inaccessible' });
    expect(resolver.resolutions['dir-net']).toBeUndefined();

    // 429 pauses subsequent automatic resolutions without marking inaccessible
    resolver.observe('dir-429');
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    await Promise.resolve();
    expect(resolver.resolutions['dir-429']).toBeUndefined();

    resolver.observe('dir-after-429');
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchDirectoryInfo).not.toHaveBeenCalledWith('dir-after-429');
  });

  it('preserves cache on cancelPending and drops stale in-flight responses on reset', async () => {
    const pending = deferred<ServerDirectoryInfo>();
    const fetchDirectoryInfo = vi
      .fn()
      .mockResolvedValueOnce({ directory_id: 'dir-cached', name: 'Cached' })
      .mockReturnValueOnce(pending.promise);

    const resolver = createSearchParentDirectoryResolver({
      delayMs: 50,
      fetchDirectoryInfo,
    });

    resolver.observe('dir-cached');
    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => expect(resolver.resolutions['dir-cached']?.status).toBe('resolved'));

    // Queue another delayed ID, then cancelPending before timer fires
    resolver.observe('dir-cancelled');
    resolver.cancelPending();
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchDirectoryInfo).toHaveBeenCalledTimes(1);
    expect(resolver.resolutions['dir-cached']).toEqual({
      status: 'resolved',
      name: 'Cached',
      revealed: false,
    });

    // Start an in-flight request, then reset before it resolves
    resolver.observe('dir-stale');
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchDirectoryInfo).toHaveBeenCalledTimes(2);

    resolver.reset();
    expect(resolver.resolutions).toEqual({});

    pending.resolve({ directory_id: 'dir-stale', name: 'StaleName' });
    await Promise.resolve();
    await Promise.resolve();
    expect(resolver.resolutions).toEqual({});
  });
});
