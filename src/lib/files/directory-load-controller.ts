import type { ListDirectoryPageResponse } from '$lib/api';

export type DirectoryPageFetcher = (
  folderId: string | null,
  cursor: string | null,
  pageSize: number,
) => Promise<ListDirectoryPageResponse>;

export type DirectoryLoadContinuation =
  | { status: 'complete' }
  | { status: 'cancelled' }
  | { status: 'partial-error'; cursor: string; error: unknown };

export const DIRECTORY_REQUEST_TIMEOUT_MS = 30_000;

export class DirectoryRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Directory request timed out after ${Math.ceil(timeoutMs / 1_000)} seconds.`);
    this.name = 'DirectoryRequestTimeoutError';
  }
}

export class DirectoryLoadController {
  private generation = 0;

  constructor(
    private readonly fetchPage: DirectoryPageFetcher,
    private readonly requestTimeoutMs = DIRECTORY_REQUEST_TIMEOUT_MS,
  ) {}

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  invalidate(): number {
    return this.begin();
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  async requestPage(
    generation: number,
    folderId: string | null,
    cursor: string | null,
    pageSize: number,
  ): Promise<ListDirectoryPageResponse | null> {
    const page = await withTimeout(
      this.fetchPage(folderId, cursor, pageSize),
      this.requestTimeoutMs,
    );
    return this.isCurrent(generation) ? page : null;
  }

  async continue(
    generation: number,
    folderId: string | null,
    initialCursor: string,
    pageSize: number,
    onPage: (page: ListDirectoryPageResponse) => void,
  ): Promise<DirectoryLoadContinuation> {
    let cursor = initialCursor;
    while (this.isCurrent(generation)) {
      try {
        const page = await this.requestPage(generation, folderId, cursor, pageSize);
        if (!page) return { status: 'cancelled' };
        onPage(page);
        if (!page.has_more) return { status: 'complete' };
        if (!page.next_cursor) {
          throw new Error('Directory page reported more items without a cursor.');
        }
        cursor = page.next_cursor;
      } catch (error) {
        if (!this.isCurrent(generation)) return { status: 'cancelled' };
        return { status: 'partial-error', cursor, error };
      }
    }
    return { status: 'cancelled' };
  }
}

function withTimeout<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return request;

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new DirectoryRequestTimeoutError(timeoutMs));
    }, timeoutMs);

    request.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
