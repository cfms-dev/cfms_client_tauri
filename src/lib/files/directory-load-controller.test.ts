import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListDirectoryPageResponse } from '$lib/api';
import {
  DirectoryLoadController,
  DirectoryRequestTimeoutError,
} from './directory-load-controller';

function page(id: string, nextCursor: string | null): ListDirectoryPageResponse {
  return {
    folders: [],
    documents: [{ id, title: id, size: 1, last_modified: 1 }],
    parent_id: null,
    page_size: 128,
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
  };
}

describe('DirectoryLoadController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops a page that resolves after navigation changes generation', async () => {
    let resolvePage!: (value: ListDirectoryPageResponse) => void;
    const fetcher = vi.fn(() => new Promise<ListDirectoryPageResponse>((resolve) => { resolvePage = resolve; }));
    const controller = new DirectoryLoadController(fetcher);
    const firstGeneration = controller.begin();
    const request = controller.requestPage(firstGeneration, null, null, 128);

    controller.begin();
    resolvePage(page('stale', null));

    await expect(request).resolves.toBeNull();
  });

  it('returns the failed cursor and resumes without replaying successful pages', async () => {
    let failSecondPage = true;
    const fetcher = vi.fn(async (_folderId: string | null, cursor: string | null) => {
      if (cursor === 'cursor-1') return page('one', 'cursor-2');
      if (cursor === 'cursor-2' && failSecondPage) throw new Error('temporary');
      return page('two', null);
    });
    const controller = new DirectoryLoadController(fetcher);
    const generation = controller.begin();
    const received: string[] = [];
    const onPage = (result: ListDirectoryPageResponse) => received.push(result.documents[0].id);

    const failed = await controller.continue(generation, null, 'cursor-1', 128, onPage);
    expect(failed).toMatchObject({ status: 'partial-error', cursor: 'cursor-2' });
    failSecondPage = false;
    const resumed = await controller.continue(generation, null, 'cursor-2', 128, onPage);

    expect(resumed).toEqual({ status: 'complete' });
    expect(received).toEqual(['one', 'two']);
  });

  it('rejects a page request that never settles instead of leaving the UI loading forever', async () => {
    vi.useFakeTimers();
    const controller = new DirectoryLoadController(
      () => new Promise<ListDirectoryPageResponse>(() => {}),
      5_000,
    );
    const request = controller.requestPage(controller.begin(), null, null, 128);
    const rejection = expect(request).rejects.toEqual(new DirectoryRequestTimeoutError(5_000));

    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
  });

  it('clears the request timeout after a page resolves', async () => {
    vi.useFakeTimers();
    const controller = new DirectoryLoadController(async () => page('ready', null), 5_000);

    await expect(controller.requestPage(controller.begin(), null, null, 128)).resolves.toEqual(
      page('ready', null),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
