// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { AccessEntry, AccessEntityType, AccessType, ListDirectoryResponse, RevisionEntry, SearchFilesResponse, SelectedUploadDirectory, ServerDirectoryInfo, ServerDocumentInfo, ServerObjectType, UploadConflictStrategy } from './types';

export interface DownloadBatchMetadata {
  batchId: string;
  batchName: string;
  batchRootId?: string | null;
  batchCreatedAt: number;
}

/** List a directory on the CFMS server via the active WSS connection.
 *
 * Pass `folderId = null` to list the root directory.
 * Returns sub-folders, documents, and the parent folder ID.
 */
export async function listDirectory(
  folderId: string | null,
): Promise<ListDirectoryResponse> {
  return invoke("list_directory", { folderId });
}

/** Request a document download from the CFMS server.
 *
 * Sends the `get_document` action, which creates a download task on the
 * server and adds it to the persistent local download queue.
 */
export async function getDocument(
  documentId: string,
  filename: string,
  batch?: DownloadBatchMetadata,
): Promise<{
  task_id: string;
  file_id: string;
  filename: string;
  file_path: string;
}> {
  return invoke("get_document", {
    documentId,
    filename,
    batchId: batch?.batchId ?? null,
    batchName: batch?.batchName ?? null,
    batchRootId: batch?.batchRootId ?? null,
    batchCreatedAt: batch?.batchCreatedAt ?? null,
  });
}

/** Ensure a relative subdirectory exists under the local download root. */
export async function ensureDownloadSubdirectory(
  relativePath: string,
): Promise<string> {
  return invoke("ensure_download_subdirectory", { relativePath });
}

/** Delete a download task from the database and remove its file from disk. */
export async function deleteDownload(taskId: string): Promise<boolean> {
  return invoke("delete_download", { taskId });
}

/** Open a completed download with the platform's default application. */
export async function openDownloadedFile(path: string): Promise<void> {
  return invoke("open_downloaded_file", { path });
}

/** Create a new directory on the CFMS server.
 *
 * Mirrors `create_directory` from the Python reference.
 * Returns the new directory's ID.
 */
export async function createDirectory(
  parentId: string | null,
  name: string,
  existsOk?: boolean,
): Promise<string> {
  return invoke("create_directory", {
    parentId,
    name,
    existsOk: existsOk ?? false,
  });
}

/** Delete a directory on the CFMS server. */
export async function deleteDirectory(folderId: string): Promise<boolean> {
  return invoke("delete_directory", { folderId });
}

/** Delete a document on the CFMS server. */
export async function deleteDocument(documentId: string): Promise<boolean> {
  return invoke("delete_document", { documentId });
}

export async function renameDirectory(
  folderId: string,
  newName: string,
): Promise<boolean> {
  return invoke("rename_directory", { folderId, newName });
}

export async function renameDocument(
  documentId: string,
  newTitle: string,
): Promise<boolean> {
  return invoke("rename_document", { documentId, newTitle });
}

export async function moveDirectory(
  folderId: string,
  targetFolderId?: string | null,
): Promise<boolean> {
  return invoke("move_directory", {
    folderId,
    targetFolderId: targetFolderId ?? null,
  });
}

export async function moveDocument(
  documentId: string,
  targetFolderId?: string | null,
): Promise<boolean> {
  return invoke("move_document", {
    documentId,
    targetFolderId: targetFolderId ?? null,
  });
}

export async function getDirectoryInfo(
  directoryId: string,
): Promise<ServerDirectoryInfo> {
  return invoke("get_directory_info", { directoryId });
}

export async function getDocumentInfo(
  documentId: string,
): Promise<ServerDocumentInfo> {
  return invoke("get_document_info", { documentId });
}

export async function setDocumentTags(
  documentId: string,
  tags: string[],
): Promise<{ tags?: string[] }> {
  return invoke("set_document_tags", { documentId, tags });
}

export async function viewAccessEntries(
  objectType: ServerObjectType,
  objectIdentifier: string,
): Promise<AccessEntry[]> {
  const data = await invoke<{ result?: AccessEntry[] }>("view_access_entries", {
    objectType,
    objectIdentifier,
  });
  return data.result ?? [];
}

export async function revokeAccess(entryId: number): Promise<boolean> {
  return invoke("revoke_access", { entryId });
}

