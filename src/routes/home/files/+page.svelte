<script lang="ts">
  // File Manager page
  //
  // Browses files and folders on the CFMS server via the `list_directory`
  // and `get_document` actions sent over the active WSS connection.
  //
  // Reference: get_directory / get_document in reference/src/include/ui/util/path.py

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { open } from '@tauri-apps/plugin-dialog';
  import { _ as t } from 'svelte-i18n';
  import {
    listDirectory,
    loadUserPreference,
    classifyUploadPath,
    getDocument,
    getRevision,
    createDirectory,
    deleteDirectory,
    deleteDocument,
    ensureDownloadSubdirectory,
    getAccessRules,
    getDirectoryInfo,
    getDocumentInfo,
    grantAccess,
    listRevisions,
    moveDirectory,
    moveDocument,
    renameDirectory,
    renameDocument,
    revokeAccess,
    setAccessRules,
    setCurrentRevision,
    setDocumentTags,
    searchFiles,
    selectUploadDirectory,
    uploadDirectory,
    uploadDocumentFile,
    uploadNewRevision,
    viewAccessEntries,
    type AccessEntry,
    type DownloadBatchMetadata,
    type RevisionEntry,
    type SearchDirectoryEntry,
    type SearchDocumentEntry,
    type SearchFilesResponse,
    type UploadRevisionProgressEvent,
    type UserPreference,
  } from '$lib/api';
  import type {
    ServerDirectoryEntry,
    ServerDocumentEntry,
    ServerObjectType,
  } from '$lib/api';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import AuthorizeAccessDialog from '$lib/components/AuthorizeAccessDialog.svelte';
  import AccessRulesManager from '$lib/components/AccessRulesManager.svelte';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import {
    beginDownloadBatch,
    finishDownloadBatch,
    addDiscoveredDownloadBatchItems,
    isDownloadBatchStop,
    markDownloadBatchFailed,
    markDownloadBatchQueued,
    setDownloadBatchPhase,
    waitForDownloadBatchResume,
  } from '$lib/download-batch-control';
  import FileTable from '$lib/components/files/FileTable.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import MdCheckbox from '$lib/components/MdCheckbox.svelte';
  import ManageListEditorDialog from '$lib/components/ManageListEditorDialog.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import MoveTargetDialog from '$lib/components/MoveTargetDialog.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import VirtualList from '$lib/components/VirtualList.svelte';
  import { accessEntrySubject } from '$lib/access-entries';
  import type { AccessGrantFormValue } from '$lib/access-grants';
  import type { AccessRulesRecord } from '$lib/access-rules';
  import type { ContextMenuItem } from '$lib/components/context-menu';
  import { dialogStore } from '$lib/dialogs.svelte';
  import { normalizeDirectoryId, sameDirectoryId, type DirectoryBreadcrumbSegment } from '$lib/file-browser';
  import {
    directoryToRecord,
    documentToRecord,
    type FilePreferenceScope,
    type FileRecord,
    isFavoriteRecord,
    rememberVisit,
    setFavoriteRecord,
  } from '$lib/file-preferences';
  import { formatBytes, formatDate, formatError, formatUnknown, isPickerCancel } from '$lib/files/formatting';
  import { graphLineColor, graphWidth, laneX, buildRevisionRows } from '$lib/files/revision-graph';
  import { sortFileEntries, type SortDirection, type SortField } from '$lib/files/sorting';
  import { shouldDeferFileSort, sortFileEntriesAsync } from '$lib/files/sort-worker-client';
  import { isAndroidTreeUri, uploadDisplayName } from '$lib/files/upload-names';
  import { shortIdentifier } from '$lib/identifiers';
  import type { IconName } from '$lib/icons';
  import { authStore, floatingProgressStore, notificationStore, serverStateStore, uploadStore } from '$lib/stores.svelte';

  type SearchResultRow =
    | { kind: 'directory'; directory: SearchDirectoryEntry }
    | { kind: 'document'; document: SearchDocumentEntry };

  type DownloadQueueItem = {
    document: Pick<ServerDocumentEntry, 'id' | 'title'>;
    pathParts: string[];
  };

  // --- Navigation state ---
  let currentFolderId = $state<string | null>(null);
  let folders = $state<ServerDirectoryEntry[]>([]);
  let documents = $state<ServerDocumentEntry[]>([]);
  let parentId = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let status = $state<string | null>(null);
  let searchQuery = $state('');
  let navigationRootId = $state<string | null>(null);
  let navigationRootLabel = $state<string | null>(null);
  let userPreference = $state<UserPreference | null>(null);
  let batchBusy = $state(false);

  // Selection mode
  let selectMode = $state(false);
  let selectedFolderIds = $state<Set<string>>(new Set());
  let selectedDocumentIds = $state<Set<string>>(new Set());
  let sortField = $state<SortField>('name');
  let sortDirection = $state<SortDirection>('asc');
  let sortRequestId = 0;

  // Context menu state
  let contextMenu = $state<{
    open: boolean;
    x: number;
    y: number;
    kind: 'folder' | 'document' | null;
    item: ServerDirectoryEntry | ServerDocumentEntry | null;
  }>({ open: false, x: 0, y: 0, kind: null, item: null });
  let detailTitle = $state<string | null>(null);
  let detailRows = $state<Array<{ label: string; value: string }>>([]);
  let accessEntriesDialog = $state<{
    title: string;
    objectType: ServerObjectType;
    objectId: string;
    entries: AccessEntry[];
  } | null>(null);
  let authorizeDialog = $state<{
    title: string;
    targetType: ServerObjectType;
    targetIdentifier: string;
    targetName: string;
    saving: boolean;
  } | null>(null);
  let accessRulesDialog = $state<{
    title: string;
    objectType: ServerObjectType;
    objectId: string;
    rules: unknown;
    inheritParent: boolean;
    saving: boolean;
  } | null>(null);
  let moveTargetDialog = $state<{
    objectType: ServerObjectType;
    objectId: string;
    objectName: string;
    originalParentId: string | null;
    excludedDirectoryIds: string[];
    saving: boolean;
  } | null>(null);
  let batchMoveDialog = $state<{
    excludedDirectoryIds: string[];
    saving: boolean;
  } | null>(null);
  let revisionsDialog = $state<{
    title: string;
    documentId: string;
    filename: string;
    entries: RevisionEntry[];
  } | null>(null);
  let documentTagsDialog = $state<{
    documentId: string;
    title: string;
    tags: string[];
  } | null>(null);
  let uploadProgress = $state<{
    documentId: string;
    taskId: string;
    currentBytes: number;
    totalBytes: number;
    progress: number;
  } | null>(null);
  let dragUploadActive = $state(false);
  let dragUploadDepth = $state(0);
  let searchDialog = $state<{
    open: boolean;
    query: string;
    searchDocuments: boolean;
    searchDirectories: boolean;
    limit: number;
    loading: boolean;
    results: SearchFilesResponse | null;
  }>({
    open: false,
    query: '',
    searchDocuments: true,
    searchDirectories: true,
    limit: 100,
    loading: false,
    results: null,
  });

  // Breadcrumb navigation history — each entry records the folder name and its
  // server-side ID so we can jump back to any ancestor.
  let navHistory = $state<Array<{ label: string; id: string }>>([]);

  const breadcrumbSegments = $derived(
    [
      ...(navigationRootId !== null
        ? [{ label: navigationRootLabel ?? shortIdentifier(navigationRootId), path: navigationRootId }]
        : []),
      ...navHistory.map((h) => ({ label: h.label, path: h.id })),
    ],
  );
  const moveInitialBreadcrumb = $derived<DirectoryBreadcrumbSegment[]>(
    breadcrumbSegments
      .filter((segment) => segment.path !== '/')
      .map((segment) => ({ label: segment.label, id: segment.path })),
  );
  const contextMenuItems = $derived.by<ContextMenuItem[]>(() => getContextMenuItems());
  const revisionRows = $derived(
    revisionsDialog ? buildRevisionRows(revisionsDialog.entries) : [],
  );
  const searchResultRows = $derived.by<SearchResultRow[]>(() => {
    if (!searchDialog.results) return [];

    return [
      ...searchDialog.results.directories.map((directory) => ({
        kind: 'directory' as const,
        directory,
      })),
      ...searchDialog.results.documents.map((document) => ({
        kind: 'document' as const,
        document,
      })),
    ];
  });
  const uploadActiveCount = $derived(uploadStore.activeTasks.length);
  const parentTargetId = $derived.by<string | null | undefined>(() => {
    if (
      navigationRootId !== null
      && navHistory.length === 0
      && sameDirectoryId(currentFolderId, navigationRootId)
    ) {
      return undefined;
    }

    if (parentId !== null) return parentId;

    const currentHistoryEntry = navHistory[navHistory.length - 1];
    if (currentHistoryEntry && sameDirectoryId(currentFolderId, currentHistoryEntry.id)) {
      return navHistory[navHistory.length - 2]?.id ?? null;
    }

    return undefined;
  });
  const canGoToParent = $derived(parentTargetId !== undefined);

  $effect(() => {
    if (!status) return;
    notificationStore.success(status);
    status = null;
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  // --- Data loading ---

  function applyDirectoryEntries(
    nextFolders: ServerDirectoryEntry[],
    nextDocuments: ServerDocumentEntry[],
  ) {
    const requestId = ++sortRequestId;
    if (shouldDeferFileSort(nextFolders.length, nextDocuments.length)) {
      folders = nextFolders;
      documents = nextDocuments;
      queueDirectorySort(requestId, nextFolders, nextDocuments, true);
      return;
    }

    const sorted = sortFileEntries(nextFolders, nextDocuments, sortField, sortDirection);
    if (requestId !== sortRequestId) return;
    folders = sorted.folders;
    documents = sorted.documents;
  }

  function sortCurrentDirectory(deferUntilPaint = false) {
    const requestId = ++sortRequestId;
    queueDirectorySort(requestId, folders, documents, deferUntilPaint);
  }

  function queueDirectorySort(
    requestId: number,
    sourceFolders: ServerDirectoryEntry[],
    sourceDocuments: ServerDocumentEntry[],
    deferUntilPaint: boolean,
  ) {
    const field = sortField;
    const direction = sortDirection;

    const performSort = async () => {
      try {
        const sorted = await sortFileEntriesAsync(sourceFolders, sourceDocuments, field, direction);
        if (requestId !== sortRequestId || field !== sortField || direction !== sortDirection) return;
        folders = sorted.folders;
        documents = sorted.documents;
      } catch (err) {
        console.warn('Background file sort failed; falling back to main-thread sorting.', err);
        if (requestId !== sortRequestId || field !== sortField || direction !== sortDirection) return;
        const sorted = sortFileEntries(sourceFolders, sourceDocuments, field, direction);
        folders = sorted.folders;
        documents = sorted.documents;
      }
    };

    if (deferUntilPaint && typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => {
        setTimeout(() => {
          void performSort();
        }, 0);
      });
      return;
    }

    void performSort();
  }

  async function loadDirectory(folderId: string | null, preserveOnError = false): Promise<boolean> {
    loading = true;
    error = null;
    selectedFolderIds = new Set();
    selectedDocumentIds = new Set();
    try {
      const normalizedFolderId = normalizeDirectoryId(folderId);
      const resp = await listDirectory(normalizedFolderId);
      currentFolderId = normalizedFolderId;
      applyDirectoryEntries(resp.folders, resp.documents);
      parentId = normalizeDirectoryId(resp.parent_id);
      return true;
    } catch (e) {
      error = String(e);
      if (!preserveOnError) {
        folders = [];
        documents = [];
        parentId = null;
      }
      return false;
    } finally {
      loading = false;
    }
  }

  // --- Navigation ---

  async function handleNavigate(folderId: string, folderName: string) {
    const previousFolderId = currentFolderId;
    const ok = await loadDirectory(folderId);
    if (ok) {
      navHistory = [...navHistory, { label: folderName, id: folderId }];
      await rememberVisit(
        currentFilePreferenceScope(),
        {
          type: 'directory',
          id: folderId,
          name: folderName,
          parentId: previousFolderId,
        },
      );
    }
  }

  async function handleBreadcrumbNavigate(targetId: string) {
    // "/" means root
    if (targetId === '/') {
      navigationRootId = null;
      navigationRootLabel = null;
      navHistory = [];
      await loadDirectory(null);
      return;
    }
    if (sameDirectoryId(targetId, navigationRootId)) {
      const ok = await loadDirectory(navigationRootId);
      if (ok) navHistory = [];
      return;
    }
    // Truncate history to the clicked segment
    const idx = navHistory.findIndex((h) => h.id === targetId);
    if (idx >= 0) {
      const ok = await loadDirectory(targetId);
      if (ok) navHistory = navHistory.slice(0, idx + 1);
      return;
    }
    await loadDirectory(targetId);
  }

  async function handleGoToParent() {
    if (parentTargetId === undefined) return;
    const targetParentId = parentTargetId;

    const ok = await loadDirectory(targetParentId);
    if (ok && navHistory.length > 0) {
      navHistory = navHistory.slice(0, -1);
    }
  }

  async function handleJumpToDirectory() {
    const value = await dialogStore.prompt({
      title: $t('files.jumpToDirectory'),
      message: $t('files.jumpToDirectoryPrompt'),
      defaultValue: currentFolderId ?? '/',
      confirmLabel: $t('common.open'),
      cancelLabel: $t('common.cancel'),
      selectOnOpen: true,
    });
    if (value === null) return;

    const target = normalizeDirectoryId(value);
    const ok = await loadDirectory(target, true);
    if (!ok) return;

    navigationRootId = target;
    navigationRootLabel = target === null ? null : shortIdentifier(target);
    navHistory = [];
    status = $t('files.jumpToDirectorySuccess');
  }

  // --- Selection ---

  function toggleSelectFolder(id: string) {
    const next = new Set(selectedFolderIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedFolderIds = next;
  }

  function toggleSelectDocument(id: string) {
    const next = new Set(selectedDocumentIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedDocumentIds = next;
  }

  function clearSelection() {
    selectedFolderIds = new Set();
    selectedDocumentIds = new Set();
    selectMode = false;
  }

  function deselectAll() {
    selectedFolderIds = new Set();
    selectedDocumentIds = new Set();
  }

  function selectAllVisible() {
    selectedFolderIds = new Set(folders.map((folder) => folder.id));
    selectedDocumentIds = new Set(documents.map((doc) => doc.id));
  }

  function toggleAllVisibleSelection() {
    if (allVisibleSelected) {
      deselectAll();
    } else {
      selectAllVisible();
    }
  }

  function toggleSelectMode() {
    selectMode = !selectMode;
    if (!selectMode) clearSelection();
  }

  const totalSelected = $derived(selectedFolderIds.size + selectedDocumentIds.size);
  const selectedItemsLabel = $derived(
    $t('files.batchSelectionName', { values: { count: totalSelected } }),
  );
  const totalVisibleSelectable = $derived(folders.length + documents.length);
  const allVisibleSelected = $derived(
    totalVisibleSelectable > 0
      && folders.every((folder) => selectedFolderIds.has(folder.id))
      && documents.every((doc) => selectedDocumentIds.has(doc.id)),
  );

  // --- Download ---

  async function handleDownload(doc: ServerDocumentEntry) {
    try {
      await getDocument(doc.id, doc.title);
      await rememberVisit(currentFilePreferenceScope(), documentToRecord(doc, currentFolderId));
    } catch (e) {
      error = String(e);
    }
  }

  // --- Document row click: download (normal) or toggle selection ---
  function handleDocumentClick(doc: ServerDocumentEntry) {
    if (selectMode) {
      toggleSelectDocument(doc.id);
    } else {
      handleDownload(doc);
    }
  }

  // --- Folder row click: navigate (normal) or toggle selection ---
  function handleFolderClick(folder: ServerDirectoryEntry) {
    if (selectMode) {
      toggleSelectFolder(folder.id);
    } else {
      handleNavigate(folder.id, folder.name);
    }
  }

  // --- Context menu ---

  function hideContextMenu() {
    contextMenu = { open: false, x: 0, y: 0, kind: null, item: null };
  }

  function showFolderContextMenu(e: MouseEvent, folder: ServerDirectoryEntry) {
    e.preventDefault();
    contextMenu = { open: true, x: e.clientX, y: e.clientY, kind: 'folder', item: folder };
  }

  function showDocumentContextMenu(e: MouseEvent, doc: ServerDocumentEntry) {
    e.preventDefault();
    contextMenu = { open: true, x: e.clientX, y: e.clientY, kind: 'document', item: doc };
  }

  function getContextMenuItems(): ContextMenuItem[] {
    if (!contextMenu.kind || !contextMenu.item) return [];

    if (contextMenu.kind === 'document') {
      const doc = contextMenu.item as ServerDocumentEntry;
      const record = documentToRecord(doc, currentFolderId);
      const favorite = isFavoriteRecord(userPreference, record);
      return [
        {
          id: 'download-document',
          label: $t('common.download'),
          icon: 'download',
          onSelect: () => handleDownload(doc),
        },
        {
          id: 'favorite-document',
          label: favorite ? $t('files.removeFavorite') : $t('files.addFavorite'),
          icon: favorite ? 'star' : 'starOutline',
          onSelect: () => handleToggleFavorite(record, !favorite),
        },
        { type: 'divider' },
        {
          id: 'rename-document',
          label: $t('files.rename'),
          icon: 'edit',
          requiredPermissions: ['rename_document'],
          onSelect: () => handleRenameDocument(doc),
        },
        {
          id: 'move-document',
          label: $t('files.move'),
          icon: 'driveFileMove',
          requiredPermissions: ['move'],
          onSelect: () => handleMoveDocument(doc),
        },
        {
          id: 'delete-document',
          label: $t('common.delete'),
          icon: 'delete',
          requiredPermissions: ['delete_document'],
          onSelect: () => handleDeleteSingle('document', doc),
          danger: true,
        },
        { type: 'divider' },
        {
          id: 'authorize-document',
          label: $t('files.authorize'),
          icon: 'lockPerson',
          requiredPermissions: ['manage_access'],
          onSelect: () => handleAuthorize('document', doc.id, doc.title),
        },
        {
          id: 'view-document-access',
          label: $t('files.viewAccessEntries'),
          icon: 'listAlt',
          requiredPermissions: ['view_access_entries'],
          onSelect: () => handleViewAccessEntries('document', doc.id, doc.title),
        },
        {
          id: 'document-rules',
          label: $t('files.setPermissions'),
          icon: 'settings',
          requiredPermissions: ['set_access_rules'],
          onSelect: () => handleSetAccessRules('document', doc.id, doc.title),
        },
        {
          id: 'edit-document-tags',
          label: $t('files.editTags'),
          icon: 'label',
          requiredPermissions: ['view_metadata', 'set_metadata_tags'],
          onSelect: () => handleEditDocumentTags(doc),
        },
        { type: 'divider' },
        {
          id: 'upload-document-revision',
          label: $t('files.uploadNewVersion'),
          icon: 'uploadFile',
          onSelect: () => handleUploadNewVersion(doc),
        },
        {
          id: 'view-document-revisions',
          label: $t('files.viewRevisions'),
          icon: 'history',
          requiredPermissions: ['list_revisions'],
          onSelect: () => handleViewRevisions(doc),
        },
        { type: 'divider' },
        {
          id: 'document-properties',
          label: $t('files.properties'),
          icon: 'info',
          onSelect: () => handleDocumentProperties(doc),
        },
      ];
    }

    const folder = contextMenu.item as ServerDirectoryEntry;
    const record = directoryToRecord(folder, currentFolderId);
    const favorite = isFavoriteRecord(userPreference, record);
    return [
      {
        id: 'open-folder',
        label: $t('common.open'),
        icon: 'folderOpen',
        onSelect: () => handleNavigate(folder.id, folder.name),
      },
      {
        id: 'download-folder',
        label: $t('common.download'),
        icon: 'download',
        disabled: batchBusy,
        onSelect: () => handleDownloadFolder(folder),
      },
      {
        id: 'favorite-folder',
        label: favorite ? $t('files.removeFavorite') : $t('files.addFavorite'),
        icon: favorite ? 'star' : 'starOutline',
        onSelect: () => handleToggleFavorite(record, !favorite),
      },
      { type: 'divider' },
      {
        id: 'rename-folder',
        label: $t('files.rename'),
        icon: 'edit',
        requiredPermissions: ['rename_directory'],
        onSelect: () => handleRenameFolder(folder),
      },
      {
        id: 'move-folder',
        label: $t('files.move'),
        icon: 'driveFileMove',
        requiredPermissions: ['move'],
        onSelect: () => handleMoveFolder(folder),
      },
      {
        id: 'delete-folder',
        label: $t('common.delete'),
        icon: 'delete',
        requiredPermissions: ['delete_directory'],
        onSelect: () => handleDeleteSingle('folder', folder),
        danger: true,
      },
      { type: 'divider' },
      {
        id: 'authorize-folder',
        label: $t('files.authorize'),
        icon: 'lockPerson',
        requiredPermissions: ['manage_access'],
        onSelect: () => handleAuthorize('directory', folder.id, folder.name),
      },
      {
        id: 'view-folder-access',
        label: $t('files.viewAccessEntries'),
        icon: 'listAlt',
        requiredPermissions: ['view_access_entries'],
        onSelect: () => handleViewAccessEntries('directory', folder.id, folder.name),
      },
      {
        id: 'folder-rules',
        label: $t('files.setPermissions'),
        icon: 'settings',
        requiredPermissions: ['set_access_rules'],
        onSelect: () => handleSetAccessRules('directory', folder.id, folder.name),
      },
      { type: 'divider' },
      {
        id: 'folder-properties',
        label: $t('files.properties'),
        icon: 'info',
        onSelect: () => handleFolderProperties(folder),
      },
    ];
  }

  async function handleDeleteSingle(
    kind: 'folder' | 'document',
    item: ServerDirectoryEntry | ServerDocumentEntry,
  ) {
    try {
      if (kind === 'folder') {
        await deleteDirectory((item as ServerDirectoryEntry).id);
      } else {
        await deleteDocument((item as ServerDocumentEntry).id);
      }
      status = $t('files.deleted');
      await loadDirectory(currentFolderId);
    } catch (e) {
      error = String(e);
    }
  }

  async function handleRenameDocument(doc: ServerDocumentEntry) {
    const next = await dialogStore.prompt({
      title: $t('files.rename'),
      message: $t('files.renamePrompt'),
      defaultValue: doc.title,
      confirmLabel: $t('common.save'),
      cancelLabel: $t('common.cancel'),
    });
    if (next === null || !next.trim() || next.trim() === doc.title) return;
    await runFileAction(async () => {
      await renameDocument(doc.id, next.trim());
      status = $t('files.renamed');
      await loadDirectory(currentFolderId);
    });
  }

  async function handleRenameFolder(folder: ServerDirectoryEntry) {
    const next = await dialogStore.prompt({
      title: $t('files.rename'),
      message: $t('files.renamePrompt'),
      defaultValue: folder.name,
      confirmLabel: $t('common.save'),
      cancelLabel: $t('common.cancel'),
    });
    if (next === null || !next.trim() || next.trim() === folder.name) return;
    await runFileAction(async () => {
      await renameDirectory(folder.id, next.trim());
      status = $t('files.renamed');
      await loadDirectory(currentFolderId);
    });
  }

  async function handleMoveDocument(doc: ServerDocumentEntry) {
    openMoveTargetDialog('document', doc.id, doc.title);
  }

  async function handleMoveFolder(folder: ServerDirectoryEntry) {
    openMoveTargetDialog('directory', folder.id, folder.name, [folder.id]);
  }

  function openMoveTargetDialog(
    objectType: ServerObjectType,
    objectId: string,
    objectName: string,
    excludedDirectoryIds: string[] = [],
  ) {
    moveTargetDialog = {
      objectType,
      objectId,
      objectName,
      originalParentId: normalizeDirectoryId(currentFolderId),
      excludedDirectoryIds,
      saving: false,
    };
  }

  async function handleMoveToTarget(targetFolderId: string | null) {
    if (!moveTargetDialog) return;
    const dialog = moveTargetDialog;
    const target = normalizeDirectoryId(targetFolderId);

    if (dialog.objectType === 'directory' && target === dialog.objectId) {
      error = $t('files.moveSelfError');
      return;
    }

    moveTargetDialog = { ...dialog, saving: true };
    error = null;

    try {
      if (dialog.objectType === 'directory') {
        await moveDirectory(dialog.objectId, target);
      } else {
        await moveDocument(dialog.objectId, target);
      }
      moveTargetDialog = null;
      status = $t('files.moved');
      await loadDirectory(currentFolderId);
    } catch (err) {
      error = formatError(err);
      moveTargetDialog = { ...dialog, saving: false };
    }
  }

  async function handleBatchMoveToTarget(targetFolderId: string | null) {
    if (!batchMoveDialog || totalSelected === 0) return;
    const target = normalizeDirectoryId(targetFolderId);
    const selectedFolders = [...selectedFolderIds];
    const selectedDocuments = [...selectedDocumentIds];

    if (target && selectedFolders.includes(target)) {
      error = $t('files.moveSelfError');
      return;
    }

    batchMoveDialog = { ...batchMoveDialog, saving: true };
    error = null;

    try {
      for (const id of selectedDocuments) {
        await moveDocument(id, target);
      }
      for (const id of selectedFolders) {
        await moveDirectory(id, target);
      }
      batchMoveDialog = null;
      clearSelection();
      status = $t('files.batchMoved', { values: { count: selectedDocuments.length + selectedFolders.length } });
      await loadDirectory(currentFolderId);
    } catch (err) {
      error = formatError(err);
      batchMoveDialog = { excludedDirectoryIds: selectedFolders, saving: false };
    }
  }

  async function handleDocumentProperties(doc: ServerDocumentEntry) {
    await runFileAction(async () => {
      const info = await getDocumentInfo(doc.id);
      detailTitle = $t('files.documentDetails');
      detailRows = [
        { label: $t('files.documentId'), value: info.document_id ?? doc.id },
        { label: $t('files.documentTitle'), value: info.title ?? doc.title },
        { label: $t('files.size'), value: formatBytes(info.size ?? doc.size) },
        { label: $t('files.created'), value: formatDate(info.created_time ?? null) },
        { label: $t('files.modified'), value: formatDate(info.last_modified ?? doc.last_modified) },
        { label: $t('files.parentId'), value: info.parent_id ?? '-' },
        { label: $t('files.creator'), value: info.metadata?.creator ?? '-' },
        { label: $t('files.lastModifiedBy'), value: info.metadata?.last_modified_by ?? '-' },
        { label: $t('files.tags'), value: formatList(info.metadata?.tags) },
        { label: $t('files.accessRules'), value: formatUnknown(info.info_code ? null : info.access_rules) },
      ];
    });
  }

  async function handleEditDocumentTags(doc: ServerDocumentEntry) {
    await runFileAction(async () => {
      const info = await getDocumentInfo(doc.id);
      documentTagsDialog = {
        documentId: doc.id,
        title: info.title ?? doc.title,
        tags: normalizeTags(info.metadata?.tags ?? []),
      };
    });
  }

  async function refreshDocumentTagsEditorData() {
    if (!documentTagsDialog) return { items: [], selected: [] };
    const info = await getDocumentInfo(documentTagsDialog.documentId);
    const tags = normalizeTags(info.metadata?.tags ?? []);
    documentTagsDialog = {
      ...documentTagsDialog,
      title: info.title ?? documentTagsDialog.title,
      tags,
    };
    return {
      items: tags.map((tag) => ({ id: tag, label: tag })),
      selected: tags,
    };
  }

  async function saveDocumentTags(selected: string[]) {
    if (!documentTagsDialog) return;
    const tags = normalizeTags(selected);
    await setDocumentTags(documentTagsDialog.documentId, tags);
    status = $t('files.tagsUpdated', { values: { name: documentTagsDialog.title } });
    documentTagsDialog = null;
  }

  async function handleFolderProperties(folder: ServerDirectoryEntry) {
    await runFileAction(async () => {
      const info = await getDirectoryInfo(folder.id);
      detailTitle = $t('files.directoryDetails');
      detailRows = [
        { label: $t('files.directoryId'), value: info.directory_id ?? folder.id },
        { label: $t('files.directoryName'), value: info.name ?? folder.name },
        { label: $t('files.childCount'), value: String(info.count_of_child ?? '-') },
        { label: $t('files.created'), value: formatDate(info.created_time ?? folder.created_time) },
        { label: $t('files.parentId'), value: info.parent_id ?? '-' },
        { label: $t('files.accessRules'), value: formatUnknown(info.info_code ? null : info.access_rules) },
      ];
    });
  }

  async function handleViewAccessEntries(
    objectType: ServerObjectType,
    objectId: string,
    objectName: string,
  ) {
    await runFileAction(async () => {
      const entries = await viewAccessEntries(objectType, objectId);
      accessEntriesDialog = {
        title: $t('files.accessEntriesFor', { values: { name: objectName } }),
        objectType,
        objectId,
        entries,
      };
    });
  }

  async function handleRevokeAccess(entryId: number) {
    if (!accessEntriesDialog) return;
    await runFileAction(async () => {
      await revokeAccess(entryId);
      accessEntriesDialog = {
        ...accessEntriesDialog!,
        entries: await viewAccessEntries(
          accessEntriesDialog!.objectType,
          accessEntriesDialog!.objectId,
        ),
      };
      status = $t('files.accessRevoked');
    });
  }

  async function handleAuthorize(
    targetType: ServerObjectType,
    targetIdentifier: string,
    targetName: string,
  ) {
    authorizeDialog = {
      title: $t('files.authorizeTitle', { values: { name: targetName } }),
      targetType,
      targetIdentifier,
      targetName,
      saving: false,
    };
  }

  async function handleSubmitAuthorize(value: AccessGrantFormValue) {
    if (!authorizeDialog) return;
    const dialog = authorizeDialog;
    authorizeDialog = { ...dialog, saving: true };
    error = null;

    try {
      await grantAccess(
        value.entityIdentifier,
        value.entityType,
        dialog.targetType,
        dialog.targetIdentifier,
        value.accessTypes,
        value.startTime,
        value.endTime,
      );
      authorizeDialog = null;
      status = $t('files.accessGrantedTo', {
        values: {
          entity: value.entityIdentifier,
          name: dialog.targetName,
        },
      });
    } catch (err) {
      error = formatError(err);
      authorizeDialog = { ...dialog, saving: false };
    }
  }

  async function handleSetAccessRules(
    objectType: ServerObjectType,
    objectId: string,
    objectName: string,
  ) {
    await runFileAction(async () => {
      const current = await getAccessRules(objectType, objectId);
      accessRulesDialog = {
        title: $t('files.ruleManagerTitle', { values: { name: objectName } }),
        objectType,
        objectId,
        rules: current.rules ?? {},
        inheritParent: Boolean(current.inherit),
        saving: false,
      };
    });
  }

  async function handleSaveAccessRules(
    accessRules: AccessRulesRecord,
    inheritParent: boolean,
  ) {
    if (!accessRulesDialog) return;
    const dialog = accessRulesDialog;
    accessRulesDialog = { ...dialog, saving: true };
    error = null;

    try {
      await setAccessRules(
        dialog.objectType,
        dialog.objectId,
        accessRules,
        inheritParent,
      );
      accessRulesDialog = null;
      status = $t('files.accessRulesSaved');
    } catch (err) {
      error = formatError(err);
      accessRulesDialog = { ...dialog, saving: false };
    }
  }

  async function handleUploadNewVersion(doc: ServerDocumentEntry) {
    let selected: string | null;
    try {
      selected = await open({
        multiple: false,
        directory: false,
        pickerMode: 'document',
        fileAccessMode: 'scoped',
        title: $t('files.selectRevisionFile'),
      });
    } catch (err) {
      handlePickerError(err);
      return;
    }
    if (!selected || Array.isArray(selected)) return;

    await runFileAction(async () => {
      uploadProgress = {
        documentId: doc.id,
        taskId: '',
        currentBytes: 0,
        totalBytes: 0,
        progress: 0,
      };
      try {
        notificationStore.info($t('files.uploadRevisionStarted'), 2500);
        await uploadNewRevision(doc.id, selected);
        status = $t('files.uploadRevisionSuccess');
        await loadDirectory(currentFolderId);
        if (revisionsDialog?.documentId === doc.id) {
          revisionsDialog = {
            ...revisionsDialog,
            entries: await listRevisions(doc.id),
          };
        }
      } finally {
        uploadProgress = null;
      }
    });
  }

  async function handleViewRevisions(doc: ServerDocumentEntry) {
    await runFileAction(async () => {
      const entries = await listRevisions(doc.id);
      revisionsDialog = {
        title: $t('files.revisionsFor', { values: { name: doc.title } }),
        documentId: doc.id,
        filename: doc.title,
        entries,
      };
    });
  }

  async function refreshRevisionsDialog() {
    if (!revisionsDialog) return;
    revisionsDialog = {
      ...revisionsDialog,
      entries: await listRevisions(revisionsDialog.documentId),
    };
  }

  async function handleDownloadRevision(revision: RevisionEntry) {
    if (!revisionsDialog) return;
    await runFileAction(async () => {
      await getRevision(
        revision.id,
        revisionsDialog!.filename,
        revision.is_current ?? false,
      );
      status = $t('files.revisionDownloaded');
    });
  }

  async function handleSetCurrentRevision(revision: RevisionEntry) {
    if (!revisionsDialog || revision.is_current) return;
    await runFileAction(async () => {
      await setCurrentRevision(revisionsDialog!.documentId, revision.id);
      await refreshRevisionsDialog();
      await loadDirectory(currentFolderId);
      status = $t('files.setCurrentRevisionSuccess');
    });
  }

  async function runFileAction(action: () => Promise<void>) {
    error = null;
    try {
      await action();
    } catch (err) {
      error = formatError(err);
    }
  }

  async function reloadUserPreference() {
    try {
      userPreference = await loadUserPreference();
    } catch {
      userPreference = null;
    }
  }

  async function handleToggleFavorite(record: FileRecord, favorite: boolean) {
    await runFileAction(async () => {
      userPreference = await setFavoriteRecord(currentFilePreferenceScope(), record, favorite);
      status = favorite ? $t('files.favoriteAdded') : $t('files.favoriteRemoved');
    });
  }

  // --- Toolbar actions ---

  async function handleCreateFolder() {
    const name = await dialogStore.prompt({
      title: $t('files.newFolder'),
      message: $t('files.newFolderPrompt'),
      confirmLabel: $t('files.createFolder'),
      cancelLabel: $t('common.cancel'),
    });
    if (!name || !name.trim()) return;
    try {
      await createDirectory(currentFolderId, name.trim(), true);
      await loadDirectory(currentFolderId);
    } catch (e) {
      error = String(e);
    }
  }

  async function handleDeleteSelected() {
    if (totalSelected === 0 || batchBusy) return;
    const progressId = 'files:batch-delete';
    const progressTitle = $t('files.batchDeleting');
    const total = totalSelected;
    let completed = 0;
    batchBusy = true;
    updateBatchProgress(progressId, progressTitle, completed, total);
    try {
      for (const id of selectedFolderIds) {
        await deleteDirectory(id);
        completed += 1;
        updateBatchProgress(progressId, progressTitle, completed, total);
      }
      for (const id of selectedDocumentIds) {
        await deleteDocument(id);
        completed += 1;
        updateBatchProgress(progressId, progressTitle, completed, total);
      }
      clearSelection();
      await loadDirectory(currentFolderId);
    } catch (e) {
      error = String(e);
    } finally {
      batchBusy = false;
      floatingProgressStore.remove(progressId);
    }
  }

  function updateBatchProgress(id: string, title: string, current: number, total: number) {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    floatingProgressStore.upsert(
      id,
      title,
      $t('files.batchProgress', { values: { current, total, percent } }),
      current,
      total,
    );
  }

  async function handleDownloadSelected() {
    if (totalSelected === 0 || batchBusy) return;
    batchBusy = true;
    error = null;

    const selectedDocuments = documents.filter((doc) => selectedDocumentIds.has(doc.id));
    const selectedFolders = folders.filter((folder) => selectedFolderIds.has(folder.id));
    const batch = createDownloadBatchMetadata(
      selectedFolders.length === 1 && selectedDocuments.length === 0
        ? selectedFolders[0].name
        : selectedItemsLabel,
      currentFolderId,
    );
    const controller = beginDownloadBatch(batch);
    let queued = 0;
    let failed = 0;

    try {
      const items: DownloadQueueItem[] = selectedDocuments.map((document) => ({
        document,
        pathParts: [],
      }));
      addDiscoveredDownloadBatchItems(batch.batchId, items.length);

      for (const folder of selectedFolders) {
        await waitForDownloadBatchResume(controller.signal);
        try {
          const result = await collectDirectoryDownloadItems(folder, [folder.name], controller.signal, batch.batchId);
          items.push(...result.items);
          failed += result.failed;
        } catch (e) {
          if (isDownloadBatchStop(e)) throw e;
          failed += 1;
          markDownloadBatchFailed(batch.batchId);
        }
      }

      setDownloadBatchPhase(batch.batchId, 'queueing');
      const result = await queueCollectedDownloads(items, controller.signal, batch);
      queued += result.queued;
      failed += result.failed;

      if (queued > 0) {
        status = $t('files.batchDownloadQueued', { values: { count: queued } });
      }
      if (failed > 0) {
        error = $t('files.batchDownloadPartialFailed', { values: { count: failed } });
      }
      if (queued > 0 && failed === 0) clearSelection();
    } catch (e) {
      if (isDownloadBatchStop(e)) {
        status = $t('files.batchDownloadStopped');
      } else {
        error = String(e);
      }
    } finally {
      finishDownloadBatch(controller);
      batchBusy = false;
    }
  }

  async function handleDownloadFolder(folder: ServerDirectoryEntry) {
    if (batchBusy) return;
    batchBusy = true;
    error = null;
    const batch = createDownloadBatchMetadata(folder.name, folder.id);
    const controller = beginDownloadBatch(batch);

    try {
      const collected = await collectDirectoryDownloadItems(folder, [folder.name], controller.signal, batch.batchId);
      setDownloadBatchPhase(batch.batchId, 'queueing');
      const queuedResult = await queueCollectedDownloads(collected.items, controller.signal, batch);
      const queued = queuedResult.queued;
      const failed = collected.failed + queuedResult.failed;
      if (queued > 0) {
        status = $t('files.batchDownloadQueued', { values: { count: queued } });
      }
      if (failed > 0) {
        error = $t('files.batchDownloadPartialFailed', { values: { count: failed } });
      }
    } catch (e) {
      if (isDownloadBatchStop(e)) {
        status = $t('files.batchDownloadStopped');
      } else {
        error = String(e);
      }
    } finally {
      finishDownloadBatch(controller);
      batchBusy = false;
    }
  }

  async function queueDocumentDownload(
    doc: Pick<ServerDocumentEntry, 'id' | 'title'>,
    pathParts: string[],
    signal: AbortSignal,
    batch?: DownloadBatchMetadata,
  ) {
    await waitForDownloadBatchResume(signal);
    await getDocument(doc.id, makeDownloadPath([...pathParts, doc.title]), batch);
    await waitForDownloadBatchResume(signal);
  }

  async function collectDirectoryDownloadItems(
    folder: Pick<ServerDirectoryEntry, 'id' | 'name'>,
    pathParts: string[],
    signal: AbortSignal,
    batchId?: string,
  ): Promise<{ items: DownloadQueueItem[]; failed: number }> {
    await waitForDownloadBatchResume(signal);
    const response = await listDirectory(folder.id);
    await waitForDownloadBatchResume(signal);
    const items: DownloadQueueItem[] = [];
    let failed = 0;
    const downloadPath = makeDownloadPath(pathParts);

    try {
      await ensureDownloadSubdirectory(downloadPath);
    } catch {
      failed += 1;
      if (batchId) markDownloadBatchFailed(batchId);
    }

    for (const doc of response.documents) {
      await waitForDownloadBatchResume(signal);
      items.push({ document: doc, pathParts });
    }
    if (batchId) {
      addDiscoveredDownloadBatchItems(batchId, response.documents.length);
    }

    for (const child of response.folders) {
      await waitForDownloadBatchResume(signal);
      try {
        const result = await collectDirectoryDownloadItems(child, [...pathParts, child.name], signal, batchId);
        items.push(...result.items);
        failed += result.failed;
      } catch (e) {
        if (isDownloadBatchStop(e)) throw e;
        failed += 1;
        if (batchId) markDownloadBatchFailed(batchId);
      }
    }

    return { items, failed };
  }

  async function queueCollectedDownloads(
    items: DownloadQueueItem[],
    signal: AbortSignal,
    batch: DownloadBatchMetadata,
  ): Promise<{ queued: number; failed: number }> {
    let queued = 0;
    let failed = 0;
    const queuedBatch = {
      ...batch,
      batchEstimatedTotal: items.length,
    };

    for (const item of items) {
      await waitForDownloadBatchResume(signal);
      try {
        await queueDocumentDownload(item.document, item.pathParts, signal, queuedBatch);
        queued += 1;
        markDownloadBatchQueued(batch.batchId);
      } catch (e) {
        if (isDownloadBatchStop(e)) throw e;
        failed += 1;
        markDownloadBatchFailed(batch.batchId);
      }
    }

    return { queued, failed };
  }

  function createDownloadBatchMetadata(name: string, rootId: string | null): DownloadBatchMetadata {
    return {
      batchId: `download-batch:${Date.now()}:${randomBatchSuffix()}`,
      batchName: name || $t('tasks.folderBatch'),
      batchRootId: rootId,
      batchCreatedAt: Math.floor(Date.now() / 1000),
    };
  }

  function randomBatchSuffix() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }

    return Math.random().toString(36).slice(2);
  }

  function makeDownloadPath(parts: string[]) {
    const safeParts = parts
      .map(sanitizeDownloadPathSegment)
      .filter(Boolean);

    return safeParts.length > 0 ? safeParts.join('/') : 'download';
  }

  function sanitizeDownloadPathSegment(part: string) {
    return part
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function handleMoveSelected() {
    if (totalSelected === 0) return;
    batchMoveDialog = {
      excludedDirectoryIds: [...selectedFolderIds],
      saving: false,
    };
  }

  async function handleUploadFiles() {
    let selected: string | string[] | null;
    try {
      selected = await open({
        multiple: true,
        directory: false,
        pickerMode: 'document',
        fileAccessMode: 'scoped',
        title: $t('files.selectFilesToUpload'),
      });
    } catch (err) {
      handlePickerError(err);
      return;
    }
    if (!selected) return;
    const files = Array.isArray(selected) ? selected : [selected];
    if (files.length === 0) return;

    const targetFolderId = currentFolderId;
    for (const filePath of files) {
      scheduleUpload(
        filePath,
        (uploadId, uploadName) => uploadDocumentFile(
          targetFolderId,
          filePath,
          uploadId,
          'overwrite',
          uploadName,
        ),
      );
    }
  }

  async function handleUploadFolder() {
    let selected: string | null;
    let displayName: string | undefined;
    try {
      selected = await open({
        multiple: false,
        directory: true,
        title: $t('files.selectFolderToUpload'),
      });
    } catch (err) {
      const fallback = await selectAndroidUploadFolderAfterPickerError(err);
      if (!fallback) return;
      selected = fallback.uri;
      displayName = fallback.name;
    }
    if (!selected || Array.isArray(selected)) return;

    const targetFolderId = currentFolderId;
    scheduleUpload(
      selected,
      (uploadId, uploadName) => uploadDirectory(
        targetFolderId,
        selected,
        uploadId,
        'overwrite',
        uploadName,
      ),
      displayName,
    );
  }

  async function handleDroppedUploadPaths(paths: string[]) {
    const uniquePaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
    if (uniquePaths.length === 0) return;

    const targetFolderId = currentFolderId;
    let queued = 0;
    let unsupported = 0;

    for (const path of uniquePaths) {
      const kind = await droppedUploadKind(path);
      if (kind === 'directory') {
        scheduleUpload(
          path,
          (uploadId, uploadName) => uploadDirectory(
            targetFolderId,
            path,
            uploadId,
            'overwrite',
            uploadName,
          ),
        );
        queued += 1;
      } else if (kind === 'file') {
        scheduleUpload(
          path,
          (uploadId, uploadName) => uploadDocumentFile(
            targetFolderId,
            path,
            uploadId,
            'overwrite',
            uploadName,
          ),
        );
        queued += 1;
      } else {
        unsupported += 1;
      }
    }

    if (unsupported > 0) {
      notificationStore.warning($t('files.dropUnsupported'));
    }
  }

  async function droppedUploadKind(path: string): Promise<'file' | 'directory' | null> {
    if (isAndroidTreeUri(path)) return 'directory';
    if (path.startsWith('content://')) return 'file';

    try {
      return await classifyUploadPath(path);
    } catch (err) {
      error = formatError(err);
      return null;
    }
  }

  function handleNativeDragEnter() {
    dragUploadActive = true;
  }

  function handleNativeDragLeave() {
    dragUploadDepth = 0;
    dragUploadActive = false;
  }

  function handleHtmlDragEnter(event: DragEvent) {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    dragUploadDepth += 1;
    dragUploadActive = true;
  }

  function handleHtmlDragOver(event: DragEvent) {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    dragUploadActive = true;
  }

  function handleHtmlDragLeave(event: DragEvent) {
    if (!hasFileDrag(event)) return;
    dragUploadDepth = Math.max(0, dragUploadDepth - 1);
    if (dragUploadDepth === 0) dragUploadActive = false;
  }

  async function handleHtmlDrop(event: DragEvent) {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    dragUploadDepth = 0;
    dragUploadActive = false;

    const paths = droppedFilePaths(event);
    if (paths.length === 0) {
      notificationStore.warning($t('files.dropUnsupported'));
      return;
    }
    await handleDroppedUploadPaths(paths);
  }

  function hasFileDrag(event: DragEvent) {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  }

  function droppedFilePaths(event: DragEvent) {
    return Array.from(event.dataTransfer?.files ?? [])
      .map((file) => (file as File & { path?: string }).path ?? '')
      .filter(Boolean);
  }

  async function selectAndroidUploadFolderAfterPickerError(err: unknown) {
    const message = formatError(err);
    if (isPickerCancel(message)) {
      return null;
    }

    if (!message.includes('Folder picker is not implemented')) {
      error = message;
      return null;
    }

    try {
      return await selectUploadDirectory();
    } catch (fallbackErr) {
      handlePickerError(fallbackErr);
      return null;
    }
  }

  function scheduleUpload(
    sourcePath: string,
    action: (uploadId: string, uploadName: string) => Promise<unknown>,
    displayName?: string,
  ) {
    const uploadId = createUploadId();
    const uploadName = displayName?.trim() || uploadDisplayName(sourcePath);
    uploadStore.addQueued(
      uploadId,
      uploadName,
      sourcePath,
      (id) => action(id, uploadName),
      async () => {
        await loadDirectory(currentFolderId);
      },
    );
  }

  function createUploadId() {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeTags(tags: string[]) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const rawTag of tags) {
      const tag = rawTag.trim();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      result.push(tag);
    }
    return result;
  }

  function formatList(value: string[] | undefined | null) {
    return value?.length ? value.join(', ') : $t('common.none');
  }

  function openSearchDialog() {
    searchDialog = {
      ...searchDialog,
      open: true,
      query: searchQuery,
      results: null,
    };
  }

  async function runServerSearch() {
    const query = searchDialog.query.trim();
    if (!query) {
      error = $t('files.searchQueryRequired');
      return;
    }
    if (!searchDialog.searchDocuments && !searchDialog.searchDirectories) {
      error = $t('files.searchTypeRequired');
      return;
    }

    searchDialog = { ...searchDialog, loading: true };
    try {
      const results = await searchFiles(query, {
        limit: searchDialog.limit,
        searchDocuments: searchDialog.searchDocuments,
        searchDirectories: searchDialog.searchDirectories,
      });
      searchDialog = { ...searchDialog, results, loading: false };
    } catch (e) {
      searchDialog = { ...searchDialog, loading: false };
      error = formatError(e);
    }
  }

  function closeSearchDialog() {
    searchDialog = { ...searchDialog, open: false };
  }

  async function navigateToSearchDirectory(directory: { id: string; name: string }) {
    closeSearchDialog();
    const ok = await loadDirectory(directory.id);
    if (ok) {
      navigationRootId = directory.id;
      navigationRootLabel = directory.name;
      navHistory = [];
      await rememberVisit(currentFilePreferenceScope(), directoryToRecord(directory, null));
    }
  }

  function currentFilePreferenceScope(): FilePreferenceScope {
    return {
      serverAddress: serverStateStore.remoteAddress,
      username: authStore.username,
    };
  }

  async function navigateToSearchDocument(document: { parent_id?: string | null; name?: string; title?: string }) {
    closeSearchDialog();
    const parent = normalizeDirectoryId(document.parent_id);
    const ok = await loadDirectory(parent);
    if (ok) {
      navigationRootId = parent;
      navigationRootLabel = parent === null ? null : shortIdentifier(parent);
      navHistory = [];
      status = $t('files.searchOpenedParent', { values: { name: document.name ?? document.title ?? '' } });
    }
  }

  function handleNavigateTrash() {
    const folder = currentFolderId ?? '/';
    goto(`/home/trash?folder=${encodeURIComponent(folder)}`);
  }

  function setSort(field: SortField) {
    if (sortField === field) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      sortCurrentDirectory(shouldDeferFileSort(folders.length, documents.length));
      return;
    }
    sortField = field;
    sortDirection = field === 'name' ? 'asc' : 'desc';
    sortCurrentDirectory(shouldDeferFileSort(folders.length, documents.length));
  }

  function sortIcon(field: SortField): IconName {
    if (sortField !== field) return 'swapVert';
    return sortDirection === 'asc' ? 'arrowUpward' : 'arrowDownward';
  }

  function sortTitle(field: SortField) {
    const label = field === 'name'
      ? $t('files.sortByName')
      : field === 'size'
        ? $t('files.sortBySize')
        : $t('files.sortByModified');
    const direction = sortField === field
      ? (sortDirection === 'asc' ? $t('files.ascending') : $t('files.descending'))
      : $t('files.notSorted');
    return `${label} · ${direction}`;
  }

  function handlePickerError(err: unknown) {
    const message = formatError(err);
    if (isPickerCancel(message)) return;

    error = message.includes('Folder picker is not implemented')
      ? $t('files.mobileFolderUploadUnsupported')
      : message;
  }

  // --- Init ---

  onMount(() => {
    let unlisten: UnlistenFn | null = null;
    let unlistenDragDrop: UnlistenFn | null = null;
    listen<UploadRevisionProgressEvent>('cfms:upload-revision-progress', (event) => {
      uploadProgress = {
        documentId: event.payload.document_id,
        taskId: event.payload.task_id,
        currentBytes: event.payload.current_bytes,
        totalBytes: event.payload.total_bytes,
        progress: event.payload.progress,
      };
    }).then((fn) => {
      unlisten = fn;
    });
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        handleNativeDragEnter();
      } else if (event.payload.type === 'drop') {
        dragUploadDepth = 0;
        dragUploadActive = false;
        void handleDroppedUploadPaths(event.payload.paths);
      } else {
        handleNativeDragLeave();
      }
    }).then((fn) => {
      unlistenDragDrop = fn;
    }).catch(() => {
      /* HTML5 drag/drop remains as a best-effort fallback. */
    });
    const initialFolder = normalizeDirectoryId(page.url.searchParams.get('folder'));
    const initialName = page.url.searchParams.get('name');
    if (initialFolder) {
      navigationRootId = initialFolder;
      navigationRootLabel = initialName || shortIdentifier(initialFolder);
    }
    loadDirectory(initialFolder);
    reloadUserPreference();
    return () => {
      if (unlisten) unlisten();
      if (unlistenDragDrop) unlistenDragDrop();
    };
  });

