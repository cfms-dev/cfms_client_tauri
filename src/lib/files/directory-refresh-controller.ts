import type { ListDirectoryResponse } from '$lib/api';
import { DirectoryLoadController, type DirectoryPageFetcher } from './directory-load-controller';
import { DIRECTORY_PAGE_SIZE } from './progressive-listing';

interface RefreshRequest {
  folderId: string | null;
  isCurrent: () => boolean;
  resolve: Array<(applied: boolean) => void>;
}

/** Serializes automatic refreshes without interrupting an explicit directory load. */
export class DirectoryRefreshController {
  private readonly loader: DirectoryLoadController;
  private blocked = true;
  private pending: RefreshRequest | null = null;
  private active: { request: RefreshRequest; abort: AbortController } | null = null;

  constructor(
    fetchPage: DirectoryPageFetcher,
    private readonly apply: (listing: ListDirectoryResponse, signal: AbortSignal) => Promise<void>,
    private readonly onError: (folderId: string | null, error: unknown) => void,
  ) {
    this.loader = new DirectoryLoadController(fetchPage);
  }

  request(folderId: string | null, isCurrent = () => true): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.pending && this.pending.folderId !== folderId) this.finish(this.pending, false);
      this.pending ??= { folderId, isCurrent, resolve: [] };
      this.pending.isCurrent = isCurrent;
      this.pending.resolve.push(resolve);
      this.drain();
    });
  }

  setBlocked(blocked: boolean) {
    this.blocked = blocked;
    this.drain();
  }

  invalidate() {
    this.loader.invalidate();
    if (this.active) {
      this.active.abort.abort();
      this.finish(this.active.request, false);
    }
    if (this.pending) this.finish(this.pending, false);
    this.pending = null;
  }

  private finish(request: RefreshRequest, applied: boolean) {
    for (const resolve of request.resolve.splice(0)) resolve(applied);
    if (this.pending === request) this.pending = null;
  }

  private drain() {
    if (this.blocked || this.active || !this.pending) return;
    const request = this.pending;
    this.pending = null;
    const abort = new AbortController();
    this.active = { request, abort };
    void this.run(request, abort.signal);
  }

  private async run(request: RefreshRequest, signal: AbortSignal) {
    const generation = this.loader.begin();
    try {
      if (!request.isCurrent()) return;
      const listing = await this.loader.collect(generation, request.folderId, DIRECTORY_PAGE_SIZE);
      if (!listing || signal.aborted || !request.isCurrent()) return;
      await this.apply(listing, signal);
      this.finish(request, !signal.aborted && request.isCurrent());
    } catch (error) {
      if (!signal.aborted && request.isCurrent()) this.onError(request.folderId, error);
    } finally {
      this.finish(request, false);
      this.active = null;
      this.drain();
    }
  }
}