export async function grantAccess(
  entityIdentifier: string,
  entityType: AccessEntityType,
  targetType: ServerObjectType,
  targetIdentifier: string,
  accessTypes: AccessType[],
  startTime: number,
  endTime: number,
): Promise<boolean> {
  return invoke("grant_access", {
    entityIdentifier,
    entityType,
    targetType,
    targetIdentifier,
    accessTypes,
    startTime,
    endTime,
  });
}

export async function getAccessRules(
  objectType: ServerObjectType,
  objectId: string,
): Promise<{ rules: unknown; inherit: boolean }> {
  return invoke("get_access_rules", { objectType, objectId });
}

export async function setAccessRules(
  objectType: ServerObjectType,
  objectId: string,
  accessRules: unknown,
  inheritParent: boolean,
): Promise<boolean> {
  return invoke("set_access_rules", {
    objectType,
    objectId,
    accessRules,
    inheritParent,
  });
}

export async function listRevisions(documentId: string): Promise<RevisionEntry[]> {
  const data = await invoke<{ revisions?: RevisionEntry[] }>("list_revisions", {
    documentId,
  });
  return (data.revisions ?? []).map((revision) => ({
    ...revision,
    id: String(revision.id),
    parent_id:
      revision.parent_id === null || revision.parent_id === undefined
        ? null
        : String(revision.parent_id),
  }));
}

export async function getRevision(
  revisionId: string,
  filename: string,
  isCurrent = false,
): Promise<{
  task_id: string;
  file_id: string;
  filename: string;
  file_path: string;
}> {
  return invoke("get_revision", {
    revisionId: String(revisionId),
    filename,
    isCurrent,
  });
}

export async function setCurrentRevision(
  documentId: string,
  revisionId: string,
): Promise<boolean> {
  return invoke("set_current_revision", { documentId, revisionId: String(revisionId) });
}

export async function uploadNewRevision(
  documentId: string,
  filePath: string,
): Promise<{ task_id: string; document_id: string }> {
  return invoke("upload_new_revision", { documentId, filePath });
}

export async function uploadDocumentFile(
  parentId: string | null,
  filePath: string,
  uploadId: string,
  conflictStrategy: UploadConflictStrategy = "overwrite",
  uploadName?: string,
): Promise<{
  upload_id: string;
  task_id: string | null;
  document_id: string | null;
  file_name: string;
  skipped: boolean;
  overwritten: boolean;
}> {
  return invoke("upload_document_file", {
    parentId,
    filePath,
    uploadId,
    conflictStrategy,
    uploadName: uploadName ?? null,
  });
}

export async function uploadDirectory(
  parentId: string | null,
  directoryPath: string,
  uploadId: string,
  conflictStrategy: UploadConflictStrategy = "overwrite",
  uploadName?: string,
): Promise<{
  upload_id: string;
  directory_id: string;
  total_files: number;
  uploaded_files: number;
}> {
  return invoke("upload_directory", {
    parentId,
    directoryPath,
    uploadId,
    conflictStrategy,
    uploadName: uploadName ?? null,
  });
}

export async function selectUploadDirectory(): Promise<SelectedUploadDirectory> {
  return invoke("select_upload_directory");
}

export async function classifyUploadPath(
  path: string,
): Promise<"file" | "directory"> {
  return invoke("classify_upload_path", { path });
}

export async function pauseUpload(uploadId: string): Promise<boolean> {
  return invoke("pause_upload", { uploadId });
}

export async function resumeUpload(uploadId: string): Promise<boolean> {
  return invoke("resume_upload", { uploadId });
}

export async function cancelUpload(uploadId: string): Promise<boolean> {
  return invoke("cancel_upload", { uploadId });
}

export async function searchFiles(
  query: string,
  options: {
    limit?: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    searchDocuments?: boolean;
    searchDirectories?: boolean;
  } = {},
): Promise<SearchFilesResponse> {
  const data = await invoke<Partial<SearchFilesResponse>>("search_files", {
    query,
    limit: options.limit ?? 100,
    sortBy: options.sortBy ?? "name",
    sortOrder: options.sortOrder ?? "asc",
    searchDocuments: options.searchDocuments ?? true,
    searchDirectories: options.searchDirectories ?? true,
  });
  return {
    documents: data.documents ?? [],
    directories: data.directories ?? [],
    total_count:
      data.total_count
      ?? ((data.documents?.length ?? 0) + (data.directories?.length ?? 0)),
  };
}

// ---------------------------------------------------------------------------