</script>

<div
  class="files-page relative p-6 space-y-4"
  role="region"
  aria-label={$t('files.title')}
  ondragenter={handleHtmlDragEnter}
  ondragover={handleHtmlDragOver}
  ondragleave={handleHtmlDragLeave}
  ondrop={handleHtmlDrop}
>
  {#if dragUploadActive}
    <div class="drop-upload-overlay pointer-events-none absolute inset-3 z-30 grid place-items-center border border-dashed border-md3-primary bg-md3-surface/72 text-center backdrop-blur-md">
      <div class="grid gap-2 px-6 py-5">
        <span class="text-md3-primary-emphasis">
          <Icon name="uploadFile" size="36px" />
        </span>
        <p class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('files.dropUpload')}
        </p>
        <p class="text-xs text-md3-on-surface-variant">
          {$t('files.dropUploadHint')}
        </p>
      </div>
    </div>
  {/if}

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    {$t('files.title')}
  </h1>

  <!-- Top toolbar -->
  <div class="flex flex-wrap items-center gap-1.5">
    <IconButton icon="createNewFolder" label={$t('files.createFolder')} onclick={handleCreateFolder} />
    <IconButton icon="uploadFile" label={$t('files.uploadFiles')} onclick={handleUploadFiles} />
    <IconButton
      icon="folderUpload"
      label={$t('files.uploadFolder')}
      onclick={handleUploadFolder}
      badge={uploadActiveCount}
    />
    <IconButton
      icon="checklist"
      label={$t('files.select')}
      active={selectMode}
      onclick={toggleSelectMode}
    />
    <IconButton icon="deleteSweep" label={$t('files.recycleBin')} onclick={handleNavigateTrash} />
    <IconButton icon="folderEye" label={$t('files.jumpToDirectory')} onclick={handleJumpToDirectory} />

    <!-- Spacer -->
    <span class="flex-1"></span>

    <!-- Search -->
    <form
      class="flex gap-2"
      onsubmit={(e) => { e.preventDefault(); openSearchDialog(); }}
    >
      <input
        type="text"
        class="px-3 py-1.5 text-sm rounded-xl border border-md3-outline
               bg-md3-field text-md3-on-surface w-36
               placeholder:text-md3-on-surface-variant
               focus:ring-2 focus:ring-md3-primary focus:border-transparent
               transition-colors"
        placeholder={$t('files.search')}
        bind:value={searchQuery}
      />
      <button
        type="submit"
        class="inline-flex h-9 w-9 items-center justify-center rounded-full
               bg-md3-primary-container text-md3-on-primary-container
               transition-all hover:brightness-110 active:scale-95"
        title={$t('files.serverSearch')}
        aria-label={$t('files.serverSearch')}
      >
        <Icon name="search" size="16px" />
      </button>
    </form>

    <IconButton icon="refresh" label={$t('common.refresh')} onclick={() => loadDirectory(currentFolderId)} />
  </div>

  <!-- Selection toolbar -->
  {#if selectMode}
    <div class="flex items-center gap-2 bg-md3-primary-container/30 rounded-xl
                border border-md3-primary/20 px-3 py-2">
      <span class="text-xs text-md3-on-surface-variant">
        {$t('files.selected', { values: { count: totalSelected } })}
      </span>
      <IconButton
        icon={allVisibleSelected ? 'clearAll' : 'selectAll'}
        label={allVisibleSelected ? $t('files.selectNone') : $t('files.selectAll')}
        active={allVisibleSelected}
        disabled={totalVisibleSelectable === 0}
        onclick={toggleAllVisibleSelection}
        class="!h-8 !w-8"
        size={17}
      />
      <IconButton
        icon="delete"
        label={$t('common.delete')}
        tone="danger"
        disabled={totalSelected === 0 || batchBusy}
        onclick={handleDeleteSelected}
        class="!h-8 !w-8"
        size={17}
      />
      <IconButton
        icon="download"
        label={$t('files.downloadSelected')}
        disabled={totalSelected === 0 || batchBusy}
        onclick={handleDownloadSelected}
        class="!h-8 !w-8"
        size={17}
      />
      <IconButton
        icon="driveFileMove"
        label={$t('files.moveSelected')}
        disabled={totalSelected === 0 || batchBusy}
        onclick={handleMoveSelected}
        class="!h-8 !w-8"
        size={17}
      />
      <IconButton
        icon="close"
        label={$t('common.clear')}
        onclick={clearSelection}
        class="!h-8 !w-8"
        size={17}
      />
    </div>
  {/if}

  <!-- Breadcrumb -->
  <div class="pt-2">
    <Breadcrumb segments={breadcrumbSegments} onNavigate={handleBreadcrumbNavigate} />
  </div>

  <FileTable
    {loading}
    {folders}
    {documents}
    {canGoToParent}
    {selectMode}
    {selectedFolderIds}
    {selectedDocumentIds}
    {sortTitle}
    {sortIcon}
    onSort={setSort}
    onGoToParent={handleGoToParent}
    onFolderClick={handleFolderClick}
    onDocumentClick={handleDocumentClick}
    onFolderContextMenu={showFolderContextMenu}
    onDocumentContextMenu={showDocumentContextMenu}
  />
</div>

<style>
  .drop-upload-overlay {
    animation: drop-upload-in 180ms var(--motion-easing-emphasized-decelerate) both;
  }

  @keyframes drop-upload-in {
    from {
      opacity: 0;
      transform: scale(0.985);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .drop-upload-overlay {
      animation: none;
    }
  }

  :global(.server-search-list-viewport) {
    max-height: calc(52vh - 2.25rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>

<ContextMenu
  open={contextMenu.open}
  x={contextMenu.x}
  y={contextMenu.y}
  items={contextMenuItems}
  userPermissions={authStore.permissions}
  onClose={hideContextMenu}
/>

{#if searchDialog.open}
  <ModalFrame
    title={$t('files.searchTitle')}
    maxWidth="max-w-3xl"
    closeLabel={$t('common.close')}
    onClose={closeSearchDialog}
  >
    <form class="space-y-4 p-5" onsubmit={(e) => { e.preventDefault(); runServerSearch(); }}>
      <div class="grid gap-3 md:grid-cols-[1fr_auto]">
        <input
          class="rounded-lg border border-md3-outline bg-md3-field px-3 py-2 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/25"
          bind:value={searchDialog.query}
          placeholder={$t('files.searchPlaceholder')}
        />
        <button
          type="submit"
          class="rounded-full bg-md3-primary px-4 py-2 text-sm font-medium text-md3-on-primary transition-all hover:brightness-110 disabled:opacity-50"
          disabled={searchDialog.loading}
        >
          {$t('files.serverSearch')}
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-4 text-sm text-md3-on-surface-variant">
        <div class="flex items-center gap-2">
          <MdCheckbox
            bind:checked={searchDialog.searchDocuments}
            ariaLabel={$t('files.searchDocuments')}
          />
          {$t('files.searchDocuments')}
        </div>
        <div class="flex items-center gap-2">
          <MdCheckbox
            bind:checked={searchDialog.searchDirectories}
            ariaLabel={$t('files.searchDirectories')}
          />
          {$t('files.searchDirectories')}
        </div>
        <label class="ml-auto flex items-center gap-2">
          {$t('files.searchLimit')}
          <input
            type="number"
            min="1"
            max="1000"
            class="w-24 rounded-lg border border-md3-outline bg-md3-field px-2 py-1 text-sm text-md3-on-surface"
            bind:value={searchDialog.limit}
          />
        </label>
      </div>

      {#if searchDialog.loading}
        <div class="flex items-center gap-2 py-6 text-sm text-md3-on-surface-variant">
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {$t('common.loadingEllipsis')}
        </div>
      {:else if searchDialog.results}
        <div class="max-h-[52vh] overflow-auto rounded-lg border border-md3-outline">
          <div class="border-b border-md3-outline bg-md3-surface-container-high/50 px-3 py-2 text-xs font-medium uppercase text-md3-on-surface-variant">
            {searchDialog.results.total_count === 0
              ? $t('files.searchNoResults', { values: { query: searchDialog.query } })
              : $t('files.searchResultCount', { values: { count: searchDialog.results.total_count, query: searchDialog.query } })}
          </div>
          <VirtualList
            items={searchResultRows}
            keyOf={(row) => row.kind === 'directory'
              ? `directory:${row.directory.id}`
              : `document:${row.document.id}`}
            estimateSize={37}
            overscan={10}
            threshold={120}
            resetKey={`${searchDialog.query}:${searchDialog.results.total_count}`}
            viewportClass="server-search-list-viewport"
          >
            {#snippet children(row, index)}
              {#if row.kind === 'directory'}
                <button
                  type="button"
                  class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-md3-outline/50 px-3 py-2 text-left transition-colors hover:bg-md3-primary-container/20"
                  class:border-b-0={index === searchResultRows.length - 1}
                  onclick={() => navigateToSearchDirectory(row.directory)}
                >
                  <span class="text-md3-primary-emphasis"><Icon name="folder" size="20px" /></span>
                  <span class="min-w-0 truncate text-sm font-medium text-md3-primary-emphasis">{row.directory.name}</span>
                  <span class="text-xs text-md3-on-surface-variant">{formatDate(row.directory.created_time)}</span>
                </button>
              {:else}
                <button
                  type="button"
                  class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-md3-outline/50 px-3 py-2 text-left transition-colors hover:bg-md3-surface-container-high/40"
                  class:border-b-0={index === searchResultRows.length - 1}
                  onclick={() => navigateToSearchDocument(row.document)}
                >
                  <span class="text-md3-on-surface-variant"><Icon name="filePresent" size="20px" /></span>
                  <span class="min-w-0 truncate text-sm text-md3-on-surface">{row.document.name ?? row.document.title}</span>
                  <span class="text-xs text-md3-on-surface-variant">{formatBytes(row.document.size)}</span>
                </button>
              {/if}
            {/snippet}
          </VirtualList>
        </div>
      {/if}
    </form>
  </ModalFrame>
{/if}

{#if detailTitle}
  <ModalFrame title={detailTitle} maxWidth="max-w-lg" closeLabel={$t('common.close')} onClose={() => (detailTitle = null)}>
      <div class="p-5 space-y-3 max-h-[70vh] overflow-auto">
        {#each detailRows as row}
          <div class="grid min-w-0 grid-cols-[140px_minmax(0,1fr)] gap-3 text-sm">
            <span class="text-md3-on-surface-variant">{row.label}</span>
            <span class="min-w-0 whitespace-pre-wrap text-md3-on-surface" style="overflow-wrap: anywhere;">{row.value || '—'}</span>
          </div>
        {/each}
      </div>
  </ModalFrame>
{/if}

{#if authorizeDialog}
  <ModalFrame title={authorizeDialog.title} maxWidth="max-w-2xl" closeLabel={$t('common.close')} onClose={() => (authorizeDialog = null)}>
    <AuthorizeAccessDialog
      targetName={authorizeDialog.targetName}
      targetType={authorizeDialog.targetType}
      canListUsers={authStore.permissions.includes('list_users')}
      canListGroups={authStore.permissions.includes('list_groups')}
      saving={authorizeDialog.saving}
      onSubmit={handleSubmitAuthorize}
      onCancel={() => (authorizeDialog = null)}
    />
  </ModalFrame>
{/if}

{#if moveTargetDialog}
  <MoveTargetDialog
    objectType={moveTargetDialog.objectType}
    objectName={moveTargetDialog.objectName}
    initialFolderId={currentFolderId}
    {navigationRootId}
    originalParentId={moveTargetDialog.originalParentId}
    initialBreadcrumb={moveInitialBreadcrumb}
    excludedDirectoryIds={moveTargetDialog.excludedDirectoryIds}
    moving={moveTargetDialog.saving}
    onMove={handleMoveToTarget}
    onCancel={() => (moveTargetDialog = null)}
  />
{/if}

{#if batchMoveDialog}
  <MoveTargetDialog
    objectType="directory"
    objectName={selectedItemsLabel}
    initialFolderId={currentFolderId}
    {navigationRootId}
    originalParentId={currentFolderId}
    initialBreadcrumb={moveInitialBreadcrumb}
    excludedDirectoryIds={batchMoveDialog.excludedDirectoryIds}
    moving={batchMoveDialog.saving}
    onMove={handleBatchMoveToTarget}
    onCancel={() => (batchMoveDialog = null)}
  />
{/if}

{#if accessEntriesDialog}
  <ModalFrame title={accessEntriesDialog.title} maxWidth="max-w-5xl" closeLabel={$t('common.close')} onClose={() => (accessEntriesDialog = null)}>
      <div class="p-5 overflow-auto max-h-[70vh]">
        {#if accessEntriesDialog.entries.length === 0}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            {$t('files.noAccessEntries')}
          </p>
        {:else}
          <table class="min-w-[860px] w-full text-left text-sm">
            <thead class="text-xs uppercase text-md3-on-surface-variant">
              <tr>
                <th class="px-3 py-2">{$t('files.id')}</th>
                <th class="px-3 py-2">{$t('files.entityType')}</th>
                <th class="px-3 py-2">{$t('files.entityName')}</th>
                <th class="px-3 py-2">{$t('files.accessType')}</th>
                <th class="px-3 py-2">{$t('files.startTime')}</th>
                <th class="px-3 py-2">{$t('files.endTime')}</th>
                <th class="px-3 py-2 text-right">{$t('files.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {#each accessEntriesDialog.entries as entry (entry.id)}
                {@const subject = accessEntrySubject(entry)}
                <tr class="border-t border-md3-outline/50">
                  <td class="px-3 py-2 text-xs text-md3-on-surface-variant">{entry.id}</td>
                  <td class="px-3 py-2">{subject.type || '—'}</td>
                  <td class="px-3 py-2">{subject.name || '—'}</td>
                  <td class="px-3 py-2">{entry.access_type}</td>
                  <td class="px-3 py-2 whitespace-nowrap">{formatDate(entry.start_time)}</td>
                  <td class="px-3 py-2 whitespace-nowrap">{formatDate(entry.end_time)}</td>
                  <td class="px-3 py-2 text-right">
                    <button
                      class="rounded-full bg-md3-error-container p-2 text-md3-on-error-container transition-all hover:brightness-110"
                      title={$t('files.revoke')}
                      aria-label={$t('files.revoke')}
                      onclick={() => handleRevokeAccess(entry.id)}
                    >
                      <Icon name="delete" size="17px" />
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
  </ModalFrame>
{/if}

{#if accessRulesDialog}
  <ModalFrame title={accessRulesDialog.title} maxWidth="max-w-6xl" closeLabel={$t('common.close')} onClose={() => (accessRulesDialog = null)}>
    <AccessRulesManager
      rules={accessRulesDialog.rules}
      inheritParent={accessRulesDialog.inheritParent}
      saving={accessRulesDialog.saving}
      onSave={handleSaveAccessRules}
      onCancel={() => (accessRulesDialog = null)}
    />
  </ModalFrame>
{/if}

{#if documentTagsDialog}
  <ManageListEditorDialog
    title={$t('files.editTagsFor', { values: { name: documentTagsDialog.title } })}
    description={$t('files.editTagsDescription')}
    icon="label"
    items={documentTagsDialog.tags.map((tag) => ({ id: tag, label: tag }))}
    selected={documentTagsDialog.tags}
    allowAdd={true}
    addPlaceholder={$t('files.addTagPlaceholder')}
    emptyMessage={$t('files.noTags')}
    onRefresh={refreshDocumentTagsEditorData}
    onSave={saveDocumentTags}
    onClose={() => (documentTagsDialog = null)}
  />
{/if}

{#if revisionsDialog}
  <ModalFrame title={revisionsDialog.title} maxWidth="max-w-2xl" closeLabel={$t('common.close')} onClose={() => (revisionsDialog = null)}>
      <div class="p-5 max-h-[72vh] overflow-auto">
        {#if uploadProgress && uploadProgress.documentId === revisionsDialog.documentId}
          <div class="mb-4 rounded-lg border border-md3-primary/25 bg-md3-primary-container/30 p-3">
            <div class="mb-2 flex items-center justify-between gap-3 text-xs text-md3-on-primary-container">
              <span class="font-medium">{$t('files.uploadRevisionStarted')}</span>
              <span>{Math.round(uploadProgress.progress * 100)}%</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-md3-surface-container-high">
              <span
                class="block h-full rounded-full bg-md3-primary transition-[width] duration-150"
                style={`width: ${Math.max(0, Math.min(1, uploadProgress.progress)) * 100}%`}
              ></span>
            </div>
          </div>
        {/if}
        {#if revisionsDialog.entries.length === 0}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            {$t('files.noRevisions')}
          </p>
        {:else}
          <div class="mb-3 flex items-center gap-2 text-xs font-medium uppercase text-md3-on-surface-variant">
            <Icon name="history" size="16px" />
            {$t('files.revisionGraph')}
          </div>
          <div class="space-y-0">
            {#each revisionRows as row (row.revision.id)}
              <div class="relative grid grid-cols-[auto_1fr_auto] items-stretch gap-3 border-b border-md3-outline/45 last:border-b-0">
                <svg
                  class="h-full min-h-16 shrink-0 self-stretch overflow-visible"
                  style={`width: ${graphWidth(row)}px`}
                  viewBox={`0 0 ${graphWidth(row)} 64`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {#each row.before as laneId, index}
                    {#if laneId !== null && (index !== row.lane || row.hasChildren)}
                      <line
                        x1={laneX(index)}
                        y1="0"
                        x2={laneX(index)}
                        y2="30"
                        stroke={graphLineColor(laneId)}
                        stroke-width="2.4"
                        stroke-linecap="round"
                        vector-effect="non-scaling-stroke"
                      />
                    {/if}
                  {/each}
                  {#if row.parentLane !== null}
                    <path
                      d={row.parentLane === row.lane
                        ? `M ${laneX(row.lane)} 32 L ${laneX(row.lane)} 64`
                        : `M ${laneX(row.lane)} 32 C ${laneX(row.lane)} 48, ${laneX(row.parentLane)} 48, ${laneX(row.parentLane)} 64`}
                      fill="none"
                      stroke={graphLineColor(row.revision.parent_id)}
                      stroke-width="2.4"
                      stroke-linecap="round"
                      vector-effect="non-scaling-stroke"
                    />
                  {/if}
                  {#each row.after as laneId, index}
                    {#if laneId !== null && index !== row.parentLane}
                      <line
                        x1={laneX(index)}
                        y1="32"
                        x2={laneX(index)}
                        y2="64"
                        stroke={graphLineColor(laneId)}
                        stroke-width="2.4"
                        stroke-linecap="round"
                        vector-effect="non-scaling-stroke"
                      />
                    {/if}
                  {/each}
                </svg>
                <span
                  class="pointer-events-none absolute h-3 w-3 rounded-full border-[3px] border-md3-surface-container"
                  style={`left: ${laneX(row.lane)}px; top: 50%; background: ${graphLineColor(row.revision.id)}; transform: translate(-50%, -50%);`}
                  aria-hidden="true"
                ></span>
                {#if row.hasBranch}
                  <span
                    class="pointer-events-none absolute h-1.5 w-1.5 rounded-full bg-md3-primary-emphasis"
                    style={`left: ${laneX(row.lane) + 8}px; top: calc(50% - 8px); transform: translate(-50%, -50%);`}
                    aria-hidden="true"
                  ></span>
                {/if}
                {#if row.hasMerge}
                  <span
                    class="pointer-events-none absolute h-1.5 w-1.5 rounded-full bg-[#34d399]"
                    style={`left: ${laneX(row.lane) + 8}px; top: calc(50% + 8px); transform: translate(-50%, -50%);`}
                    aria-hidden="true"
                  ></span>
                {/if}

                <div class="min-w-0 py-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-sm font-semibold text-md3-on-surface" title={row.revision.id}>
                      {$t('files.revision')} #{shortIdentifier(row.revision.id)}
                    </p>
                    {#if row.revision.is_current}
                      <span class="rounded-full bg-md3-primary-container px-2 py-0.5 text-[11px] font-medium text-md3-on-primary-container">
                        {$t('files.currentRevision')}
                      </span>
                    {/if}
                  </div>
                  <p class="mt-1 text-xs text-md3-on-surface-variant">
                    {#if row.revision.parent_id === null || row.revision.parent_id === undefined}
                      {$t('files.rootRevision')}
                    {:else}
                      <span title={String(row.revision.parent_id)}>
                        {$t('files.parentRevision')}: #{shortIdentifier(row.revision.parent_id)}
                      </span>
                    {/if}
                    · {$t('files.created')}: {formatDate(row.revision.created_time ?? null)}
                  </p>
                </div>

                <div class="flex items-center gap-1 py-3">
                  <button
                    class="rounded-full p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface"
                    title={$t('common.download')}
                    onclick={() => handleDownloadRevision(row.revision)}
                  >
                    <Icon name="download" size="18px" />
                  </button>
                  {#if !row.revision.is_current}
                    <button
                      class="rounded-full p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-primary-container hover:text-md3-on-primary-container"
                      title={$t('files.setCurrentRevision')}
                      onclick={() => handleSetCurrentRevision(row.revision)}
                    >
                      <Icon name="verified" size="18px" />
                    </button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
  </ModalFrame>
{/if}
