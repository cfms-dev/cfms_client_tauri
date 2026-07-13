// CFMS Client - typed Tauri IPC wrappers.
import { Channel, invoke } from '@tauri-apps/api/core';
import type { AccessEntry, AccessEntityType, AccessType, DirectoryFileConflictResolution, DirectoryUploadConflict, ListDirectoryPageResponse, ListDirectoryResponse, RevisionEntry, SearchFilesResponse, SelectedUploadDirectory, ServerDirectoryInfo, ServerDocumentInfo, ServerObjectType, UploadConflictStrategy } from './types';

export interface DownloadBatchMetadata {
  batchId: string;
  batchName: string;
  batchRootId?: string | null;
  batchCreatedAt: number;
  batchEstimatedTotal?: number | null;
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

export async function listDirectoryPage(
  folderId: string | null,
  cursor: string | null = null,
  pageSize = 128,
): Promise<ListDirectoryPageResponse> {
  return invoke("list_directory_page", { folderId, cursor, pageSize });
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
    batchEstimatedTotal: batch?.batchEstimatedTotal ?? null,
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
export async function openDownloadedFile(taskId: string): Promise<void> {
  return invoke("open_downloaded_file", { taskId });
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

export async function deleteRevision(revisionId: string): Promise<boolean> {
  return invoke("delete_revision", { revisionId: String(revisionId) });
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
  conflictStrategy: UploadConflictStrategy = "fail",
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
  conflictStrategy: UploadConflictStrategy = "fail",
  uploadName?: string,
  conflictResolutions: DirectoryFileConflictResolution[] = [],
): Promise<{
  upload_id: string;
  directory_id: string;
  total_files: number;
  uploaded_files: number;
  skipped: boolean;
}> {
  return invoke("upload_directory", {
    parentId,
    directoryPath,
    uploadId,
    conflictStrategy,
    conflictResolutions,
    uploadName: uploadName ?? null,
  });
}

export async function inspectUploadDirectoryConflicts(
  parentId: string | null,
  directoryPath: string,
  uploadName?: string,
  onConflict?: (conflict: DirectoryUploadConflict) => void | Promise<void>,
): Promise<void> {
  type ConflictEvent =
    | { event: 'Conflict'; data: DirectoryUploadConflict }
    | { event: 'Finished' };

  let pendingConflict = Promise.resolve();
  let handlerError: unknown;
  let finishScan!: () => void;
  const scanFinished = new Promise<void>((resolve) => {
    finishScan = resolve;
  });
  const conflictChannel = new Channel<ConflictEvent>((event) => {
    if (event.event === 'Finished') {
      void pendingConflict.then(finishScan);
      return;
    }
    pendingConflict = pendingConflict
      .then(() => onConflict?.(event.data))
      .catch((error) => {
        handlerError ??= error;
      });
  });

  await invoke("inspect_upload_directory_conflicts", {
    parentId,
    directoryPath,
    uploadName: uploadName ?? null,
    onConflict: conflictChannel,
  });
  await scanFinished;
  if (handlerError) throw handlerError;
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
    pageSize?: number;
    cursor?: string | null;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
    searchDocuments?: boolean;
    searchDirectories?: boolean;
  } = {},
): Promise<SearchFilesResponse> {
  const data = await invoke<Partial<SearchFilesResponse>>("search_files", {
    query,
    pageSize: options.pageSize ?? 128,
    cursor: options.cursor ?? null,
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
    page_size: data.page_size ?? options.pageSize ?? 128,
    next_cursor: data.next_cursor ?? null,
    has_more: data.has_more ?? false,
  };
}

// ---------------------------------------------------------------------------
