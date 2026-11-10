import type { CursorPageMeta } from './common';

export interface FileEntry {
  path: string;
  size: number;
  is_dir: boolean;
  modified: number | null;
}

/** A directory/folder entry returned by the server's list_directory action. */
export interface ServerDirectoryEntry {
  id: string;
  name: string;
  created_time: number | null;
}

/** A document/file entry returned by the server's list_directory action. */
export interface ServerDocumentEntry {
  id: string;
  title: string;
  size: number | null;
  last_modified: number | null;
}

export type DirectoryListingItem =
  | ({ type: "directory" } & ServerDirectoryEntry)
  | ({ type: "document" } & ServerDocumentEntry);

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
  access_rules?: unknown;
  metadata?: ServerDocumentMetadata;
  info_code?: number | null;
}

export interface ServerDirectoryInfo {
  directory_id?: string;
  name?: string;
  count_of_child?: number;
  created_time?: number | null;
  parent_id?: string | null;
  access_rules?: unknown;
  info_code?: number | null;
}

export type ServerObjectType = "document" | "directory";

export interface RevisionEntry {
  id: string;
  parent_id?: string | null;
  created_time?: number | null;
  is_current?: boolean;
}

/** Response data for the list_directory server action. */
export interface ListDirectoryResponse {
  folders: ServerDirectoryEntry[];
  documents: ServerDocumentEntry[];
  parent_id: string | null;
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
}

export type SearchResultItem =
  | ({ type: "directory" } & SearchDirectoryEntry)
  | ({ type: "document" } & SearchDocumentEntry);

export interface SearchFilesResponse extends CursorPageMeta {
  documents: SearchDocumentEntry[];
  directories: SearchDirectoryEntry[];
  total_count: number;
}

export interface DeletedDirectoryEntry {
  id: string;
  name: string;
  created_time?: number | null;
}

export interface DeletedDocumentEntry {
  id: string;
  title: string;
  created_time?: number | null;
}

export interface DeletedItemsResponse {
  folders: DeletedDirectoryEntry[];
  documents: DeletedDocumentEntry[];
}

export interface FileMetadata {
  file_size: number | null;
  chunk_size: number;
  total_chunks: number;
}

export interface NodeLookupResponse {
  node_ids: string[];
}

export interface FileShortcutValidationResult {
  invalid_count: number;
  invalid_files: string[];
  invalid_directories: string[];
  access_denied_files: string[];
  access_denied_directories: string[];
}
