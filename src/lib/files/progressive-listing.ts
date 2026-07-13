import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';
import { sortFileEntries, type SortDirection, type SortField, type SortedFileEntries } from './sorting';

export const DIRECTORY_PAGE_SIZE = 128;

export interface ProgressiveListingSnapshot extends SortedFileEntries {
  loadedCount: number;
  complete: boolean;
}

export class ProgressiveListingAccumulator {
  private folders: ServerDirectoryEntry[] = [];
  private documents: ServerDocumentEntry[] = [];
  private nextPublishAt = DIRECTORY_PAGE_SIZE;
  private complete = false;
  private published = false;

  reset() {
    this.folders = [];
    this.documents = [];
    this.nextPublishAt = DIRECTORY_PAGE_SIZE;
    this.complete = false;
    this.published = false;
  }

  append(
    folders: ServerDirectoryEntry[],
    documents: ServerDocumentEntry[],
    complete: boolean,
    field: SortField,
    direction: SortDirection,
  ): ProgressiveListingSnapshot | null {
    this.folders.push(...folders);
    this.documents.push(...documents);
    this.complete = complete;
    const loadedCount = this.loadedCount;
    if (!complete && this.published && loadedCount < this.nextPublishAt) return null;

    const snapshot = this.snapshot(field, direction, complete);
    this.published = true;
    while (this.nextPublishAt <= loadedCount) this.nextPublishAt *= 2;
    return snapshot;
  }

  snapshot(
    field: SortField,
    direction: SortDirection,
    complete = this.complete,
  ): ProgressiveListingSnapshot {
    const sorted = sortFileEntries(this.folders, this.documents, field, direction);
    return { ...sorted, loadedCount: this.loadedCount, complete };
  }

  get loadedCount() {
    return this.folders.length + this.documents.length;
  }
}
