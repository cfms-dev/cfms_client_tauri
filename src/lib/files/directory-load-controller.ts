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

export class DirectoryLoadController {
  private generation = 0;

  constructor(private readonly fetchPage: DirectoryPageFetcher) {}

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
    const page = await this.fetchPage(folderId, cursor, pageSize);
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
