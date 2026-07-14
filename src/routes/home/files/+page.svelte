<script lang="ts">
  // File Manager page
  //
  // Browses files and folders on the CFMS server via the `list_directory`
  // and `get_document` actions sent over the active WSS connection.
  //
  // Reference: get_directory / get_document in reference/src/include/ui/util/path.py

  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { open } from '@tauri-apps/plugin-dialog';
  import { _ as t } from 'svelte-i18n';
  import {
    listDirectory,
    listDirectoryPage,
    loadUserPreference,
    classifyUploadPath,
    getDocument,
    getRevision,
    inspectUploadDirectoryConflicts,
    createDirectory,
    deleteDirectory,
    deleteDocument,
    deleteRevision,
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
    uploadDirectory,
    uploadDocumentFile,
    uploadNewRevision,
    viewAccessEntries,
    type AccessEntry,
    type DirectoryFileConflictResolution,
    type DownloadBatchMetadata,
    type RevisionEntry,
    type SearchDirectoryEntry,
    type SearchDocumentEntry,
    type SearchFilesResponse,
    type UploadConflictStrategy,
    type UploadRevisionProgressEvent,
    type UserPreference,
  } from '$lib/api';
  import type {
    ServerDirectoryEntry,
    ServerDocumentEntry,
    ServerObjectType,
  } from '$lib/api';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import AccessDeniedDialog from '$lib/components/AccessDeniedDialog.svelte';
  import AccessDeniedNotice from '$lib/components/AccessDeniedNotice.svelte';
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
  import FileTable, {
    type FileTableRow,
    type FileTableViewportAnchor,
  } from '$lib/components/files/FileTable.svelte';
  import ExplorerCommandBar from '$lib/components/explorer/ExplorerCommandBar.svelte';
  import ExplorerDetailsPane from '$lib/components/explorer/ExplorerDetailsPane.svelte';
  import ExplorerStatusBar from '$lib/components/explorer/ExplorerStatusBar.svelte';
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
  import { pickDirectory, type SelectedDirectory } from '$lib/directory-picker';
  import {
    normalizeDirectoryId,
    ROOT_DIRECTORY_ID,
    sameDirectoryId,
    type DirectoryBreadcrumbSegment,
  } from '$lib/file-browser';
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
  import type { SortDirection, SortField } from '$lib/files/sorting';
  import {
    createProgressiveDirectorySorter,
    type ProgressiveDirectorySorter,
    type ProgressiveSortSnapshot,
  } from '$lib/files/sort-worker-client';
  import { DIRECTORY_PAGE_SIZE } from '$lib/files/progressive-listing';
  import { DirectoryLoadController } from '$lib/files/directory-load-controller';
  import { isAccessDeniedError } from '$lib/api/server-errors';
  import {
    fileManagerShortcutFor,
    isFindShortcut,
    registerKeyboardCommands,
    keyboardMenuAnchor,
    focusRovingItem,
    type FileManagerShortcut,
  } from '$lib/keyboard';
  import { isAndroidTreeUri, uploadDisplayName } from '$lib/files/upload-names';
  import {
    createUploadConflictResolver,
    partitionUploadConflicts,
    type UploadCandidate,
    type UploadConflictAction,
    type UploadConflictDecision,
  } from '$lib/files/upload-conflicts';
  import { shortIdentifier } from '$lib/identifiers';
  import type { IconName } from '$lib/icons';
  import type { CommandAction, FileDetailModel } from '$lib/explorer/types';
  import {
    fileSelectionKey,
    isAllVisibleSelected,
    parseFileSelectionKey,
    selectedDocumentSize as sumDocumentSelectionSize,
    selectFileRangeByIndex,
  } from '$lib/explorer/file-selection';
  import { isMobilePlatform } from '$lib/platform';
  import { authStore, floatingProgressStore, notificationStore, serverStateStore, uploadStore } from '$lib/stores.svelte';

  type SearchResultRow =
    | { kind: 'directory'; directory: SearchDirectoryEntry }
    | { kind: 'document'; document: SearchDocumentEntry };

  type PendingUploadConflict = UploadCandidate & {
    directoryPath?: string;
    relativePath?: string;
  };

  const SERVER_SEARCH_PAGE_SIZE = 128;
  const SEARCH_PREVIEW_PAGE_SIZE = 24;
  const SEARCH_PREVIEW_DEBOUNCE_MS = 120;
  const SEARCH_PREVIEW_SCROLL_THRESHOLD = 72;
  const SORT_FIELDS: SortField[] = ['name', 'modified', 'size'];

  type DirectoryLoadPhase = 'idle' | 'initial-loading' | 'loading-more' | 'complete' | 'partial-error';

  type DirectoryNavigationSnapshot = {
    folderId: string | null;
    navigationRootId: string | null;
    navigationRootLabel: string | null;
    navHistory: Array<{ label: string; id: string }>;
  };

  type DirectoryAccessDeniedState = {
    folderId: string | null;
    returnNavigation: DirectoryNavigationSnapshot;
  };

  type FileListIndex = {
    folderById: Map<string, ServerDirectoryEntry>;
    documentById: Map<string, ServerDocumentEntry>;
    folderIds: string[];
    documentIds: string[];
    keyToIndex: Map<string, number>;
    documentSizeById: Map<string, number>;
    totalDocumentSize: number;
  };

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
  let directoryLoadPhase = $state<DirectoryLoadPhase>('idle');
  let directoryLoadError = $state<string | null>(null);
  let directoryLoadedCount = $state(0);
  let directoryNextCursor = $state<string | null>(null);
  let directoryAccessDenied = $state<DirectoryAccessDeniedState | null>(null);
  let fileTableResetKey = $state(0);
  let error = $state<string | null>(null);
  let status = $state<string | null>(null);
  let searchQuery = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);
  let searchDialogInput = $state<HTMLInputElement | null>(null);
  let searchPreviewRoot = $state<HTMLDivElement | null>(null);
  let searchPreviewPanelStyle = $state('');
  let navigationRootId = $state<string | null>(null);
  let navigationRootLabel = $state<string | null>(null);
  let userPreference = $state<UserPreference | null>(null);
  let batchBusy = $state(false);

  // Selection mode
  let selectMode = $state(false);
  let selectedFolderIds = $state<Set<string>>(new Set());
  let selectedDocumentIds = $state<Set<string>>(new Set());
  let selectedDocumentSize = $state(0);
  let selectionRevision = $state(0);
  let sortField = $state<SortField>('name');
  let sortDirection = $state<SortDirection>('asc');
  let sortRevision = 0;
  let directoryGeneration = 0;
  let activeDirectoryReturnNavigation: DirectoryNavigationSnapshot | null = null;
  const directoryLoader = new DirectoryLoadController(listDirectoryPage);
  let directorySorter: ProgressiveDirectorySorter | null = null;
  let fileTable: {
    captureViewportAnchor: () => FileTableViewportAnchor | null;
    restoreViewportAnchor: (index: number, offset: number) => Promise<void>;
  } | null = null;
  let fileListIndex = $state<FileListIndex>(createFileListIndex([], []));
  let resolveFirstDirectorySnapshot: ((value: boolean) => void) | null = null;
  let firstDirectorySnapshotGeneration = 0;
  let focusedItemKey = $state<string | null>(null);
  let selectionAnchorKey = $state<string | null>(null);
  let coarsePointer = $state(false);
  let marqueeSelectionEnabled = $state(false);
  let detailsOpen = $state(false);
  let detailModel = $state<FileDetailModel | null>(null);
  let detailRequestId = 0;
  let documentAccessDenied = $state<{ name: string; id: string; accessedAt: number } | null>(null);

  // Context menu state
  let contextMenu = $state<{
    open: boolean;
    x: number;
    y: number;
    kind: 'folder' | 'document' | 'selection' | 'current-directory' | null;
    item: ServerDirectoryEntry | ServerDocumentEntry | null;
    sourceElement: HTMLElement | null;
  }>({ open: false, x: 0, y: 0, kind: null, item: null, sourceElement: null });
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
  let searchRunId = 0;
  let searchPreviewRunId = 0;
  let searchPreviewActiveIndex = $state(-1);
  let searchPreviewDebounce: ReturnType<typeof setTimeout> | null = null;
  let searchPreviewPositionFrame: number | null = null;
  let uploadProgress = $state<{
    documentId: string;
    taskId: string;
    currentBytes: number;
    totalBytes: number;
    progress: number;
  } | null>(null);
  let dragUploadActive = $state(false);
  let dragUploadDepth = $state(0);
  let nativeDragDropAvailable = false;
  let lastDropBatchSignature = '';
  let lastDropBatchAt = 0;
  let searchDialog = $state<{
    open: boolean;
    query: string;
    resultQuery: string;
    searchDocuments: boolean;
    searchDirectories: boolean;
    sortBy: SortField;
    sortOrder: SortDirection;
    loading: boolean;
    results: SearchFilesResponse | null;
  }>({
    open: false,
    query: '',
    resultQuery: '',
    searchDocuments: true,
    searchDirectories: true,
    sortBy: 'name',
    sortOrder: 'asc',
    loading: false,
    results: null,
  });
  let searchPreview = $state<{
    open: boolean;
    query: string;
    searchDocuments: boolean;
    searchDirectories: boolean;
    sortBy: SortField;
    sortOrder: SortDirection;
    loading: boolean;
    loadingMore: boolean;
    results: SearchFilesResponse | null;
    error: string | null;
  }>({
    open: false,
    query: '',
    searchDocuments: true,
    searchDirectories: true,
    sortBy: 'name',
    sortOrder: 'asc',
    loading: false,
    loadingMore: false,
    results: null,
    error: null,
  });

  // Breadcrumb navigation history — each entry records the folder name and its
  // server-side ID so we can jump back to any ancestor.
  let navHistory = $state<Array<{ label: string; id: string }>>([]);

  function captureDirectoryNavigation(): DirectoryNavigationSnapshot {
    return {
      folderId: currentFolderId,
      navigationRootId,
      navigationRootLabel,
      navHistory: navHistory.map((entry) => ({ ...entry })),
    };
  }

  function captureDeniedReturnNavigation(folderId: string | null): DirectoryNavigationSnapshot {
    const snapshot = captureDirectoryNavigation();
    if (!sameDirectoryId(folderId, currentFolderId)) return snapshot;

    if (parentTargetId !== undefined) {
      return {
        ...snapshot,
        folderId: parentTargetId,
        navHistory: navHistory.slice(0, -1),
      };
    }

    if (navigationRootId !== null && sameDirectoryId(currentFolderId, navigationRootId)) {
      return {
        folderId: null,
        navigationRootId: null,
        navigationRootLabel: null,
        navHistory: [],
      };
    }

    return snapshot;
  }

  function isDeniedDirectory(folderId: string | null): boolean {
    return directoryAccessDenied !== null
      && sameDirectoryId(directoryAccessDenied.folderId, normalizeDirectoryId(folderId));
  }

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
      .filter((segment) => segment.path !== ROOT_DIRECTORY_ID)
      .map((segment) => ({ label: segment.label, id: segment.path })),
  );
  const contextMenuItems = $derived.by<ContextMenuItem[]>(() => getContextMenuItems());
  const revisionRows = $derived(
    revisionsDialog ? buildRevisionRows(revisionsDialog.entries) : [],
  );
  const searchResultRows = $derived.by<SearchResultRow[]>(() => {
    if (!searchDialog.results) return [];

    return buildSearchResultRows(searchDialog.results);
  });
  const searchPreviewRows = $derived.by<SearchResultRow[]>(() => {
    if (!searchPreview.results) return [];

    return buildSearchResultRows(searchPreview.results);
  });
  const searchPreviewHasQuery = $derived(searchQuery.trim().length > 0);
  const searchPreviewCanSearch = $derived(
    searchPreviewHasQuery && (searchPreview.searchDocuments || searchPreview.searchDirectories),
  );
  const searchPreviewResetKey = $derived(
    `${searchPreview.query}:${searchPreview.sortBy}:${searchPreview.sortOrder}:${searchPreview.searchDocuments}:${searchPreview.searchDirectories}`,
  );
  const searchDialogResetKey = $derived(
    `${searchDialog.resultQuery}:${searchDialog.sortBy}:${searchDialog.sortOrder}:${searchDialog.searchDocuments}:${searchDialog.searchDirectories}`,
  );
  function buildSearchResultRows(results: SearchFilesResponse): SearchResultRow[] {
    return [
      ...results.directories.map((directory) => ({
        kind: 'directory' as const,
        directory,
      })),
      ...results.documents.map((document) => ({
        kind: 'document' as const,
        document,
      })),
    ];
  }
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
  const canGoToParent = $derived(directoryAccessDenied !== null || parentTargetId !== undefined);
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

  function createFileListIndex(
    nextFolders: ServerDirectoryEntry[],
    nextDocuments: ServerDocumentEntry[],
  ): FileListIndex {
    const folderById = new Map<string, ServerDirectoryEntry>();
    const documentById = new Map<string, ServerDocumentEntry>();
    const folderIds = new Array<string>(nextFolders.length);
    const documentIds = new Array<string>(nextDocuments.length);
    const keyToIndex = new Map<string, number>();
    const documentSizeById = new Map<string, number>();
    let totalDocumentSize = 0;
    nextFolders.forEach((folder, index) => {
      folderById.set(folder.id, folder);
      folderIds[index] = folder.id;
      keyToIndex.set(fileSelectionKey('folder', folder.id), index);
    });
    nextDocuments.forEach((document, index) => {
      const size = document.size ?? 0;
      documentById.set(document.id, document);
      documentIds[index] = document.id;
      documentSizeById.set(document.id, size);
      keyToIndex.set(fileSelectionKey('document', document.id), nextFolders.length + index);
      totalDocumentSize += size;
    });
    return {
      folderById,
      documentById,
      folderIds,
      documentIds,
      keyToIndex,
      documentSizeById,
      totalDocumentSize,
    };
  }

  function markFilePerformance(name: string) {
    if (typeof performance === 'undefined') return;
    performance.mark(name);
  }

  function handleDirectorySnapshot(snapshot: ProgressiveSortSnapshot) {
    if (snapshot.generation !== directoryGeneration || snapshot.revision !== sortRevision) return;
    const viewportAnchor = directoryLoadedCount > 0 ? fileTable?.captureViewportAnchor() ?? null : null;
    folders = snapshot.folders;
    documents = snapshot.documents;
    fileListIndex = createFileListIndex(snapshot.folders, snapshot.documents);
    directoryLoadedCount = snapshot.loadedCount;
    loading = false;
    markFilePerformance('files:sort-snapshot-applied');
    if (snapshot.complete) {
      directoryLoadPhase = 'complete';
      directoryNextCursor = null;
      markFilePerformance('files:list-complete');
    } else if (directoryLoadPhase !== 'partial-error') {
      directoryLoadPhase = 'loading-more';
    }
    if (snapshot.loadedCount <= DIRECTORY_PAGE_SIZE) {
      void tick().then(() => markFilePerformance('files:first-batch-visible'));
    }

    if (firstDirectorySnapshotGeneration === snapshot.generation) {
      resolveFirstDirectorySnapshot?.(true);
      resolveFirstDirectorySnapshot = null;
    }
    if (viewportAnchor) {
      const anchorIndex = fileListIndex.keyToIndex.get(viewportAnchor.key);
      if (anchorIndex !== undefined) {
        void tick().then(() => fileTable?.restoreViewportAnchor(anchorIndex, viewportAnchor.offset));
      }
    }
  }

  function handleDirectorySorterError(sortError: unknown) {
    directoryLoadError = formatError(sortError);
    directoryLoadPhase = directoryLoadedCount > 0 ? 'partial-error' : 'idle';
    loading = false;
    resolveFirstDirectorySnapshot?.(false);
    resolveFirstDirectorySnapshot = null;
  }

  async function continueDirectoryLoad(generation: number, cursor: string | null) {
    if (!cursor || generation !== directoryGeneration) return;
    directoryLoadPhase = 'loading-more';
    directoryNextCursor = cursor;
    const result = await directoryLoader.continue(
      generation,
      currentFolderId,
      cursor,
      DIRECTORY_PAGE_SIZE,
      (pageResponse) => {
        const complete = !pageResponse.has_more;
        directorySorter?.append(
          generation,
          sortRevision,
          pageResponse.folders,
          pageResponse.documents,
          complete,
        );
        directoryNextCursor = pageResponse.next_cursor;
      },
    );
    if (result.status !== 'partial-error' || generation !== directoryGeneration) return;
    if (isAccessDeniedError(result.error)) {
      showDirectoryAccessDenied(
        currentFolderId,
        activeDirectoryReturnNavigation ?? captureDirectoryNavigation(),
      );
      return;
    }
    directoryNextCursor = result.cursor;
    directoryLoadError = formatError(result.error);
    directoryLoadPhase = 'partial-error';
    directorySorter?.resort(generation, sortRevision, sortField, sortDirection);
  }

  function retryDirectoryLoad() {
    if (directoryLoadPhase !== 'partial-error' || !directoryNextCursor) return;
    directoryLoadError = null;
    void continueDirectoryLoad(directoryGeneration, directoryNextCursor);
  }

  function showDirectoryAccessDenied(
    folderId: string | null,
    returnNavigation: DirectoryNavigationSnapshot,
  ) {
    currentFolderId = normalizeDirectoryId(folderId);
    folders = [];
    documents = [];
    fileListIndex = createFileListIndex([], []);
    parentId = null;
    directoryLoadedCount = 0;
    directoryNextCursor = null;
    directoryLoadPhase = 'idle';
    loading = false;
    directoryAccessDenied = { folderId: currentFolderId, returnNavigation };
  }

  async function loadDirectory(
    folderId: string | null,
    preserveOnError = false,
    returnNavigation?: DirectoryNavigationSnapshot,
  ): Promise<boolean> {
    const normalizedFolderId = normalizeDirectoryId(folderId);
    const deniedReturnNavigation = returnNavigation
      ?? (isDeniedDirectory(normalizedFolderId)
        ? directoryAccessDenied!.returnNavigation
        : captureDeniedReturnNavigation(normalizedFolderId));
    const generation = directoryLoader.begin();
    directoryGeneration = generation;
    activeDirectoryReturnNavigation = deniedReturnNavigation;
    const revision = ++sortRevision;
    loading = true;
    directoryLoadPhase = 'initial-loading';
    directoryLoadError = null;
    directoryLoadedCount = 0;
    directoryNextCursor = null;
    fileTableResetKey += 1;
    error = null;
    directoryAccessDenied = null;
    commitSelection(new Set(), new Set());
    try {
      directorySorter?.reset(generation, revision, sortField, sortDirection);
      markFilePerformance('files:list-request-start');
      const resp = await directoryLoader.requestPage(generation, normalizedFolderId, null, DIRECTORY_PAGE_SIZE);
      if (!resp || generation !== directoryGeneration) return false;
      currentFolderId = normalizedFolderId;
      parentId = normalizeDirectoryId(resp.parent_id);
      directoryNextCursor = resp.next_cursor;
      const firstSnapshot = new Promise<boolean>((resolve) => {
        firstDirectorySnapshotGeneration = generation;
        resolveFirstDirectorySnapshot = resolve;
      });
      directorySorter?.append(generation, revision, resp.folders, resp.documents, !resp.has_more);
      const firstVisible = await firstSnapshot;
      if (!firstVisible || generation !== directoryGeneration) return false;
      if (resp.has_more) {
        if (!resp.next_cursor) throw new Error('Directory page reported more items without a cursor.');
        void continueDirectoryLoad(generation, resp.next_cursor);
      }
      return true;
    } catch (e) {
      if (generation !== directoryGeneration) return false;
      directoryLoadError = formatError(e);
      directoryLoadPhase = 'idle';
      if (isAccessDeniedError(e)) {
        showDirectoryAccessDenied(normalizedFolderId, deniedReturnNavigation);
      } else {
        error = String(e);
      }
      if (!preserveOnError && !directoryAccessDenied) {
        folders = [];
        documents = [];
        parentId = null;
      }
      return false;
    } finally {
      if (generation === directoryGeneration && directoryLoadPhase === 'idle') loading = false;
    }
  }

  // --- Navigation ---

  async function handleNavigate(folderId: string, folderName: string) {
    const previousFolderId = currentFolderId;
    const ok = await loadDirectory(folderId);
    if (ok || isDeniedDirectory(folderId)) {
      navHistory = [...navHistory, { label: folderName, id: folderId }];
    }
    if (ok) {
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
    // ROOT_DIRECTORY_ID means root
    if (targetId === ROOT_DIRECTORY_ID) {
      const returnNavigation = captureDirectoryNavigation();
      navigationRootId = null;
      navigationRootLabel = null;
      navHistory = [];
      await loadDirectory(null, false, returnNavigation);
      return;
    }
    if (sameDirectoryId(targetId, navigationRootId)) {
      const ok = await loadDirectory(navigationRootId);
      if (ok || isDeniedDirectory(navigationRootId)) navHistory = [];
      return;
    }
    // Truncate history to the clicked segment
    const idx = navHistory.findIndex((h) => h.id === targetId);
    if (idx >= 0) {
      const ok = await loadDirectory(targetId);
      if (ok || isDeniedDirectory(targetId)) navHistory = navHistory.slice(0, idx + 1);
      return;
    }
    await loadDirectory(targetId);
  }

  async function handleGoToParent() {
    if (directoryAccessDenied) {
      await handleReturnFromDeniedDirectory();
      return;
    }
    if (parentTargetId === undefined) return;
    const targetParentId = parentTargetId;

    const ok = await loadDirectory(targetParentId);
    if (ok && navHistory.length > 0) {
      navHistory = navHistory.slice(0, -1);
    }
  }

  async function handleReturnFromDeniedDirectory() {
    const deniedState = directoryAccessDenied;
    if (!deniedState) return;

    const previous = deniedState.returnNavigation;
    const ok = await loadDirectory(previous.folderId);
    if (!ok) return;
    navigationRootId = previous.navigationRootId;
    navigationRootLabel = previous.navigationRootLabel;
    navHistory = previous.navHistory;
  }

  async function handleJumpToDirectory() {
    const value = await dialogStore.prompt({
      title: $t('files.jumpToDirectory'),
      message: $t('files.jumpToDirectoryPrompt'),
      defaultValue: currentFolderId ?? ROOT_DIRECTORY_ID,
      confirmLabel: $t('common.open'),
      cancelLabel: $t('common.cancel'),
      selectOnOpen: true,
    });
    if (value === null) return;

    const target = normalizeDirectoryId(value);
    const ok = await loadDirectory(target, true);
    if (!ok && !isDeniedDirectory(target)) return;

    navigationRootId = target;
    navigationRootLabel = target === null ? null : shortIdentifier(target);
    navHistory = [];
    if (ok) status = $t('files.jumpToDirectorySuccess');
  }

  // --- Selection ---

  function sumSelectedDocumentSize(ids: ReadonlySet<string>) {
    return sumDocumentSelectionSize(ids, fileListIndex.documentSizeById);
  }

  function commitSelection(
    nextFolders: Set<string>,
    nextDocuments: Set<string>,
    documentSize = sumSelectedDocumentSize(nextDocuments),
  ) {
    selectedFolderIds = nextFolders;
    selectedDocumentIds = nextDocuments;
    selectedDocumentSize = documentSize;
    selectionRevision += 1;
  }

  function toggleSelectFolder(id: string) {
    const next = new Set(selectedFolderIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    commitSelection(next, selectedDocumentIds, selectedDocumentSize);
  }

  function toggleSelectDocument(id: string) {
    const next = new Set(selectedDocumentIds);
    const wasSelected = next.delete(id);
    if (!wasSelected) next.add(id);
    const size = fileListIndex.documentSizeById.get(id) ?? 0;
    commitSelection(selectedFolderIds, next, selectedDocumentSize + (wasSelected ? -size : size));
  }

  function clearSelection() {
    commitSelection(new Set(), new Set(), 0);
    focusedItemKey = null;
    selectionAnchorKey = null;
    selectMode = false;
  }

  function deselectAll() {
    commitSelection(new Set(), new Set(), 0);
    focusedItemKey = null;
    selectionAnchorKey = null;
  }

  function selectAllVisible() {
    commitSelection(
      new Set(fileListIndex.folderById.keys()),
      new Set(fileListIndex.documentById.keys()),
      fileListIndex.totalDocumentSize,
    );
    const firstFolder = folders[0];
    const firstDocument = documents[0];
    const lastDocument = documents.at(-1);
    const lastFolder = folders.at(-1);
    selectionAnchorKey = firstFolder
      ? fileSelectionKey('folder', firstFolder.id)
      : firstDocument
        ? fileSelectionKey('document', firstDocument.id)
        : null;
    focusedItemKey = lastDocument
      ? fileSelectionKey('document', lastDocument.id)
      : lastFolder
        ? fileSelectionKey('folder', lastFolder.id)
        : null;
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
    isAllVisibleSelected(folders.length, documents.length, {
      folders: selectedFolderIds,
      documents: selectedDocumentIds,
    }),
  );
  const selectedFolder = $derived.by(() => {
    if (totalSelected !== 1 || selectedFolderIds.size !== 1) return null;
    const id = selectedFolderIds.values().next().value;
    return id ? fileListIndex.folderById.get(id) ?? null : null;
  });
  const selectedDocument = $derived.by(() => {
    if (totalSelected !== 1 || selectedDocumentIds.size !== 1) return null;
    const id = selectedDocumentIds.values().next().value;
    return id ? fileListIndex.documentById.get(id) ?? null : null;
  });
  const statusBarPrimary = $derived(
    directoryLoadPhase === 'complete' || directoryLoadPhase === 'idle'
      ? $t('workspace.itemCount', { values: { count: totalVisibleSelectable } })
      : $t('workspace.itemsLoaded', { values: { count: directoryLoadedCount } }),
  );
  const statusBarSecondary = $derived(
    directoryLoadPhase === 'partial-error'
      ? `${$t('workspace.loadingInterrupted')}${directoryLoadError ? `: ${directoryLoadError}` : ''}`
      : totalSelected > 0
        ? `${$t('workspace.selectedItems', { values: { count: totalSelected } })}${selectedDocumentSize > 0 ? ` · ${formatBytes(selectedDocumentSize)}` : ''}`
        : directoryLoadPhase === 'initial-loading'
        ? $t('workspace.loadingDirectory')
        : directoryLoadPhase === 'loading-more'
          ? $t('workspace.loadingMoreItems')
          : '',
  );
  const fileCommandActions = $derived.by<CommandAction[]>(() => [
    { id: 'new-folder', label: $t('files.createFolder'), icon: 'createNewFolder', run: handleCreateFolder },
    { id: 'upload-files', label: $t('files.uploadFiles'), icon: 'uploadFile', run: handleUploadFiles },
    { id: 'upload-folder', label: $t('files.uploadFolder'), icon: 'folderUpload', run: handleUploadFolder },
    {
      id: 'download-selected',
      label: $t('files.downloadSelected'),
      icon: 'download',
      visible: totalSelected > 0,
      disabled: batchBusy,
      dividerBefore: true,
      run: handleDownloadSelected,
    },
    {
      id: 'rename-selected',
      label: $t('files.rename'),
      icon: 'edit',
      visible: totalSelected === 1,
      disabled: batchBusy || !canRenameSelected(),
      run: handleRenameSelected,
    },
    {
      id: 'move-selected',
      label: $t('files.moveSelected'),
      icon: 'driveFileMove',
      visible: totalSelected > 0,
      disabled: batchBusy || !hasPermission('move'),
      run: handleMoveSelected,
    },
    {
      id: 'delete-selected',
      label: $t('common.delete'),
      icon: 'delete',
      tone: 'danger',
      visible: totalSelected > 0,
      disabled: batchBusy || !canDeleteSelection(),
      run: handleDeleteSelected,
    },
    {
      id: 'selection-mode',
      label: $t('files.select'),
      icon: 'checklist',
      compact: true,
      active: selectMode,
      dividerBefore: true,
      run: toggleSelectMode,
    },
    {
      id: 'select-all',
      label: allVisibleSelected ? $t('files.selectNone') : $t('files.selectAll'),
      icon: allVisibleSelected ? 'clearAll' : 'selectAll',
      active: allVisibleSelected,
      visible: selectMode,
      disabled: totalVisibleSelectable === 0,
      run: toggleAllVisibleSelection,
    },
    {
      id: 'jump',
      label: $t('files.jumpToDirectory'),
      icon: 'folderEye',
      compact: true,
      run: handleJumpToDirectory,
    },
    {
      id: 'details',
      label: $t('workspace.details'),
      icon: 'info',
      compact: true,
      active: detailsOpen,
      run: () => { detailsOpen = !detailsOpen; },
    },
    {
      id: 'trash',
      label: $t('workspace.recycleBin'),
      icon: 'deleteSweep',
      compact: true,
      dividerBefore: true,
      disabled: batchBusy || !hasPermission('list_deleted_items'),
      run: handleNavigateTrash,
    },
  ]);

  $effect(() => {
    const open = detailsOpen;
    selectionRevision;
    if (!open) {
      detailRequestId += 1;
      return;
    }
    void loadSelectionDetails();
  });

  // --- Download ---

  async function handleDownload(doc: ServerDocumentEntry) {
    try {
      await getDocument(doc.id, doc.title);
      await rememberVisit(currentFilePreferenceScope(), documentToRecord(doc, currentFolderId));
    } catch (e) {
      if (isAccessDeniedError(e)) {
        documentAccessDenied = { name: doc.title, id: doc.id, accessedAt: Date.now() };
      } else {
        error = String(e);
      }
    }
  }

  function handleDocumentClick(event: MouseEvent, doc: ServerDocumentEntry) {
    if (coarsePointer && !selectMode) {
      void handleDownload(doc);
      return;
    }
    selectRow(event, 'document', doc.id);
  }

  function handleFolderClick(event: MouseEvent, folder: ServerDirectoryEntry) {
    if (coarsePointer && !selectMode) {
      void handleNavigate(folder.id, folder.name);
      return;
    }
    selectRow(event, 'folder', folder.id);
  }

  function handleDocumentActivate(doc: ServerDocumentEntry) {
    if (!coarsePointer && !selectMode) void handleDownload(doc);
  }

  function handleFolderActivate(folder: ServerDirectoryEntry) {
    if (!coarsePointer && !selectMode) void handleNavigate(folder.id, folder.name);
  }

  function selectRow(event: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>, kind: 'folder' | 'document', id: string) {
    const key = fileSelectionKey(kind, id);
    focusedItemKey = key;
    if (selectMode) {
      if (kind === 'folder') toggleSelectFolder(id); else toggleSelectDocument(id);
      selectionAnchorKey = key;
      return;
    }

    if (event.shiftKey && selectionAnchorKey) {
      selectRange(selectionAnchorKey, key, event.ctrlKey || event.metaKey);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      if (kind === 'folder') toggleSelectFolder(id); else toggleSelectDocument(id);
      selectionAnchorKey = key;
      return;
    }

    commitSelection(
      new Set(kind === 'folder' ? [id] : []),
      new Set(kind === 'document' ? [id] : []),
    );
    selectionAnchorKey = key;
  }

  function selectRange(anchorKey: string, targetKey: string, preserveExisting: boolean) {
    const next = selectFileRangeByIndex(
      fileListIndex.folderIds,
      fileListIndex.documentIds,
      fileListIndex.keyToIndex,
      anchorKey,
      targetKey,
      { folders: selectedFolderIds, documents: selectedDocumentIds },
      preserveExisting,
    );
    commitSelection(next.folders, next.documents);
    focusedItemKey = targetKey;
  }

  function handleFileRowKeydown(event: KeyboardEvent, row: FileTableRow) {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(event.key)) {
      const id = row.kind === 'folder' ? row.folder.id : row.document.id;
      if (event.ctrlKey || event.metaKey) focusedItemKey = fileSelectionKey(row.kind, id);
      else selectRow({ ctrlKey: false, metaKey: false, shiftKey: event.shiftKey }, row.kind, id);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (row.kind === 'folder') void handleNavigate(row.folder.id, row.folder.name);
      else void handleDownload(row.document);
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      const id = row.kind === 'folder' ? row.folder.id : row.document.id;
      selectRow({ ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey }, row.kind, id);
    }
  }

  function handleFilePageShortcut(event: KeyboardEvent) {
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (hasBlockingFilesDialog()) return;
    const shortcut = fileManagerShortcutFor(event);
    if (!shortcut) return;

    executeFileManagerShortcut(shortcut, event);
  }

  function executeFileManagerShortcut(shortcut: FileManagerShortcut, event: KeyboardEvent) {
    if (shortcut === 'go-parent') {
      event.preventDefault();
      if (canGoToParent && !loading) void handleGoToParent();
    } else if (shortcut === 'refresh') {
      event.preventDefault();
      if (!loading) void loadDirectory(currentFolderId, true);
    } else if (shortcut === 'create-folder') {
      event.preventDefault();
      if (!loading && !batchBusy) void handleCreateFolder();
    } else if (shortcut === 'select-all') {
      event.preventDefault();
      selectAllVisible();
    } else if (shortcut === 'clear-selection' && totalSelected > 0) {
      event.preventDefault();
      deselectAll();
    } else if (shortcut === 'delete-selection' && totalSelected > 0 && canDeleteSelection()) {
      event.preventDefault();
      void handleDeleteSelected();
    } else if (shortcut === 'rename-selection' && totalSelected === 1 && canRenameSelected()) {
      event.preventDefault();
      void handleRenameSelected();
    }
  }

  function hasPermission(...permissions: string[]) {
    return authStore.permissions.includes('manage_system') || permissions.some((permission) => authStore.permissions.includes(permission));
  }

  function canRenameSelected() {
    return selectedFolder ? hasPermission('rename_directory') : selectedDocument ? hasPermission('rename_document') : false;
  }

  function canDeleteSelection() {
    return (selectedFolderIds.size === 0 || hasPermission('delete_directory'))
      && (selectedDocumentIds.size === 0 || hasPermission('delete_document'));
  }

  async function handleRenameSelected() {
    if (selectedFolder) await handleRenameFolder(selectedFolder);
    else if (selectedDocument) await handleRenameDocument(selectedDocument);
  }

  async function loadSelectionDetails() {
    const requestId = ++detailRequestId;
    if (totalSelected === 0) {
      detailModel = null;
      return;
    }
    if (totalSelected > 1) {
      detailModel = {
        title: $t('workspace.selectedItems', { values: { count: totalSelected } }),
        icon: 'checklist',
        rows: [
          { label: $t('files.directory'), value: String(selectedFolderIds.size) },
          { label: $t('files.document'), value: String(selectedDocumentIds.size) },
          { label: $t('files.size'), value: formatBytes(selectedDocumentSize) },
        ],
      };
      return;
    }

    const selectedName = selectedFolder?.name ?? selectedDocument?.title ?? '';
    detailModel = { title: selectedName, icon: selectedFolder ? 'folder' : 'filePresent', loading: true, rows: [] };
    try {
      if (selectedFolder) {
        const info = await getDirectoryInfo(selectedFolder.id);
        if (requestId !== detailRequestId) return;
        detailModel = {
          title: info.name ?? selectedFolder.name,
          subtitle: $t('files.directory'),
          icon: 'folder',
          rows: [
            { label: $t('files.directoryId'), value: info.directory_id ?? selectedFolder.id },
            { label: $t('files.childCount'), value: String(info.count_of_child ?? '-') },
            { label: $t('files.created'), value: formatDate(info.created_time ?? selectedFolder.created_time) },
            { label: $t('files.parentId'), value: info.parent_id ?? '-' },
          ],
        };
      } else if (selectedDocument) {
        const info = await getDocumentInfo(selectedDocument.id);
        if (requestId !== detailRequestId) return;
        detailModel = {
          title: info.title ?? selectedDocument.title,
          subtitle: $t('files.document'),
          icon: 'filePresent',
          rows: [
            { label: $t('files.documentId'), value: info.document_id ?? selectedDocument.id },
            { label: $t('files.size'), value: formatBytes(info.size ?? selectedDocument.size) },
            { label: $t('files.created'), value: formatDate(info.created_time ?? null) },
            { label: $t('files.modified'), value: formatDate(info.last_modified ?? selectedDocument.last_modified) },
            { label: $t('files.creator'), value: info.metadata?.creator ?? '-' },
            { label: $t('files.tags'), value: formatList(info.metadata?.tags) },
          ],
        };
      }
    } catch (detailError) {
      if (requestId !== detailRequestId) return;
      detailModel = { title: selectedName, icon: selectedFolder ? 'folder' : 'filePresent', error: formatError(detailError), rows: [] };
    }
  }

  // --- Context menu ---

  function hideContextMenu() {
    contextMenu = { open: false, x: 0, y: 0, kind: null, item: null, sourceElement: null };
  }

  function showFolderContextMenu(e: MouseEvent | KeyboardEvent, folder: ServerDirectoryEntry) {
    e.preventDefault();
    const anchor = keyboardMenuAnchor(e);
    if (selectedFolderIds.has(folder.id) && totalSelected > 1) {
      contextMenu = { open: true, ...anchor, kind: 'selection', item: null };
      return;
    }
    if (!selectedFolderIds.has(folder.id)) {
      commitSelection(new Set([folder.id]), new Set(), 0);
      focusedItemKey = `folder:${folder.id}`;
      selectionAnchorKey = focusedItemKey;
    }
    contextMenu = { open: true, ...anchor, kind: 'folder', item: folder };
  }

  function showDocumentContextMenu(e: MouseEvent | KeyboardEvent, doc: ServerDocumentEntry) {
    e.preventDefault();
    const anchor = keyboardMenuAnchor(e);
    if (selectedDocumentIds.has(doc.id) && totalSelected > 1) {
      contextMenu = { open: true, ...anchor, kind: 'selection', item: null };
      return;
    }
    if (!selectedDocumentIds.has(doc.id)) {
      commitSelection(new Set(), new Set([doc.id]), doc.size ?? 0);
      focusedItemKey = `document:${doc.id}`;
      selectionAnchorKey = focusedItemKey;
    }
    contextMenu = { open: true, ...anchor, kind: 'document', item: doc };
  }

  function showCurrentDirectoryContextMenu(e: MouseEvent) {
    e.preventDefault();
    contextMenu = { open: true, ...keyboardMenuAnchor(e), kind: 'current-directory', item: null };
  }

  function showFilesPageBlankContextMenu(e: MouseEvent) {
    if (e.target !== e.currentTarget) return;
    showCurrentDirectoryContextMenu(e);
  }

  function currentDirectoryName() {
    return navHistory[navHistory.length - 1]?.label
      ?? navigationRootLabel
      ?? $t('files.rootDirectory');
  }

  function getContextMenuItems(): ContextMenuItem[] {
    if (contextMenu.kind === 'selection') {
      return [
        {
          id: 'download-selection',
          label: $t('files.downloadSelected'),
          icon: 'download',
          disabled: batchBusy,
          onSelect: handleDownloadSelected,
        },
        {
          id: 'move-selection',
          label: $t('files.moveSelected'),
          icon: 'driveFileMove',
          disabled: batchBusy || !hasPermission('move'),
          onSelect: handleMoveSelected,
        },
        { type: 'divider' },
        {
          id: 'delete-selection',
          label: $t('common.delete'),
          icon: 'delete',
          disabled: batchBusy || !canDeleteSelection(),
          danger: true,
          onSelect: handleDeleteSelected,
        },
      ];
    }

    if (contextMenu.kind === 'current-directory') {
      const directoryId = currentFolderId ?? ROOT_DIRECTORY_ID;
      const directoryName = currentDirectoryName();
      return [
        {
          id: 'refresh-current-directory',
          label: $t('common.refresh'),
          icon: 'refresh',
          onSelect: async () => {
            await loadDirectory(currentFolderId);
          },
        },
        { type: 'divider' },
        {
          id: 'create-directory-here',
          label: $t('files.createFolder'),
          icon: 'createNewFolder',
          onSelect: handleCreateFolder,
        },
        {
          id: 'upload-files-here',
          label: $t('files.uploadFiles'),
          icon: 'uploadFile',
          onSelect: handleUploadFiles,
        },
        {
          id: 'upload-folder-here',
          label: $t('files.uploadFolder'),
          icon: 'folderUpload',
          onSelect: handleUploadFolder,
        },
        { type: 'divider' },
        {
          id: 'authorize-current-directory',
          label: $t('files.authorize'),
          icon: 'lockPerson',
          requiredPermissions: ['manage_access'],
          onSelect: () => handleAuthorize('directory', directoryId, directoryName),
        },
        {
          id: 'view-current-directory-access',
          label: $t('files.viewAccessEntries'),
          icon: 'listAlt',
          requiredPermissions: ['view_access_entries'],
          onSelect: () => handleViewAccessEntries('directory', directoryId, directoryName),
        },
        {
          id: 'current-directory-rules',
          label: $t('files.setPermissions'),
          icon: 'settings',
          requiredPermissions: ['set_access_rules'],
          onSelect: () => handleSetAccessRules('directory', directoryId, directoryName),
        },
        { type: 'divider' },
        {
          id: 'current-directory-properties',
          label: $t('files.properties'),
          icon: 'info',
          onSelect: () => handleDirectoryProperties(directoryId, directoryName, null),
        },
      ];
    }

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
    await handleDirectoryProperties(folder.id, folder.name, folder.created_time);
  }

  async function handleDirectoryProperties(
    directoryId: string,
    fallbackName: string,
    fallbackCreatedTime: number | null,
  ) {
    await runFileAction(async () => {
      const info = await getDirectoryInfo(directoryId);
      detailTitle = $t('files.directoryDetails');
      detailRows = [
        { label: $t('files.directoryId'), value: info.directory_id ?? directoryId },
        { label: $t('files.directoryName'), value: info.name ?? fallbackName },
        { label: $t('files.childCount'), value: String(info.count_of_child ?? '-') },
        { label: $t('files.created'), value: formatDate(info.created_time ?? fallbackCreatedTime) },
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

  async function handleDeleteRevision(revision: RevisionEntry) {
    if (!revisionsDialog || revision.is_current) return;
    if (!(await dialogStore.confirm({
      title: $t('files.deleteRevision'),
      message: $t('files.deleteRevisionConfirm', {
        values: { revision: shortIdentifier(revision.id) },
      }),
      confirmLabel: $t('common.delete'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    }))) return;

    await runFileAction(async () => {
      await deleteRevision(revision.id);
      await refreshRevisionsDialog();
      await loadDirectory(currentFolderId);
      status = $t('files.deleteRevisionSuccess');
    });
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

    const candidates = files.map<UploadCandidate>((filePath) => ({
      sourcePath: filePath,
      name: uploadDisplayName(filePath),
      kind: 'file',
    }));
    await queueUploadCandidates(currentFolderId, candidates);
  }

  async function handleUploadFolder() {
    let selected: SelectedDirectory | null;
    try {
      selected = await pickDirectory({
        title: $t('files.selectFolderToUpload'),
      });
    } catch (err) {
      handlePickerError(err);
      return;
    }
    if (!selected) return;

    await queueUploadCandidates(currentFolderId, [{
      sourcePath: selected.path,
      name: selected.name || uploadDisplayName(selected.path),
      kind: 'directory',
    }]);
  }

  const DROP_BATCH_DEDUP_WINDOW_MS = 1000;

  async function handleDroppedUploadPaths(paths: string[]) {
    const uniquePaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
    if (uniquePaths.length === 0) return;

    const signature = droppedPathBatchSignature(uniquePaths);
    const now = Date.now();
    if (
      signature === lastDropBatchSignature
      && now - lastDropBatchAt < DROP_BATCH_DEDUP_WINDOW_MS
    ) {
      return;
    }
    lastDropBatchSignature = signature;
    lastDropBatchAt = now;

    const targetFolderId = currentFolderId;
    let unsupported = 0;
    const candidates: UploadCandidate[] = [];

    for (const path of uniquePaths) {
      const kind = await droppedUploadKind(path);
      if (kind) {
        candidates.push({
          sourcePath: path,
          name: uploadDisplayName(path),
          kind,
        });
      } else {
        unsupported += 1;
      }
    }

    if (candidates.length > 0) {
      await queueUploadCandidates(targetFolderId, candidates);
    }

    if (unsupported > 0) {
      notificationStore.warning($t('files.dropUnsupported'));
    }
  }

  function droppedPathBatchSignature(paths: string[]) {
    return JSON.stringify([...paths].sort());
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

    if (nativeDragDropAvailable) return;

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

  async function queueUploadCandidates(
    targetFolderId: string | null,
    candidates: UploadCandidate[],
  ) {
    if (candidates.length === 0) return;

    let listing;
    try {
      listing = await listDirectory(targetFolderId);
    } catch (err) {
      error = formatError(err);
      return;
    }

    const fileCandidates = candidates.filter((candidate) => candidate.kind === 'file');
    const directoryCandidates = candidates.filter((candidate) => candidate.kind === 'directory');
    const { available: availableFiles, conflicting: conflictingFiles } = partitionUploadConflicts(
      fileCandidates,
      listing.folders,
      listing.documents,
    );
    const directoryResolutions = new Map<string, DirectoryFileConflictResolution[]>();
    const decisions: UploadConflictDecision<PendingUploadConflict>[] = [];
    const resolver = createUploadConflictResolver<PendingUploadConflict>(
      async (candidate, index) => {
        const resolution = await dialogStore.choose<UploadConflictAction>({
          title: $t('files.uploadConflictTitle'),
          message: $t('files.uploadConflictMessage'),
          detailLabel: $t('files.uploadConflictProgress', {
            values: { current: index + 1 },
          }),
          details: [{
            label: candidate.name,
            meta: candidate.relativePath
              ? $t('files.uploadConflictDirectoryFile', {
                  values: { path: candidate.relativePath },
                })
              : $t('files.uploadConflictFile'),
            badge: $t('files.uploadConflictBadge'),
            kind: candidate.kind,
          }],
          applyToAllLabel: $t('files.uploadConflictApplyRemaining'),
          choices: [
            {
              value: 'overwrite',
              label: $t('files.uploadConflictOverwrite'),
              description: $t('files.uploadConflictOverwriteHint'),
              icon: 'refresh',
              intent: 'danger',
            },
            {
              value: 'keep_both',
              label: $t('files.uploadConflictKeepBoth'),
              description: $t('files.uploadConflictKeepBothHint'),
              icon: 'edit',
              intent: 'primary',
            },
            {
              value: 'skip',
              label: $t('files.uploadConflictSkip'),
              description: $t('files.uploadConflictSkipHint'),
              icon: 'block',
              intent: 'neutral',
            },
          ],
          cancelLabel: $t('common.cancel'),
        });

        return resolution
          ? { action: resolution.value, applyToRemaining: resolution.applyToAll }
          : null;
      },
    );

    for (const candidate of conflictingFiles) {
      const decision = await resolver.resolve(candidate);
      if (!decision) return;
      decisions.push(decision);
    }

    for (const directory of directoryCandidates) {
      directoryResolutions.set(directory.sourcePath, []);
      try {
        await inspectUploadDirectoryConflicts(
          targetFolderId,
          directory.sourcePath,
          directory.name,
          async (conflict) => {
            const decision = await resolver.resolve({
              sourcePath: directory.sourcePath,
              name: conflict.name,
              kind: 'file',
              directoryPath: directory.sourcePath,
              relativePath: conflict.relativePath,
            });
            if (decision) decisions.push(decision);
          },
        );
      } catch (err) {
        error = formatError(err);
        return;
      }
      if (resolver.cancelled) return;
    }

    for (const candidate of availableFiles) {
      scheduleUploadCandidate(targetFolderId, candidate, 'fail');
    }
    for (const { candidate, action } of decisions) {
      if (candidate.directoryPath && candidate.relativePath) {
        directoryResolutions.get(candidate.directoryPath)?.push({
          relativePath: candidate.relativePath,
          conflictStrategy: action,
        });
      } else if (action !== 'skip') {
        scheduleUploadCandidate(targetFolderId, candidate, action);
      }
    }
    for (const candidate of directoryCandidates) {
      scheduleUploadCandidate(
        targetFolderId,
        candidate,
        'fail',
        directoryResolutions.get(candidate.sourcePath) ?? [],
      );
    }
  }

  function scheduleUploadCandidate(
    targetFolderId: string | null,
    candidate: UploadCandidate,
    conflictStrategy: UploadConflictStrategy,
    conflictResolutions: DirectoryFileConflictResolution[] = [],
  ) {
    const action = candidate.kind === 'directory'
      ? (uploadId: string, uploadName: string) => uploadDirectory(
          targetFolderId,
          candidate.sourcePath,
          uploadId,
          conflictStrategy,
          uploadName,
          conflictResolutions,
        )
      : (uploadId: string, uploadName: string) => uploadDocumentFile(
          targetFolderId,
          candidate.sourcePath,
          uploadId,
          conflictStrategy,
          uploadName,
        );

    scheduleUpload(candidate.sourcePath, action, candidate.name);
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

  function clearSearchPreviewDebounce() {
    if (!searchPreviewDebounce) return;
    clearTimeout(searchPreviewDebounce);
    searchPreviewDebounce = null;
  }

  function updateSearchPreviewPanelPosition() {
    if (!searchPreviewRoot || typeof window === 'undefined') {
      searchPreviewPanelStyle = '';
      return;
    }

    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const margin = 16;
    const width = Math.max(0, Math.min(720, viewportWidth - margin * 2));
    const rect = searchPreviewRoot.getBoundingClientRect();
    const maxLeft = Math.max(margin, viewportWidth - width - margin);
    const left = Math.min(Math.max(rect.right - width, margin), maxLeft);
    const top = rect.bottom + 8;

    searchPreviewPanelStyle = `left: ${Math.round(left)}px; top: ${Math.round(top)}px; width: ${Math.round(width)}px;`;
  }

  function queueSearchPreviewPanelPosition() {
    updateSearchPreviewPanelPosition();

    if (typeof requestAnimationFrame === 'undefined') {
      return;
    }

    if (searchPreviewPositionFrame !== null) return;
    searchPreviewPositionFrame = requestAnimationFrame(() => {
      searchPreviewPositionFrame = null;
      if (searchPreview.open) updateSearchPreviewPanelPosition();
    });
  }

  function clearSearchPreviewPanelPosition() {
    if (searchPreviewPositionFrame === null || typeof cancelAnimationFrame === 'undefined') return;
    cancelAnimationFrame(searchPreviewPositionFrame);
    searchPreviewPositionFrame = null;
  }

  function closeSearchPreview() {
    clearSearchPreviewDebounce();
    clearSearchPreviewPanelPosition();
    searchPreviewRunId += 1;
    searchPreview.open = false;
    searchPreview.loading = false;
    searchPreview.loadingMore = false;
    searchPreviewActiveIndex = -1;
  }

  function resetSearchPreviewResults() {
    searchPreview.results = null;
    searchPreview.error = null;
    searchPreview.loadingMore = false;
  }

  function openSearchPreview() {
    searchPreview.open = true;
    queueSearchPreviewPanelPosition();
    scheduleSearchPreview();
  }

  function focusFilesSearchInput() {
    const target = searchDialog.open ? searchDialogInput : searchInput;
    target?.focus({ preventScroll: true });
    target?.select();
    if (!searchDialog.open) {
      openSearchPreview();
    }
  }

  function hasBlockingFilesDialog() {
    return Boolean(
      detailTitle
        || accessEntriesDialog
        || authorizeDialog
        || accessRulesDialog
        || moveTargetDialog
        || batchMoveDialog
        || revisionsDialog
        || documentTagsDialog,
    );
  }

  function handleFindShortcut(event: KeyboardEvent) {
    if (!isFindShortcut(event)) return;

    event.preventDefault();
    if (hasBlockingFilesDialog()) return;
    focusFilesSearchInput();
  }

  function handleSearchInput(event?: Event) {
    if (event?.currentTarget instanceof HTMLInputElement) {
      searchQuery = event.currentTarget.value;
    }
    if (!searchPreviewHasQuery) {
      resetSearchPreviewResults();
      searchPreview.open = false;
      searchPreview.loading = false;
      return;
    }
    searchPreview.open = true;
    queueSearchPreviewPanelPosition();
    scheduleSearchPreview();
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeSearchPreview();
      return;
    }

    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && searchPreviewRows.length > 0) {
      event.preventDefault();
      if (!searchPreview.open) openSearchPreview();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const start = searchPreviewActiveIndex < 0 ? (delta > 0 ? -1 : 0) : searchPreviewActiveIndex;
      searchPreviewActiveIndex = (start + delta + searchPreviewRows.length) % searchPreviewRows.length;
      document.getElementById(`files-search-preview-option-${searchPreviewActiveIndex}`)?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if ((event.key === 'Home' || event.key === 'End') && searchPreview.open && searchPreviewRows.length > 0) {
      event.preventDefault();
      searchPreviewActiveIndex = event.key === 'Home' ? 0 : searchPreviewRows.length - 1;
      document.getElementById(`files-search-preview-option-${searchPreviewActiveIndex}`)?.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (searchPreview.open && searchPreviewActiveIndex >= 0) {
        const row = searchPreviewRows[searchPreviewActiveIndex];
        if (row.kind === 'directory') void navigateToSearchDirectory(row.directory);
        else void navigateToSearchDocument(row.document);
        return;
      }
      openSearchDialog(true);
    }
  }

  function scheduleSearchPreview(immediate = false) {
    const hadSettledResults = searchPreview.results !== null;
    const hadPendingPreview =
      searchPreview.loading || searchPreview.loadingMore || searchPreviewDebounce !== null;
    clearSearchPreviewDebounce();

    const query = searchQuery.trim();
    if (!query) {
      resetSearchPreviewResults();
      searchPreview.loading = false;
      return;
    }

    if (!searchPreview.searchDocuments && !searchPreview.searchDirectories) {
      searchPreview.loading = false;
      searchPreview.loadingMore = false;
      searchPreview.error = $t('files.searchTypeRequired');
      return;
    }

    const runId = ++searchPreviewRunId;
    const shouldLoadImmediately = immediate || (!hadSettledResults && !hadPendingPreview);
    searchPreview.open = true;
    queueSearchPreviewPanelPosition();
    searchPreview.error = null;
    searchPreview.loading = shouldLoadImmediately ? searchPreview.loading : !hadSettledResults;
    searchPreview.loadingMore = false;
    const load = () => {
      searchPreviewDebounce = null;
      void loadSearchPreviewPage({ cursor: null, reset: true, runId });
    };

    if (shouldLoadImmediately) {
      load();
    } else {
      searchPreviewDebounce = setTimeout(load, SEARCH_PREVIEW_DEBOUNCE_MS);
    }
  }

  async function loadSearchPreviewPage({
    cursor,
    reset,
    runId,
  }: {
    cursor: string | null;
    reset: boolean;
    runId: number;
  }) {
    const query = searchQuery.trim();
    if (!query || (!searchPreview.searchDocuments && !searchPreview.searchDirectories)) {
      searchPreview.loading = false;
      searchPreview.loadingMore = false;
      return;
    }

    const searchDocuments = searchPreview.searchDocuments;
    const searchDirectories = searchPreview.searchDirectories;
    const sortBy = searchSortByParam(searchPreview.sortBy);
    const sortOrder = searchPreview.sortOrder;

    if (reset) {
      searchPreview.loading = true;
      searchPreview.loadingMore = false;
    } else {
      searchPreview.loadingMore = true;
    }

    try {
      const page = await searchFiles(query, {
        pageSize: SEARCH_PREVIEW_PAGE_SIZE,
        cursor,
        sortBy,
        sortOrder,
        searchDocuments,
        searchDirectories,
      });
      if (runId !== searchPreviewRunId) return;

      searchPreview.query = query;
      searchPreview.results = reset || !searchPreview.results
        ? page
        : mergeSearchResults(searchPreview.results, page);
      searchPreview.loading = false;
      searchPreview.loadingMore = false;
      searchPreview.error = null;
    } catch (e) {
      if (runId !== searchPreviewRunId) return;
      searchPreview.loading = false;
      searchPreview.loadingMore = false;
      searchPreview.error = formatError(e);
    }
  }

  function loadMoreSearchPreview() {
    const results = searchPreview.results;
    if (
      !results?.has_more
      || !results.next_cursor
      || searchQuery.trim() !== searchPreview.query
      || searchPreview.loading
      || searchPreview.loadingMore
    ) {
      return;
    }

    const runId = ++searchPreviewRunId;
    void loadSearchPreviewPage({ cursor: results.next_cursor, reset: false, runId });
  }

  function handleSearchPreviewScroll(event: Event) {
    const target = event.currentTarget as HTMLElement;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom <= SEARCH_PREVIEW_SCROLL_THRESHOLD) {
      loadMoreSearchPreview();
    }
  }

  function updateSearchPreviewOptions() {
    if (!searchPreview.open && searchPreviewHasQuery) {
      searchPreview.open = true;
    }
    scheduleSearchPreview(true);
  }

  function setSearchPreviewSort(field: SortField) {
    searchPreview.sortBy = field;
    updateSearchPreviewOptions();
  }

  function toggleSearchPreviewSortOrder() {
    searchPreview.sortOrder = searchPreview.sortOrder === 'asc' ? 'desc' : 'asc';
    updateSearchPreviewOptions();
  }

  function setSearchDialogSort(field: SortField) {
    if (searchDialog.sortBy === field) return;
    searchDialog.sortBy = field;
    rerunSearchDialogIfReady();
  }

  function toggleSearchDialogSortOrder() {
    searchDialog.sortOrder = searchDialog.sortOrder === 'asc' ? 'desc' : 'asc';
    rerunSearchDialogIfReady();
  }

  function rerunSearchDialogIfReady() {
    if (!searchDialog.query.trim()) return;
    if (!searchDialog.searchDocuments && !searchDialog.searchDirectories) return;
    void runServerSearch();
  }

  function searchSortLabel(field: SortField) {
    return field === 'name'
      ? $t('files.searchSortName')
      : field === 'size'
        ? $t('files.searchSortSize')
        : $t('files.searchSortModified');
  }

  function searchSortByParam(field: SortField) {
    return field === 'modified' ? 'last_modified' : field;
  }

  function searchSortIndex(field: SortField) {
    return field === 'name' ? 0 : field === 'size' ? 1 : 2;
  }

  function searchSortIndicatorStyle(field: SortField) {
    return `width: calc((100% - 4px) / 3); transform: translateX(${searchSortIndex(field) * 100}%);`;
  }

  function searchResultDate(row: SearchResultRow) {
    return row.kind === 'directory'
      ? formatDate(row.directory.created_time)
      : formatDate(row.document.last_modified ?? null);
  }

  function openSearchDialog(runImmediately = false) {
    const query = searchQuery.trim() ? searchQuery : searchPreview.query;
    closeSearchPreview();
    searchDialog.open = true;
    searchDialog.query = query;
    searchDialog.resultQuery = '';
    searchDialog.searchDocuments = searchPreview.searchDocuments;
    searchDialog.searchDirectories = searchPreview.searchDirectories;
    searchDialog.sortBy = searchPreview.sortBy;
    searchDialog.sortOrder = searchPreview.sortOrder;
    searchDialog.loading = false;
    searchDialog.results = null;

    if (runImmediately) {
      void runServerSearch();
    }
  }

  function emptySearchResults(): SearchFilesResponse {
    return {
      documents: [],
      directories: [],
      total_count: 0,
      page_size: SERVER_SEARCH_PAGE_SIZE,
      next_cursor: null,
      has_more: false,
    };
  }

  function mergeSearchResults(
    previous: SearchFilesResponse,
    page: SearchFilesResponse,
  ): SearchFilesResponse {
    return {
      ...page,
      documents: [...previous.documents, ...page.documents],
      directories: [...previous.directories, ...page.directories],
      total_count: previous.total_count + page.total_count,
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

    const runId = ++searchRunId;
    const searchDocuments = searchDialog.searchDocuments;
    const searchDirectories = searchDialog.searchDirectories;
    const sortBy = searchSortByParam(searchDialog.sortBy);
    const sortOrder = searchDialog.sortOrder;
    let cursor: string | null = null;
    let combined = emptySearchResults();

    searchDialog = { ...searchDialog, resultQuery: query, loading: true, results: null };
    try {
      while (true) {
        const results = await searchFiles(query, {
          pageSize: SERVER_SEARCH_PAGE_SIZE,
          cursor,
          sortBy,
          sortOrder,
          searchDocuments,
          searchDirectories,
        });
        if (runId !== searchRunId) return;

        combined = mergeSearchResults(combined, results);
        searchDialog = { ...searchDialog, results: combined, loading: results.has_more };

        if (!results.has_more) break;
        cursor = results.next_cursor;
        if (!cursor) {
          throw new Error('Server reported more search results without a cursor.');
        }
      }

      searchDialog = { ...searchDialog, loading: false, results: combined };
    } catch (e) {
      if (runId !== searchRunId) return;
      searchDialog = { ...searchDialog, loading: false };
      error = formatError(e);
    }
  }

  function closeSearchDialog() {
    searchRunId += 1;
    searchDialog = { ...searchDialog, open: false, loading: false };
  }

  async function navigateToSearchDirectory(directory: { id: string; name: string }) {
    closeSearchPreview();
    closeSearchDialog();
    const ok = await loadDirectory(directory.id);
    if (ok || isDeniedDirectory(directory.id)) {
      navigationRootId = directory.id;
      navigationRootLabel = directory.name;
      navHistory = [];
    }
    if (ok) {
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
    closeSearchPreview();
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
    const folder = currentFolderId ?? ROOT_DIRECTORY_ID;
    goto(`/home/trash?folder=${encodeURIComponent(folder)}`);
  }

  function setSort(field: SortField) {
    if (sortField === field) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDirection = field === 'name' ? 'asc' : 'desc';
    }
    sortRevision += 1;
    fileTableResetKey += 1;
    directorySorter?.resort(directoryGeneration, sortRevision, sortField, sortDirection);
  }

  function sortIcon(field: SortField): IconName {
    if (sortField !== field) return 'swapVert';
    return sortDirection === 'asc' ? 'arrowUpward' : 'arrowDownward';
  }

  function applyMarqueeSelection(
    keys: Set<string>,
    baseKeys: Set<string>,
  ) {
    const folders = new Set<string>();
    const documents = new Set<string>();
    const addKey = (key: string) => {
      const item = parseFileSelectionKey(key);
      if (!item) return;
      if (item.kind === 'folder') folders.add(item.id);
      else documents.add(item.id);
    };
    for (const key of baseKeys) addKey(key);
    let lastKey: string | null = null;
    for (const key of keys) {
      addKey(key);
      lastKey = key;
    }
    commitSelection(folders, documents);
    focusedItemKey = lastKey;
    selectionAnchorKey = lastKey;
  }

  function sortFieldIcon(field: SortField): IconName {
    if (field === 'name') return 'sortByAlpha';
    if (field === 'modified') return 'calendarToday';
    return 'storage';
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
    let disposed = false;
    directorySorter = createProgressiveDirectorySorter(handleDirectorySnapshot, handleDirectorySorterError);
    const unregisterKeyboardCommands = registerKeyboardCommands([
      {
        id: 'files.find',
        label: () => $t('files.search'),
        group: () => $t('files.title'),
        shortcuts: [{ key: 'f', primary: true }],
        scope: 'page',
        enabled: () => !hasBlockingFilesDialog(),
        allowInEditable: true,
        handler: handleFindShortcut,
      },
      {
        id: 'files.parent',
        label: () => $t('files.parentDirectory'),
        group: () => $t('files.title'),
        shortcuts: [{ key: 'Backspace' }, { key: 'ArrowUp', alt: true }],
        scope: 'page',
        enabled: () => canGoToParent && !loading && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('go-parent', event),
      },
      {
        id: 'files.refresh',
        label: () => $t('common.refresh'),
        group: () => $t('files.title'),
        shortcuts: [{ key: 'F5' }, { key: 'r', primary: true }],
        scope: 'page',
        enabled: () => !loading && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('refresh', event),
      },
      {
        id: 'files.create-folder',
        label: () => $t('files.createFolder'),
        group: () => $t('files.title'),
        shortcuts: [{ key: 'n', primary: true, shift: true }],
        scope: 'page',
        enabled: () => !loading && !batchBusy && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('create-folder', event),
      },
      {
        id: 'files.select-all',
        label: () => $t('files.selectAll'),
        group: () => $t('files.title'),
        shortcuts: [{ key: 'a', primary: true }],
        scope: 'page',
        enabled: () => !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('select-all', event),
      },
      {
        id: 'files.clear-selection',
        label: () => $t('files.selectNone'),
        group: () => $t('files.title'),
        shortcuts: [{ key: 'Escape' }],
        scope: 'page',
        enabled: () => totalSelected > 0 && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('clear-selection', event),
      },
      {
        id: 'files.delete',
        label: () => $t('common.delete'),
        group: () => $t('files.title'),
        shortcuts: [{ key: 'Delete' }],
        scope: 'page',
        enabled: () => totalSelected > 0 && canDeleteSelection() && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('delete-selection', event),
      },
      {
        id: 'files.rename',
        label: () => $t('files.rename'),
        group: () => $t('files.title'),
        shortcuts: [{ key: 'F2' }],
        scope: 'page',
        enabled: () => totalSelected === 1 && canRenameSelected() && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('rename-selection', event),
      },
    ]);
    coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    try {
      marqueeSelectionEnabled = !isMobilePlatform();
    } catch {
      marqueeSelectionEnabled = !coarsePointer;
    }
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!searchPreview.open || !searchPreviewRoot || !(event.target instanceof Node)) return;
      if (!searchPreviewRoot.contains(event.target)) {
        closeSearchPreview();
      }
    };
    const handleSearchPreviewViewportChange = () => {
      if (searchPreview.open) queueSearchPreviewPanelPosition();
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    window.addEventListener('resize', handleSearchPreviewViewportChange);
    window.addEventListener('scroll', handleSearchPreviewViewportChange, true);
    listen<UploadRevisionProgressEvent>('cfms:upload-revision-progress', (event) => {
      if (disposed) return;
      uploadProgress = {
        documentId: event.payload.document_id,
        taskId: event.payload.task_id,
        currentBytes: event.payload.current_bytes,
        totalBytes: event.payload.total_bytes,
        progress: event.payload.progress,
      };
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });
    getCurrentWebview().onDragDropEvent((event) => {
      if (disposed) return;
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
      if (disposed) {
        fn();
        return;
      }
      nativeDragDropAvailable = true;
      unlistenDragDrop = fn;
    }).catch(() => {
      if (disposed) return;
      nativeDragDropAvailable = false;
      /* HTML5 drag/drop remains as a best-effort fallback. */
    });
    const initialFolder = normalizeDirectoryId(page.url.searchParams.get('folder'));
    const initialName = page.url.searchParams.get('name');
    const initialReturnNavigation = captureDirectoryNavigation();
    if (initialFolder) {
      navigationRootId = initialFolder;
      navigationRootLabel = initialName || shortIdentifier(initialFolder);
    }
    loadDirectory(initialFolder, false, initialReturnNavigation);
    reloadUserPreference();
    return () => {
      disposed = true;
      directoryGeneration = directoryLoader.invalidate();
      resolveFirstDirectorySnapshot?.(false);
      resolveFirstDirectorySnapshot = null;
      directorySorter?.dispose();
      directorySorter = null;
      nativeDragDropAvailable = false;
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      window.removeEventListener('resize', handleSearchPreviewViewportChange);
      window.removeEventListener('scroll', handleSearchPreviewViewportChange, true);
      unregisterKeyboardCommands();
      clearSearchPreviewDebounce();
      clearSearchPreviewPanelPosition();
      if (unlisten) unlisten();
      if (unlistenDragDrop) unlistenDragDrop();
    };
  });

</script>

<div
  class="files-page relative"
  role="region"
  aria-label={$t('files.title')}
  oncontextmenu={showFilesPageBlankContextMenu}
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

  <div class="files-navigation-row">
    <IconButton
      icon="arrowUpward"
      label={$t('files.parentDirectory')}
      disabled={!canGoToParent}
      onclick={handleGoToParent}
    />
    <div class="files-address-bar">
      <Breadcrumb segments={breadcrumbSegments} onNavigate={handleBreadcrumbNavigate} />
    </div>
    <span class="files-navigation-spacer" aria-hidden="true"></span>

    <!-- Search -->
    <div bind:this={searchPreviewRoot} class="files-search relative">
      <form
        class="flex gap-2"
        onsubmit={(e) => { e.preventDefault(); openSearchDialog(true); }}
      >
        <div class="relative">
          <span class="pointer-events-none absolute inset-y-0 left-3 inline-flex items-center justify-center leading-none text-md3-on-surface-variant">
            <Icon name="search" size="17px" class="shrink-0" />
          </span>
          <input
            type="text"
            class="h-9 w-48 rounded-full border border-md3-outline bg-md3-field py-1.5 pl-9 pr-9 text-sm leading-5 text-md3-on-surface
                   placeholder:text-md3-on-surface-variant
                   focus:border-transparent focus:ring-2 focus:ring-md3-primary
                   transition-all"
            placeholder={$t('files.search')}
            bind:value={searchQuery}
            bind:this={searchInput}
            onfocus={openSearchPreview}
            oninput={handleSearchInput}
            onkeydown={handleSearchKeydown}
            role="combobox"
            aria-expanded={searchPreview.open}
            aria-controls="files-search-preview-list"
            aria-label={$t('files.searchPlaceholder')}
            aria-keyshortcuts="Control+F Meta+F"
            aria-autocomplete="list"
            aria-activedescendant={searchPreview.open && searchPreviewActiveIndex >= 0
              ? `files-search-preview-option-${searchPreviewActiveIndex}`
              : undefined}
          />
          {#if searchQuery}
            <button
              type="button"
              class="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-md3-on-surface-variant transition hover:bg-md3-surface-container-high hover:text-md3-on-surface"
              aria-label={$t('common.clear')}
              onclick={() => {
                searchQuery = '';
                handleSearchInput();
              }}
            >
              <Icon name="close" size="16px" />
            </button>
          {/if}
        </div>
        <button
          type="submit"
          class="inline-flex h-9 w-9 items-center justify-center rounded-full
                 bg-md3-primary-container text-md3-on-primary-container
                 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
          title={$t('files.serverSearch')}
          aria-label={$t('files.serverSearch')}
          disabled={!searchPreviewHasQuery}
        >
          <Icon name="search" size="16px" />
        </button>
      </form>

      {#if searchPreview.open}
        <div
          id="files-search-preview-panel"
          class="search-preview-panel fixed z-40 overflow-hidden rounded-2xl border border-md3-outline bg-md3-surface-container shadow-2xl"
          style={searchPreviewPanelStyle}
        >
          <div class="border-b border-md3-outline bg-md3-surface-container-high/45 px-4 py-3">
            <div class="flex flex-wrap items-center gap-3">
              <label class="inline-flex items-center gap-1.5 text-sm text-md3-on-surface-variant">
                <MdCheckbox
                  bind:checked={searchPreview.searchDocuments}
                  ariaLabel={$t('files.searchDocuments')}
                  onChange={updateSearchPreviewOptions}
                />
                {$t('files.searchDocuments')}
              </label>
              <label class="inline-flex items-center gap-1.5 text-sm text-md3-on-surface-variant">
                <MdCheckbox
                  bind:checked={searchPreview.searchDirectories}
                  ariaLabel={$t('files.searchDirectories')}
                  onChange={updateSearchPreviewOptions}
                />
                {$t('files.searchDirectories')}
              </label>

              <span class="mx-1 hidden h-6 w-px bg-md3-outline sm:block"></span>

              <div class="relative grid grid-cols-3 overflow-hidden rounded-full border border-md3-outline bg-md3-field p-0.5" role="toolbar" tabindex="-1" aria-label={$t('workspace.sort')} onkeydown={(event) => focusRovingItem(event, event.currentTarget as HTMLElement, { selector: '[data-search-sort]', orientation: 'horizontal' })}>
                <span
                  class="search-sort-indicator absolute bottom-0.5 left-0.5 top-0.5 rounded-full bg-md3-primary"
                  style={searchSortIndicatorStyle(searchPreview.sortBy)}
                  aria-hidden="true"
                ></span>
                {#each ['name', 'size', 'modified'] as field}
                  <button
                    data-search-sort
                    tabindex={searchPreview.sortBy === field ? 0 : -1}
                    type="button"
                    class="relative z-10 min-w-16 rounded-full px-3 py-1 text-xs font-medium transition-colors {searchPreview.sortBy === field ? 'text-md3-on-primary' : 'text-md3-on-surface-variant hover:text-md3-on-surface'}"
                    aria-pressed={searchPreview.sortBy === field}
                    onclick={() => setSearchPreviewSort(field as SortField)}
                  >
                    {searchSortLabel(field as SortField)}
                  </button>
                {/each}
              </div>
              <button
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-full border border-md3-outline px-2.5 text-xs font-medium text-md3-on-surface-variant transition hover:bg-md3-surface-container-high hover:text-md3-on-surface"
                title={searchPreview.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
                onclick={toggleSearchPreviewSortOrder}
              >
                <Icon name={searchPreview.sortOrder === 'asc' ? 'arrowUpward' : 'arrowDownward'} size="16px" />
                {searchPreview.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between gap-3 px-4 py-2 text-xs font-medium uppercase text-md3-on-surface-variant">
            <span>{$t('files.searchPreviewResults')}</span>
            {#if searchPreview.loading || searchPreview.loadingMore}
              <span class="inline-flex items-center gap-2 normal-case">
                <ProgressRing size={13} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
                {$t('common.loadingEllipsis')}
              </span>
            {/if}
          </div>

          <div
            id="files-search-preview-list"
            class="search-preview-list border-y border-md3-outline/60"
            role="listbox"
            aria-label={$t('files.searchPreviewResults')}
          >
            {#if searchPreview.error}
              <p class="px-4 py-8 text-center text-sm text-md3-error">{searchPreview.error}</p>
            {:else if !searchPreviewHasQuery}
              <p class="px-4 py-8 text-center text-sm text-md3-on-surface-variant">{$t('files.searchPreviewEmpty')}</p>
            {:else if searchPreview.results && searchPreviewRows.length === 0 && !searchPreview.loading}
              <p class="px-4 py-8 text-center text-sm text-md3-on-surface-variant">
                {$t('files.searchNoResults', { values: { query: searchPreview.query } })}
              </p>
            {:else if searchPreviewRows.length > 0}
              <VirtualList
                items={searchPreviewRows}
                keyOf={(row) => row.kind === 'directory'
                  ? `preview-directory:${row.directory.id}`
                  : `preview-document:${row.document.id}`}
                estimateSize={48}
                overscan={8}
                threshold={80}
                resetKey={searchPreviewResetKey}
                viewportClass="search-preview-virtual-viewport"
                onScroll={handleSearchPreviewScroll}
              >
                {#snippet children(row, index)}
                  <button
                    id={`files-search-preview-option-${index}`}
                    type="button"
                    class="grid min-h-12 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-md3-outline/45 px-4 py-2 text-left transition-colors hover:bg-md3-primary-container/15 {searchPreviewActiveIndex === index ? 'bg-md3-primary-container/15' : ''}"
                    class:border-b-0={index === searchPreviewRows.length - 1}
                    role="option"
                    aria-selected={searchPreviewActiveIndex === index}
                    tabindex="-1"
                    onmouseenter={() => (searchPreviewActiveIndex = index)}
                    onclick={() => row.kind === 'directory'
                      ? navigateToSearchDirectory(row.directory)
                      : navigateToSearchDocument(row.document)}
                  >
                    <span class={row.kind === 'directory' ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}>
                      <Icon name={row.kind === 'directory' ? 'folder' : 'filePresent'} size="20px" />
                    </span>
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium {row.kind === 'directory' ? 'text-md3-primary-emphasis' : 'text-md3-on-surface'}">
                        {row.kind === 'directory' ? row.directory.name : (row.document.name ?? row.document.title)}
                      </span>
                      <span class="block truncate text-xs text-md3-on-surface-variant">
                        {row.kind === 'directory' ? $t('files.searchDirectories') : formatBytes(row.document.size)}
                      </span>
                    </span>
                    <span class="text-xs text-md3-on-surface-variant">{searchResultDate(row)}</span>
                  </button>
                {/snippet}
              </VirtualList>
            {:else if searchPreview.loading}
              <div class="flex items-center justify-center gap-2 px-4 py-8 text-sm text-md3-on-surface-variant">
                <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
                {$t('common.loadingEllipsis')}
              </div>
            {/if}
          </div>

          <div class="flex items-center justify-between gap-3 px-4 py-3">
            <button
              type="button"
              class="text-sm font-semibold text-md3-primary-emphasis transition hover:brightness-125 disabled:opacity-50"
              disabled={!searchPreviewCanSearch}
              onclick={() => openSearchDialog(true)}
            >
              {$t('files.advancedSearch')}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold text-md3-primary-emphasis transition hover:bg-md3-primary-container/20 disabled:opacity-50"
              disabled={!searchPreviewCanSearch}
              onclick={() => openSearchDialog(true)}
            >
              <Icon name="search" size="16px" />
              {$t('files.allResults')}
            </button>
          </div>
        </div>
      {/if}
    </div>

    <IconButton icon="refresh" label={$t('common.refresh')} onclick={() => loadDirectory(currentFolderId)} />
  </div>

  <div class="files-command-row">
    <div class="files-primary-actions">
      <ExplorerCommandBar actions={fileCommandActions} ariaLabel={$t('workspace.commandBar')} />
    </div>
    <div
      class="files-sort-actions"
      role="toolbar"
      tabindex="-1"
      aria-label={$t('workspace.sort')}
      onkeydown={(event) => focusRovingItem(event, event.currentTarget as HTMLElement, {
        selector: '[data-sort-item]',
        orientation: 'horizontal',
      })}
    >
      {#each SORT_FIELDS as field}
        <button
          data-sort-item
          type="button"
          class="explorer-command-button explorer-command-button--compact files-sort-button"
          data-active={sortField === field ? 'true' : undefined}
          title={sortTitle(field as SortField)}
          aria-label={sortTitle(field as SortField)}
          aria-pressed={sortField === field}
          tabindex={sortField === field ? 0 : -1}
          onclick={() => setSort(field as SortField)}
        >
          <Icon name={sortFieldIcon(field)} size="17px" />
          {#if sortField === field}
            <span class="files-sort-direction" aria-hidden="true">
              <Icon name={sortDirection === 'asc' ? 'arrowUpward' : 'arrowDownward'} size="10px" />
            </span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <div class="files-content-row">
    {#snippet deniedDirectoryContent()}
      <AccessDeniedNotice
        title={$t('files.directoryAccessDeniedTitle')}
        description={$t('files.directoryAccessDeniedDescription')}
        actionLabel={$t('files.returnToPreviousDirectory')}
        onAction={handleReturnFromDeniedDirectory}
      />
    {/snippet}
    <FileTable
      bind:this={fileTable}
      {loading}
      {folders}
      {documents}
      resetKey={fileTableResetKey}
      marqueeEnabled={marqueeSelectionEnabled}
      {selectMode}
      {selectedFolderIds}
      {selectedDocumentIds}
      {sortTitle}
      {sortIcon}
      onSort={setSort}
      onMarqueeSelection={applyMarqueeSelection}
      onFolderClick={handleFolderClick}
      onDocumentClick={handleDocumentClick}
      onFolderActivate={handleFolderActivate}
      onDocumentActivate={handleDocumentActivate}
      onRowKeydown={handleFileRowKeydown}
      onBlankClick={deselectAll}
      onBlankContextMenu={showCurrentDirectoryContextMenu}
      onFolderContextMenu={showFolderContextMenu}
      onDocumentContextMenu={showDocumentContextMenu}
      emptyContent={directoryAccessDenied ? deniedDirectoryContent : undefined}
    />
    <ExplorerDetailsPane
      open={detailsOpen}
      model={detailModel}
      emptyTitle={$t('files.properties')}
      emptyLabel={$t('workspace.selectForDetails')}
      closeLabel={$t('workspace.closeDetails')}
      onClose={() => (detailsOpen = false)}
    />
  </div>

  <ExplorerStatusBar
    primary={statusBarPrimary}
    secondary={statusBarSecondary}
    tone={directoryLoadPhase === 'partial-error' ? 'danger' : 'default'}
    actionLabel={directoryLoadPhase === 'partial-error' && directoryNextCursor ? $t('workspace.continueLoading') : ''}
    onAction={retryDirectoryLoad}
  />
</div>

<style>
  .files-page {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    color: var(--explorer-text);
    background: var(--explorer-background);
  }

  .files-navigation-row {
    position: relative;
    z-index: 24;
    display: flex;
    min-height: 58px;
    align-items: center;
    gap: 0.45rem;
    border-bottom: 1px solid var(--explorer-border);
    padding: 0.55rem 0.7rem;
    background: var(--explorer-surface-raised);
  }

  .files-address-bar {
    display: flex;
    min-width: 180px;
    width: fit-content;
    flex: 0 1 auto;
    align-items: center;
    min-height: 36px;
    overflow-x: auto;
    border: 1px solid var(--explorer-border);
    border-radius: var(--explorer-radius-small);
    padding: 0.35rem 0.7rem;
    background: var(--explorer-surface);
  }

  .files-navigation-spacer {
    min-width: 0;
    flex: 1 1 0;
  }

  .files-search {
    flex: none;
  }

  .files-navigation-row :global(.md-icon-button) {
    border-radius: var(--explorer-radius-small);
    color: var(--explorer-text-muted);
  }

  .files-navigation-row :global(input) {
    width: min(260px, 22vw);
    border-color: var(--explorer-border) !important;
    border-radius: var(--explorer-radius-small) !important;
    color: var(--explorer-text) !important;
    background: var(--explorer-surface) !important;
  }

  .files-command-row {
    position: relative;
    z-index: 20;
    display: flex;
    min-height: 48px;
    align-items: center;
    gap: 0.7rem;
    overflow: hidden;
    border-bottom: 1px solid var(--explorer-border);
    padding: 0.35rem 0.7rem;
    background: var(--explorer-surface);
  }

  .files-primary-actions {
    display: flex;
    min-width: 34px;
    flex: 1;
    overflow: hidden;
  }

  .files-sort-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.1rem;
    margin-left: auto;
    overflow: hidden;
    white-space: nowrap;
  }

  .files-sort-button {
    position: relative;
    width: 34px;
    height: 34px;
    flex: none;
    overflow: hidden;
    padding: 0;
    white-space: nowrap;
  }

  .files-sort-direction {
    position: absolute;
    right: 1px;
    bottom: 1px;
    display: grid;
    width: 13px;
    height: 13px;
    place-items: center;
    border-radius: 999px;
    color: var(--explorer-accent);
    background: var(--explorer-surface-raised);
    pointer-events: none;
  }

  .files-content-row {
    display: flex;
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }

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

    .search-preview-panel {
      animation: none;
    }
  }

  :global(.server-search-list-viewport) {
    max-height: calc(52vh - 2.25rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  :global(.search-preview-virtual-viewport) {
    max-height: 360px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .search-preview-panel {
    background:
      linear-gradient(145deg, rgba(31, 41, 55, 0.98) 0%, rgba(20, 29, 43, 0.98) 56%, rgba(15, 23, 42, 0.98) 100%);
    border-color: rgba(99, 102, 241, 0.22);
    box-shadow:
      0 24px 72px rgba(0, 0, 0, 0.38),
      0 0 0 1px rgba(148, 163, 184, 0.06) inset;
    animation: search-preview-in 180ms var(--motion-easing-emphasized-decelerate) both;
    backdrop-filter: blur(18px);
  }

  .search-sort-indicator {
    transition: transform var(--motion-duration-medium1) var(--motion-easing-emphasized-decelerate);
  }

  @keyframes search-preview-in {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.985);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (max-width: 720px) {
    .files-navigation-row {
      min-height: 52px;
      flex-wrap: nowrap;
      padding: 0.4rem;
    }

    .files-address-bar {
      min-width: 0;
      width: auto;
      max-width: none;
      flex: 1 1 auto;
      padding-inline: 0.45rem;
    }

    .files-navigation-spacer {
      display: none;
    }

    .files-command-row {
      min-height: 44px;
      padding-inline: 0.4rem;
    }
  }
</style>

<ContextMenu
  open={contextMenu.open}
  x={contextMenu.x}
  y={contextMenu.y}
  items={contextMenuItems}
  userPermissions={authStore.permissions}
  sourceElement={contextMenu.sourceElement}
  onClose={hideContextMenu}
/>

{#if documentAccessDenied}
  <AccessDeniedDialog
    documentName={documentAccessDenied.name}
    documentId={documentAccessDenied.id}
    accessedAt={documentAccessDenied.accessedAt}
    onClose={() => (documentAccessDenied = null)}
  />
{/if}

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
          bind:this={searchDialogInput}
          placeholder={$t('files.searchPlaceholder')}
          disabled={searchDialog.loading}
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
        <label class="flex items-center gap-2">
          <MdCheckbox
            bind:checked={searchDialog.searchDocuments}
            ariaLabel={$t('files.searchDocuments')}
            disabled={searchDialog.loading}
          />
          {$t('files.searchDocuments')}
        </label>
        <label class="flex items-center gap-2">
          <MdCheckbox
            bind:checked={searchDialog.searchDirectories}
            ariaLabel={$t('files.searchDirectories')}
            disabled={searchDialog.loading}
          />
          {$t('files.searchDirectories')}
        </label>

        <div class="relative grid grid-cols-3 overflow-hidden rounded-full border border-md3-outline bg-md3-field p-0.5" role="toolbar" tabindex="-1" aria-label={$t('workspace.sort')} onkeydown={(event) => focusRovingItem(event, event.currentTarget as HTMLElement, { selector: '[data-search-sort]', orientation: 'horizontal' })}>
          <span
            class="search-sort-indicator absolute bottom-0.5 left-0.5 top-0.5 rounded-full bg-md3-primary"
            style={searchSortIndicatorStyle(searchDialog.sortBy)}
            aria-hidden="true"
          ></span>
          {#each ['name', 'size', 'modified'] as field}
            <button
              data-search-sort
              tabindex={searchDialog.sortBy === field ? 0 : -1}
              type="button"
              class="relative z-10 min-w-16 rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 {searchDialog.sortBy === field ? 'text-md3-on-primary' : 'text-md3-on-surface-variant hover:text-md3-on-surface'}"
              aria-pressed={searchDialog.sortBy === field}
              disabled={searchDialog.loading}
              onclick={() => setSearchDialogSort(field as SortField)}
            >
              {searchSortLabel(field as SortField)}
            </button>
          {/each}
        </div>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1 rounded-full border border-md3-outline px-2.5 text-xs font-medium text-md3-on-surface-variant transition hover:bg-md3-surface-container-high hover:text-md3-on-surface disabled:opacity-50"
          disabled={searchDialog.loading}
          title={searchDialog.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
          onclick={toggleSearchDialogSortOrder}
        >
          <Icon name={searchDialog.sortOrder === 'asc' ? 'arrowUpward' : 'arrowDownward'} size="16px" />
          {searchDialog.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
        </button>
      </div>

      {#if searchDialog.results}
        <div class="max-h-[52vh] overflow-auto rounded-lg border border-md3-outline">
          <div class="flex items-center justify-between gap-3 border-b border-md3-outline bg-md3-surface-container-high/50 px-3 py-2 text-xs font-medium uppercase text-md3-on-surface-variant">
            <span>
              {searchDialog.results.total_count === 0 && !searchDialog.loading
                ? $t('files.searchNoResults', { values: { query: searchDialog.resultQuery } })
                : $t('files.searchResultCount', { values: { count: searchDialog.results.total_count, query: searchDialog.resultQuery } })}
            </span>
            {#if searchDialog.loading}
              <span class="inline-flex shrink-0 items-center gap-2">
                <ProgressRing size={14} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
                {$t('common.loadingEllipsis')}
              </span>
            {/if}
          </div>
          <VirtualList
            items={searchResultRows}
            keyOf={(row) => row.kind === 'directory'
              ? `directory:${row.directory.id}`
              : `document:${row.document.id}`}
            estimateSize={37}
            overscan={10}
            threshold={120}
            resetKey={searchDialogResetKey}
            viewportClass="server-search-list-viewport"
            keyboardNavigation
            keyboardTargetSelector="button"
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
      {:else if searchDialog.loading}
        <div class="flex items-center gap-2 py-6 text-sm text-md3-on-surface-variant">
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {$t('common.loadingEllipsis')}
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
                    <button
                      class="rounded-full p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-error-container hover:text-md3-on-error-container"
                      title={$t('files.deleteRevision')}
                      onclick={() => handleDeleteRevision(row.revision)}
                    >
                      <Icon name="delete" size="18px" />
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
