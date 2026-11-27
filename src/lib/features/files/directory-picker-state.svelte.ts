import { listDirectory, type ServerDirectoryEntry, type ServerDocumentEntry } from '#lib/api.ts';
import {
  normalizeDirectoryId,
  ROOT_DIRECTORY_ID,
  type DirectoryBreadcrumbSegment,
} from '#lib/features/files/file-browser.ts';
import { formatUserFacingError } from '#lib/shared/errors/user-facing-errors.ts';

export interface DirectoryPickerStateOptions {
  canLoad?: () => boolean;
  includeDocuments?: boolean;
}

export function createDirectoryPickerState(options: DirectoryPickerStateOptions = {}) {
  const { canLoad = () => true, includeDocuments = false } = options;

  let currentFolderId = $state<string | null>(null);
  let parentId = $state<string | null>(null);
  let folders = $state<ServerDirectoryEntry[]>([]);
  let documents = $state<ServerDocumentEntry[]>([]);
  let breadcrumb = $state<DirectoryBreadcrumbSegment[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  function initialize(
    folderId: string | null,
    initialBreadcrumb: DirectoryBreadcrumbSegment[] = [],
  ) {
    currentFolderId = normalizeDirectoryId(folderId);
    breadcrumb = [...initialBreadcrumb];
  }

  async function loadDirectory(folderId: string | null): Promise<boolean> {
    if (!canLoad()) return false;
    loading = true;
    loadError = null;

    try {
      const normalized = normalizeDirectoryId(folderId);
      const response = await listDirectory(normalized);
      currentFolderId = normalized;
      parentId = normalizeDirectoryId(response.parent_id);
      folders = response.folders;
      if (includeDocuments) {
        documents = response.documents;
      }
      return true;
    } catch (err) {
      loadError = formatUserFacingError(err);
      folders = [];
      if (includeDocuments) {
        documents = [];
      }
      parentId = null;
      return false;
    } finally {
      loading = false;
    }
  }

  async function navigateToFolder(folder: ServerDirectoryEntry) {
    const ok = await loadDirectory(folder.id);
    if (ok) {
      breadcrumb = [...breadcrumb, { id: folder.id, label: folder.name }];
    }
  }

  async function navigateToParent(targetId: string | null = parentId) {
    const ok = await loadDirectory(targetId);
    if (ok && breadcrumb.length > 0) {
      breadcrumb = breadcrumb.slice(0, -1);
    }
  }

  async function navigateToRoot() {
    const ok = await loadDirectory(null);
    if (ok) {
      breadcrumb = [];
    }
  }

  async function navigateByBreadcrumb(targetId: string) {
    if (targetId === ROOT_DIRECTORY_ID) {
      await navigateToRoot();
      return;
    }

    const index = breadcrumb.findIndex((segment) => segment.id === targetId);
    if (index < 0) return;
    const ok = await loadDirectory(targetId);
    if (ok) {
      breadcrumb = breadcrumb.slice(0, index + 1);
    }
  }

  return {
    get currentFolderId() { return currentFolderId; },
    get parentId() { return parentId; },
    get folders() { return folders; },
    get documents() { return documents; },
    get breadcrumb() { return breadcrumb; },
    get loading() { return loading; },
    get loadError() { return loadError; },
    initialize,
    loadDirectory,
    navigateToFolder,
    navigateToParent,
    navigateToRoot,
    navigateByBreadcrumb,
  };
}
