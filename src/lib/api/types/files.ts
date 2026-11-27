import type { CursorPageMeta } from './common';

/** A directory/folder entry returned by the server's list_directory action. */
export interface ServerDirectoryEntry {
  id: string;
  name: string;
  created_time: number | null;
  effective_mask?: number;
}

/** A document/file entry returned by the server's list_directory action. */
export interface ServerDocumentEntry {
  id: string;
  title: string;
  size: number | null;
  last_modified: number | null;
  effective_mask?: number;
}

export interface ServerDocumentMetadata {
  tags: string[];
  creator?: string | null;
  last_modified_by?: string | null;
}

export interface ServerDocumentInfo {
  document_id?: string;
  title?: string;
  size?: number | null;
  created_time?: number | null;
  last_modified?: number | null;
  parent_id?: string | null;
  metadata?: ServerDocumentMetadata;
  effective_mask?: number;
}

export interface ServerDirectoryInfo {
  directory_id?: string;
  name?: string;
  count_of_child?: number;
  created_time?: number | null;
  parent_id?: string | null;
  effective_mask?: number;
}

export type ServerObjectType = "document" | "directory";

export interface RevisionEntry {
  id: string;
  parent_id?: string | null;
  created_time?: number | null;
  is_current?: boolean;
}

export interface RevisionListResponse {
  revisions: RevisionEntry[];
  effective_mask?: number;
}

/** Response data for the list_directory server action. */
export interface ListDirectoryResponse {
  folders: ServerDirectoryEntry[];
  documents: ServerDocumentEntry[];
  parent_id: string | null;
  effective_mask?: number;
}

export interface ListDirectoryPageResponse extends ListDirectoryResponse, CursorPageMeta {}

export interface SearchDirectoryEntry extends ServerDirectoryEntry {
  parent_id?: string | null;
}

export interface SearchDocumentEntry {
  id: string;
  name?: string;
  title?: string;
  parent_id?: string | null;
  size?: number | null;
  last_modified?: number | null;
  effective_mask?: number;
}

export type SearchResultItem =
  | ({ type: "directory" } & SearchDirectoryEntry)
  | ({ type: "document" } & SearchDocumentEntry);

export interface SearchFilesResponse extends CursorPageMeta {
  items: SearchResultItem[];
  total_count: number;
}

export interface DeletedDirectoryEntry {
  id: string;
  name: string;
  created_time?: number | null;
  effective_mask?: number;
}

export interface DeletedDocumentEntry {
  id: string;
  title: string;
  created_time?: number | null;
  effective_mask?: number;
}

export interface DeletedItemsResponse {
  folders: DeletedDirectoryEntry[];
  documents: DeletedDocumentEntry[];
  parent_id?: string | null;
  effective_mask?: number;
}

export interface FileShortcutValidationResult {
  invalid_count: number;
  invalid_files: string[];
  invalid_directories: string[];
  access_denied_files: string[];
  access_denied_directories: string[];
}
