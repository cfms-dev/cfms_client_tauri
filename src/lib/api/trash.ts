// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { DeletedItemsResponse } from './types';

export async function listDeletedItems(
  folderId = "/",
): Promise<DeletedItemsResponse> {
  const data = await invoke<Partial<DeletedItemsResponse>>("list_deleted_items", {
    folderId,
  });
  return {
    folders: data.folders ?? [],
    documents: data.documents ?? [],
  };
}

export async function restoreDocument(
  documentId: string,
  newTitle?: string | null,
  targetFolderId?: string | null,
): Promise<boolean> {
  return invoke("restore_document", {
    documentId,
    newTitle: newTitle ?? null,
    targetFolderId: targetFolderId ?? null,
  });
}

export async function restoreDirectory(
  folderId: string,
  newName?: string | null,
  targetParentId?: string | null,
): Promise<boolean> {
  return invoke("restore_directory", {
    folderId,
    newName: newName ?? null,
    targetParentId: targetParentId ?? null,
  });
}

export async function purgeDocument(documentId: string): Promise<boolean> {
  return invoke("purge_document", { documentId });
}

export async function purgeDirectory(folderId: string): Promise<boolean> {
  return invoke("purge_directory", { folderId });
}

// ---------------------------------------------------------------------------
