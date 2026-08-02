import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerDocumentEntry } from '$lib/api';
import { createProgressiveDirectorySorter, type ProgressiveSortSnapshot } from './sort-worker-client';

function documents(count: number): ServerDocumentEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `document-${index}`,
    title: `Document ${index}`,
    size: index,
    last_modified: index,
  }));
}

class SilentWorker {
  static instances: SilentWorker[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    SilentWorker.instances.push(this);
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  SilentWorker.instances = [];
});

describe('createProgressiveDirectorySorter fallback', () => {
  it('does not publish an empty in-flight generation and applies the latest sort revision', () => {
    const snapshots: ProgressiveSortSnapshot[] = [];
    const onError = vi.fn();
    const sorter = createProgressiveDirectorySorter((snapshot) => snapshots.push(snapshot), onError);

    sorter.reset(1, 1, 'name', 'asc');
    sorter.resort(1, 2, 'size', 'desc');
    expect(snapshots).toEqual([]);

    sorter.append(1, 2, [], documents(128), false);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ generation: 1, revision: 2, loadedCount: 128 });
    expect(snapshots[0].documents[0].size).toBe(127);
    expect(onError).not.toHaveBeenCalled();
    sorter.dispose();
  });

  it('publishes the bounded first page without waiting for a silent worker', () => {
    vi.stubGlobal('Worker', SilentWorker as unknown as typeof Worker);
    const snapshots: ProgressiveSortSnapshot[] = [];
    const onError = vi.fn();
    const sorter = createProgressiveDirectorySorter((snapshot) => snapshots.push(snapshot), onError);

    sorter.reset(1, 1, 'name', 'asc');
    sorter.append(1, 1, [], documents(29), true);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ generation: 1, loadedCount: 29, complete: true });
    expect(onError).not.toHaveBeenCalled();
    sorter.dispose();
  });

  it('switches to the mirrored main-thread state when the worker stops responding', () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', SilentWorker as unknown as typeof Worker);
    const snapshots: ProgressiveSortSnapshot[] = [];
    const onError = vi.fn();
    const sorter = createProgressiveDirectorySorter((snapshot) => snapshots.push(snapshot), onError);

    sorter.reset(1, 1, 'name', 'asc');
    sorter.append(1, 1, [], documents(128), false);
    sorter.append(1, 1, [], documents(128), false);
    expect(snapshots.map((snapshot) => snapshot.loadedCount)).toEqual([128]);

    vi.advanceTimersByTime(1_000);

    expect(snapshots.map((snapshot) => snapshot.loadedCount)).toEqual([128, 256]);
    expect(SilentWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    sorter.dispose();
  });
});
