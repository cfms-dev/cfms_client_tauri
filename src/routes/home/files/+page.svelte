<script lang="ts">
  import FluentButton from '$lib/components/FluentButton.svelte';
  // File Manager page
  //
  // Browses files and folders on the CFMS server via the `list_directory`
  // and `get_document` actions sent over the active WSS connection.
  //
  // Reference: get_directory / get_document in reference/src/include/ui/util/path.py

  import { onMount, tick, untrack } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
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
    resolveNodePath,
    revokeAccess,
    setAccessRules,
    setCurrentRevision,
    setDocumentTags,
    searchFiles,
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
    type UploadEnqueueRequest,
    type UploadTaskDto,
    type UserPreference,
  } from '$lib/api';
  import type {
    ServerDirectoryEntry,
    ServerDocumentEntry,
    ServerObjectType,
  } from '$lib/api';
  import FileAddressBar from '$lib/components/FileAddressBar.svelte';
  import AccessDeniedDialog from '$lib/components/AccessDeniedDialog.svelte';
  import AccessDeniedNotice from '$lib/components/AccessDeniedNotice.svelte';
  import AuthorizeAccessDialog from '$lib/components/AuthorizeAccessDialog.svelte';
  import AccessRulesManager from '$lib/components/AccessRulesManager.svelte';
  import BatchAccessRulesDialog from '$lib/components/BatchAccessRulesDialog.svelte';
  import { batchRulesSessionProblem, type BatchRulesIdentity, type BatchRulesTarget } from '$lib/files/batch-access-rules';
  import { accessRulesTemplateKey } from '$lib/files/access-rules-edit';
  import ContextMenu from '$lib/components/ContextMenu.svelte';
  import {
    beginDownloadBatch,
    finishDownloadBatch,
    addDiscoveredDownloadBatchItems,
    isDownloadBatchStop,
    markDownloadBatchFailed,
    markDownloadBatchQueued,
    setDownloadBatchRateLimitWaiting,
    setDownloadBatchPhase,
    waitForDownloadBatchResume,
  } from '$lib/download-batch-control';
  import FileTable, {
    type FileTableDragItems,
    type FileTableRow,
    type FileTableViewportAnchor,
  } from '$lib/components/files/FileTable.svelte';
  import ExplorerCommandBar from '$lib/components/explorer/ExplorerCommandBar.svelte';
  import ExplorerNavigationBar from '$lib/components/explorer/ExplorerNavigationBar.svelte';
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
  import { graphWidth, laneX, buildRevisionRows } from '$lib/files/revision-graph';
  import {
    fileManagerNavigationStore,
    recordDirectoryVisit,
    resolveDirectoryVisit,
    directoryHistoryTarget,
    type DirectoryNavigationTimeline,
    type DirectoryNavigationSnapshot,
  } from '$lib/files/file-manager-navigation';
  import type { SortDirection, SortField } from '$lib/files/sorting';
  import {
    createProgressiveDirectorySorter,
    type ProgressiveDirectorySorter,
    type ProgressiveSortSnapshot,
  } from '$lib/files/sort-worker-client';
  import { DIRECTORY_PAGE_SIZE } from '$lib/files/progressive-listing';
  import {
    DirectoryLoadController,
    DirectoryRequestTimeoutError,
  } from '$lib/files/directory-load-controller';
  import { canSearchFiles } from '$lib/files/search-permissions';
  import { isAccessDeniedError, serverAvailability, serverErrorStatus } from '$lib/api/server-errors';
  import {
    FILE_SHORTCUTS,
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
  import {
    classifyNodePathTerminal,
    decodeResolvedNodePath,
    knownAbsoluteNodePath,
    type ResolvedNodePathSegment,
  } from '$lib/files/node-path';
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
  const MAX_BATCH_RATE_LIMIT_RETRIES = 3;

  type DirectoryLoadPhase = 'idle' | 'initial-loading' | 'loading-more' | 'complete' | 'partial-error';

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
  const searchCoarsePointer = new MediaQuery('(pointer: coarse)', false);
  const searchRowHeight = $derived(searchCoarsePointer.current ? 48 : 40);
  let searchPreviewRoot = $state<HTMLDivElement | null>(null);
  let searchPreviewPanelStyle = $state('');
  let navigationRootId = $state<string | null>(null);
  let navigationRootLabel = $state<string | null>(null);
  let navigationStateReady = $state(false);
  let navigationScope = $state<FilePreferenceScope | null>(null);
  let navigationTimeline = $state<DirectoryNavigationTimeline>({ entries: [], cursor: -1 });
  let navigationBusy = $state(false);
  let userPreference = $state<UserPreference | null>(null);
  let batchBusy = $state(false);
  let dropMoveBusy = $state(false);

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
    revealRow: (selectionKey: string, focus?: boolean) => Promise<boolean>;
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
  let addressBar = $state<{
    beginEdit: () => Promise<void>;
    finishEdit: () => void;
  } | null>(null);
  let addressLookupBusy = $state(false);
  let addressLookupError = $state<string | null>(null);
  let addressLookupRunId = 0;
  let pendingAddressDocument = $state<{
    id: string;
    label: string;
    parentId: string | null;
  } | null>(null);

  // Context menu state
  let contextMenu = $state<{
    open: boolean;
    x: number;
    y: number;
    kind: 'folder' | 'document' | 'selection' | 'current-directory' | null;
    item: ServerDirectoryEntry | ServerDocumentEntry | null;
    targetKey?: string;
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
  let batchAccessRulesDialog = $state<{
    targets: BatchRulesTarget[];
    identity: BatchRulesIdentity;
    initialTemplateKey: string;
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
  let searchDeniedByServer = $state(false);
  let previousPermissionSnapshotRevision = -1;
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

  function applyDirectoryNavigation(snapshot: DirectoryNavigationSnapshot) {
    currentFolderId = snapshot.folderId;
    navigationRootId = snapshot.navigationRootId;
    navigationRootLabel = snapshot.navigationRootLabel;
    navHistory = snapshot.navHistory.map((entry) => ({ ...entry }));
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
  const nodeLookupEnabled = $derived(
    serverStateStore.extensionFlags.includes('node_lookup'),
  );
  const knownAddressPath = $derived(
    knownAbsoluteNodePath(
      navigationRootId,
      breadcrumbSegments.map((segment) => segment.label),
    ),
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
  const revisionGraphWidth = $derived(
    revisionRows.reduce((width, row) => Math.max(width, graphWidth(row)), 40),
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
  const directorySearchPlaceholder = $derived(
    $t('files.directorySearchPlaceholder', { values: { directory: currentDirectoryName() } }),
  );
  const hasSearchPermission = $derived(canSearchFiles(authStore.permissions));
  const canUseServerSearch = $derived(hasSearchPermission && !searchDeniedByServer);
  const searchPreviewCanSearch = $derived(
    canUseServerSearch
      && searchPreviewHasQuery
      && (searchPreview.searchDocuments || searchPreview.searchDirectories),
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
  let queuedUploadCount = $state(0);
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

  $effect(() => {
    const allowedBySnapshot = hasSearchPermission;
    const snapshotRevision = authStore.permissionSnapshotRevision;
    const deniedByServer = searchDeniedByServer;

    untrack(() => {
      if (allowedBySnapshot && snapshotRevision !== previousPermissionSnapshotRevision) {
        searchDeniedByServer = false;
      }
      previousPermissionSnapshotRevision = snapshotRevision;

      if (allowedBySnapshot && !deniedByServer) return;
      clearSearchPreviewDebounce();
      clearSearchPreviewPanelPosition();
      searchPreviewRunId += 1;
      searchRunId += 1;
      searchPreview = {
        ...searchPreview,
        open: false,
        loading: false,
        loadingMore: false,
        results: null,
      };
      searchDialog = { ...searchDialog, open: false, loading: false };
      searchPreviewActiveIndex = -1;
    });
  });

  $effect(() => {
    if (!navigationStateReady || !navigationScope) return;
    fileManagerNavigationStore.rememberTimeline(
      navigationScope.serverAddress,
      navigationScope.username,
      navigationTimeline,
    );
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
    void revealPendingAddressDocument(snapshot.complete);
  }

  function handleDirectorySorterError(sortError: unknown) {
    directoryLoadError = formatDirectoryLoadError(sortError);
    directoryLoadPhase = 'partial-error';
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
    if (directoryLoadPhase !== 'partial-error') return;
    directoryLoadError = null;
    if (directoryNextCursor && directoryLoadedCount > 0) {
      void continueDirectoryLoad(directoryGeneration, directoryNextCursor);
      return;
    }
    void loadDirectory(
      currentFolderId,
      true,
      activeDirectoryReturnNavigation ?? undefined,
    );
  }

  function formatDirectoryLoadError(loadError: unknown) {
    return loadError instanceof DirectoryRequestTimeoutError
      ? $t('workspace.directoryRequestTimedOut')
      : formatError(loadError);
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
    surfaceAccessDenied = true,
  ): Promise<boolean> {
    if (!directorySorter) return false;
    resolveFirstDirectorySnapshot?.(false);
    resolveFirstDirectorySnapshot = null;
    pendingAddressDocument = null;
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
      directoryNextCursor = resp.next_cursor;
      const firstSnapshot = new Promise<boolean>((resolve) => {
        firstDirectorySnapshotGeneration = generation;
        resolveFirstDirectorySnapshot = resolve;
      });
      directorySorter?.append(generation, revision, resp.folders, resp.documents, !resp.has_more);
      const firstVisible = await firstSnapshot;
      if (!firstVisible || generation !== directoryGeneration) return false;
      currentFolderId = normalizedFolderId;
      parentId = normalizeDirectoryId(resp.parent_id);
      if (resp.has_more) {
        if (!resp.next_cursor) throw new Error('Directory page reported more items without a cursor.');
        void continueDirectoryLoad(generation, resp.next_cursor);
      }
      return true;
    } catch (e) {
      if (generation !== directoryGeneration) return false;
      directoryLoadError = formatDirectoryLoadError(e);
      directoryLoadPhase = 'partial-error';
      if (surfaceAccessDenied && isAccessDeniedError(e)) {
        showDirectoryAccessDenied(normalizedFolderId, deniedReturnNavigation);
      } else {
        error = directoryLoadError;
      }
      if (!preserveOnError && !directoryAccessDenied) {
        folders = [];
        documents = [];
        parentId = null;
      }
      return false;
    } finally {
      if (generation === directoryGeneration && directoryLoadPhase !== 'initial-loading') loading = false;
    }
  }

  // --- Navigation ---

  const navigationUnavailable = $derived(navigationBusy || addressLookupBusy || directoryLoadPhase === 'initial-loading');
  const canGoBack = $derived(navigationTimeline.cursor > 0);
  const canGoForward = $derived(navigationTimeline.cursor + 1 < navigationTimeline.entries.length);

  // All location changes commit their breadcrumb and timeline together. Reloads
  // remain loadDirectory calls, so file operations never create history entries.
  async function navigateDirectory(snapshot: DirectoryNavigationSnapshot, historyCursor?: number): Promise<boolean> {
    if (navigationBusy) return false;
    navigationBusy = true;
    closeSearchPreview();
    const previous = captureDirectoryNavigation();
    try {
      const request = loadDirectory(snapshot.folderId, true, previous);
      const generation = directoryGeneration;
      const visit = await resolveDirectoryVisit(
        navigationTimeline, snapshot,
        async () => await request ? 'loaded' : isDeniedDirectory(snapshot.folderId) ? 'denied' : 'failed',
        () => generation === directoryGeneration,
        historyCursor,
      );
      if (!visit) {
        if (generation === directoryGeneration) applyDirectoryNavigation(previous);
        return false;
      }
      applyDirectoryNavigation(visit.snapshot);
      navigationTimeline = visit.timeline;
      return visit.loaded;
    } finally {
      navigationBusy = false;
    }
  }

  async function handleHistoryNavigate(direction: -1 | 1) {
    if (navigationUnavailable) return;
    const target = directoryHistoryTarget(navigationTimeline, direction);
    if (target) await navigateDirectory(target.snapshot, target.cursor);
  }

  function handleAddressBeginEdit() {
    addressLookupError = null;
  }

  function handleAddressCancel() {
    addressLookupRunId += 1;
    addressLookupBusy = false;
    addressLookupError = null;
  }

  function formatAddressLookupError(lookupError: unknown): string {
    const statusCode = serverErrorStatus(lookupError);
    if (statusCode === 400) return $t('files.addressInvalid');
    if (statusCode === 403 || statusCode === 404) return $t('files.addressUnavailable');
    return $t('files.addressRequestFailed');
  }

  function resolvedDirectoryHistory(segments: readonly ResolvedNodePathSegment[]) {
    return segments.map((segment) => ({ label: segment.label, id: segment.id }));
  }

  async function revealPendingAddressDocument(directoryComplete: boolean) {
    const pending = pendingAddressDocument;
    if (!pending || !sameDirectoryId(currentFolderId, pending.parentId)) return;
    if (!fileListIndex.documentById.has(pending.id)) {
      if (directoryComplete) {
        pendingAddressDocument = null;
        notificationStore.warning($t('files.addressDocumentChanged', {
          values: { name: pending.label },
        }), 5000);
      }
      return;
    }

    pendingAddressDocument = null;
    const selectionKey = fileSelectionKey('document', pending.id);
    commitSelection(new Set(), new Set([pending.id]));
    focusedItemKey = selectionKey;
    selectionAnchorKey = selectionKey;
    await tick();
    await fileTable?.revealRow(selectionKey, true);
    status = $t('files.addressDocumentLocated', { values: { name: pending.label } });
  }

  async function handleAddressSubmit(rawPath: string) {
    if (navigationUnavailable) return;
    const path = rawPath.trim();
    if (!path) {
      addressLookupError = $t('files.addressRequired');
      return;
    }

    const runId = ++addressLookupRunId;
    addressLookupBusy = true;
    addressLookupError = null;
    try {
      const response = await resolveNodePath(path);
      if (runId !== addressLookupRunId) return;
      const resolvedSegments = decodeResolvedNodePath(path, response.node_ids);

      if (resolvedSegments.length === 0) {
        const ok = await navigateDirectory({ folderId: null, navigationRootId: null, navigationRootLabel: null, navHistory: [] });
        if (runId !== addressLookupRunId) return;
        if (!ok && !isDeniedDirectory(null)) {
          error = null;
          addressLookupError = $t('files.addressRequestFailed');
          return;
        }
        addressBar?.finishEdit();
        if (ok) status = $t('files.addressDirectoryOpened');
        return;
      }

      const terminal = resolvedSegments[resolvedSegments.length - 1];
      const expectedParentId = normalizeDirectoryId(response.node_ids.at(-2) ?? null);
      const target = await classifyNodePathTerminal({
        terminal,
        expectedParentId,
        getDirectoryInfo,
        getDocumentInfo,
        errorStatus: serverErrorStatus,
      });
      if (runId !== addressLookupRunId) return;

      if (target.kind === 'directory') {
        const ok = await navigateDirectory({
          folderId: terminal.id, navigationRootId: null, navigationRootLabel: null,
          navHistory: resolvedDirectoryHistory(resolvedSegments),
        });
        if (runId !== addressLookupRunId) return;
        if (!ok && !isDeniedDirectory(terminal.id)) {
          error = null;
          addressLookupError = $t('files.addressRequestFailed');
          return;
        }
        addressBar?.finishEdit();
        if (ok) status = $t('files.addressDirectoryOpened');
        return;
      }

      const ok = await navigateDirectory({
        folderId: expectedParentId, navigationRootId: null, navigationRootLabel: null,
        navHistory: resolvedDirectoryHistory(resolvedSegments.slice(0, -1)),
      });
      if (runId !== addressLookupRunId) return;
      if (!ok && !isDeniedDirectory(expectedParentId)) {
        error = null;
        addressLookupError = $t('files.addressRequestFailed');
        return;
      }
      if (!ok) {
        addressBar?.finishEdit();
        return;
      }
      pendingAddressDocument = {
        id: target.id,
        label: target.label,
        parentId: expectedParentId,
      };
      addressBar?.finishEdit();
      await revealPendingAddressDocument(directoryLoadPhase === 'complete');
    } catch (lookupError) {
      if (runId !== addressLookupRunId) return;
      addressLookupError = formatAddressLookupError(lookupError);
    } finally {
      if (runId === addressLookupRunId) addressLookupBusy = false;
    }
  }

  async function handleNavigate(folderId: string, folderName: string) {
    if (navigationUnavailable) return;
    const previousFolderId = currentFolderId;
    const ok = await navigateDirectory({
      ...captureDirectoryNavigation(),
      folderId,
      navHistory: [...navHistory, { label: folderName, id: folderId }],
    });
    if (ok) {
      await rememberVisit(currentFilePreferenceScope(), {
        type: 'directory', id: folderId, name: folderName, parentId: previousFolderId,
      });
    }
  }

  async function handleBreadcrumbNavigate(targetId: string) {
    if (navigationUnavailable) return;
    if (targetId === ROOT_DIRECTORY_ID) {
      await navigateDirectory({ folderId: null, navigationRootId: null, navigationRootLabel: null, navHistory: [] });
      return;
    }
    const idx = navHistory.findIndex((entry) => entry.id === targetId);
    await navigateDirectory({
      ...captureDirectoryNavigation(),
      folderId: targetId,
      navHistory: sameDirectoryId(targetId, navigationRootId) ? [] : idx >= 0 ? navHistory.slice(0, idx + 1) : navHistory,
    });
  }

  async function handleGoToParent() {
    if (navigationUnavailable) return;
    if (directoryAccessDenied) {
      await handleReturnFromDeniedDirectory();
      return;
    }
    if (parentTargetId === undefined) return;
    await navigateDirectory({ ...captureDirectoryNavigation(), folderId: parentTargetId, navHistory: navHistory.slice(0, -1) });
  }

  async function handleReturnFromDeniedDirectory() {
    if (directoryAccessDenied) await navigateDirectory(directoryAccessDenied.returnNavigation);
  }

  async function handleJumpToDirectory() {
    if (navigationUnavailable) return;
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
    const ok = await navigateDirectory({
      folderId: target, navigationRootId: target,
      navigationRootLabel: target === null ? null : shortIdentifier(target), navHistory: [],
    });
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

  function handleDragSelection(items: FileTableDragItems) {
    const nextFolders = new Set(items.folderIds);
    const nextDocuments = new Set(items.documentIds);
    commitSelection(nextFolders, nextDocuments);
    focusedItemKey = items.folderIds[0]
      ? fileSelectionKey('folder', items.folderIds[0])
      : items.documentIds[0]
        ? fileSelectionKey('document', items.documentIds[0])
        : null;
    selectionAnchorKey = focusedItemKey;
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
      id: 'access-rules-selected',
      label: $t('files.setPermissions'),
      icon: 'settings',
      visible: totalSelected > 1 || !!selectedFolder,
      disabled: batchBusy || loading || !hasPermission('set_access_rules'),
      run: handleBatchAccessRules,
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

    if (event.key === FILE_SHORTCUTS.activate[0].key) {
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
      if (canGoToParent && !navigationUnavailable) void handleGoToParent();
    } else if (shortcut === 'refresh') {
      event.preventDefault();
      if (!navigationUnavailable) void loadDirectory(currentFolderId, true);
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
      contextMenu = { open: true, ...anchor, kind: 'selection', item: null, targetKey: `folder:${folder.id}` };
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
      contextMenu = { open: true, ...anchor, kind: 'selection', item: null, targetKey: `document:${doc.id}` };
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
    deselectAll();
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
      // ContextMenu closes before invoking the action, so capture its target now.
      const targetKey = contextMenu.targetKey ?? null;
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
        {
          id: 'access-rules-selection',
          label: $t('files.setPermissions'),
          icon: 'settings',
          disabled: batchBusy || loading,
          requiredPermissions: ['set_access_rules'],
          onSelect: () => handleBatchAccessRules(targetKey),
        },
        { type: 'divider' },
        {
          id: 'delete-selection',
          shortcuts: FILE_SHORTCUTS.delete,
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
          shortcuts: FILE_SHORTCUTS.refresh,
          label: $t('common.refresh'),
          icon: 'refresh',
          onSelect: async () => {
            await loadDirectory(currentFolderId);
          },
        },
        { type: 'divider' },
        {
          id: 'create-directory-here',
          shortcuts: FILE_SHORTCUTS.createFolder,
          label: $t('files.createFolder'),
          icon: 'createNewFolder',
          onSelect: handleCreateFolder,
        },
        {
          id: 'upload-folder-here',
          label: $t('files.uploadFolder'),
          icon: 'folderUpload',
          onSelect: handleUploadFolder,
        },
        {
          id: 'upload-files-here',
          label: $t('files.uploadFiles'),
          icon: 'uploadFile',
          onSelect: handleUploadFiles,
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
          shortcuts: FILE_SHORTCUTS.activate,
          label: $t('common.download'),
          icon: 'download',
          onSelect: () => handleDownload(doc),
        },
        {
          id: 'favorite-document',
          label: favorite ? $t('files.removeFavorite') : $t('files.addFavorite'),
          icon: favorite ? 'star' : 'starOutline',
          iconFilled: favorite,
          onSelect: () => handleToggleFavorite(record, !favorite),
        },
        { type: 'divider' },
        {
          id: 'rename-document',
          shortcuts: FILE_SHORTCUTS.rename,
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
          shortcuts: FILE_SHORTCUTS.delete,
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
        shortcuts: FILE_SHORTCUTS.activate,
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
        iconFilled: favorite,
        onSelect: () => handleToggleFavorite(record, !favorite),
      },
      { type: 'divider' },
      {
        id: 'rename-folder',
        shortcuts: FILE_SHORTCUTS.rename,
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
        shortcuts: FILE_SHORTCUTS.delete,
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
      await moveFileItems({
        folderIds: dialog.objectType === 'directory' ? [dialog.objectId] : [],
        documentIds: dialog.objectType === 'document' ? [dialog.objectId] : [],
      }, target);
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
      await moveFileItems({ folderIds: selectedFolders, documentIds: selectedDocuments }, target);
      batchMoveDialog = null;
      clearSelection();
      status = $t('files.batchMoved', { values: { count: selectedDocuments.length + selectedFolders.length } });
      await loadDirectory(currentFolderId);
    } catch (err) {
      error = formatError(err);
      batchMoveDialog = { excludedDirectoryIds: selectedFolders, saving: false };
    }
  }

  async function moveFileItems(items: FileTableDragItems, targetFolderId: string | null) {
    for (const id of items.documentIds) await moveDocument(id, targetFolderId);
    for (const id of items.folderIds) await moveDirectory(id, targetFolderId);
  }

  async function handleDropMove(items: FileTableDragItems, targetFolderId: string) {
    if (
      dropMoveBusy
      || !hasPermission('move')
      || items.folderIds.includes(targetFolderId)
      || items.folderIds.length + items.documentIds.length === 0
    ) return;

    dropMoveBusy = true;
    error = null;
    try {
      await moveFileItems(items, targetFolderId);
      const movedCount = items.folderIds.length + items.documentIds.length;
      clearSelection();
      status = movedCount === 1
        ? $t('files.moved')
        : $t('files.batchMoved', { values: { count: movedCount } });
      await loadDirectory(currentFolderId);
    } catch (err) {
      const accessDenied = isAccessDeniedError(err);
      // Reload because an earlier item in a multi-item move may have succeeded.
      await loadDirectory(currentFolderId, true);
      if (!accessDenied) error = formatError(err);
    } finally {
      dropMoveBusy = false;
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

  function handleBatchAccessRules(contextItemKey: string | null = null) {
    if (totalSelected < 2 && !selectedFolder) return;
    const targets: BatchRulesTarget[] = [
      ...[...selectedFolderIds].map((objectId) => ({
        objectType: 'directory' as const,
        objectId,
        name: fileListIndex.folderById.get(objectId)?.name ?? objectId,
      })),
      ...[...selectedDocumentIds].map((objectId) => ({
        objectType: 'document' as const,
        objectId,
        name: fileListIndex.documentById.get(objectId)?.title ?? objectId,
      })),
    ];
    openBatchAccessRules(targets, contextItemKey);
  }

  function openBatchAccessRules(targets: BatchRulesTarget[], contextItemKey: string | null = null) {
    if (!targets.length || batchBusy || loading || !hasPermission('set_access_rules')) return;
    batchAccessRulesDialog = {
      targets,
      identity: { server: serverStateStore.remoteAddress, username: authStore.username },
      initialTemplateKey: accessRulesTemplateKey(targets, focusedItemKey, contextItemKey),
    };
    batchBusy = true;
  }

  function batchAccessRulesGuard() {
    if (!batchAccessRulesDialog) return { kind: 'stopped' as const };
    return batchRulesSessionProblem(batchAccessRulesDialog.identity, {
      server: serverStateStore.remoteAddress,
      username: authStore.username,
      loggedIn: authStore.isLoggedIn,
      permitted: hasPermission('set_access_rules'),
      connected: serverStateStore.connected,
      lockdown: serverStateStore.lockdown,
      bypassLockdown: hasPermission('bypass_lockdown'),
    });
  }

  function closeBatchAccessRules() {
    batchAccessRulesDialog = null;
    batchBusy = false;
  }

  async function refreshAfterBatchAccessRules() {
    if (batchAccessRulesGuard()) return;
    const loaded = await loadDirectory(currentFolderId, true, undefined, false);
    if (!loaded) throw new Error(directoryLoadError ?? $t('files.batchRules.refreshFailed'));
    await loadSelectionDetails();
  }

  async function handleSetAccessRules(
    objectType: ServerObjectType,
    objectId: string,
    objectName: string,
  ) {
    if (objectType === 'directory') {
      openBatchAccessRules([{ objectType, objectId, name: objectName }]);
      return;
    }
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
    let rateLimited = 0;

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
          rateLimited += result.rateLimited;
        } catch (e) {
          if (isDownloadBatchStop(e)) throw e;
          failed += 1;
          if (serverAvailability(e)?.kind === 'rate_limited') rateLimited += 1;
          markDownloadBatchFailed(batch.batchId, e);
        }
      }

      setDownloadBatchPhase(batch.batchId, 'queueing');
      const result = await queueCollectedDownloads(items, controller.signal, batch);
      queued += result.queued;
      failed += result.failed;
      rateLimited += result.rateLimited;

      if (queued > 0) {
        status = $t('files.batchDownloadQueued', { values: { count: queued } });
      }
      if (failed > 0) {
        error = batchDownloadFailureText(failed, rateLimited);
      }
      if (queued > 0 && failed === 0) clearSelection();
    } catch (e) {
      if (isDownloadBatchStop(e)) {
        status = $t('files.batchDownloadStopped');
      } else {
        error = formatError(e);
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
      const rateLimited = collected.rateLimited + queuedResult.rateLimited;
      if (queued > 0) {
        status = $t('files.batchDownloadQueued', { values: { count: queued } });
      }
      if (failed > 0) {
        error = batchDownloadFailureText(failed, rateLimited);
      }
    } catch (e) {
      if (isDownloadBatchStop(e)) {
        status = $t('files.batchDownloadStopped');
      } else {
        error = formatError(e);
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
    await runBatchRateLimitedRequest(
      () => getDocument(doc.id, makeDownloadPath([...pathParts, doc.title]), batch),
      signal,
      batch?.batchId,
    );
    await waitForDownloadBatchResume(signal);
  }

  async function collectDirectoryDownloadItems(
    folder: Pick<ServerDirectoryEntry, 'id' | 'name'>,
    pathParts: string[],
    signal: AbortSignal,
    batchId?: string,
  ): Promise<{ items: DownloadQueueItem[]; failed: number; rateLimited: number }> {
    await waitForDownloadBatchResume(signal);
    const response = await runBatchRateLimitedRequest(
      () => listDirectory(folder.id),
      signal,
      batchId,
    );
    await waitForDownloadBatchResume(signal);
    const items: DownloadQueueItem[] = [];
    let failed = 0;
    let rateLimited = 0;
    const downloadPath = makeDownloadPath(pathParts);

    try {
      await ensureDownloadSubdirectory(downloadPath);
    } catch (e) {
      failed += 1;
      if (serverAvailability(e)?.kind === 'rate_limited') rateLimited += 1;
      if (batchId) markDownloadBatchFailed(batchId, e);
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
        rateLimited += result.rateLimited;
      } catch (e) {
        if (isDownloadBatchStop(e)) throw e;
        failed += 1;
        if (serverAvailability(e)?.kind === 'rate_limited') rateLimited += 1;
        if (batchId) markDownloadBatchFailed(batchId, e);
      }
    }

    return { items, failed, rateLimited };
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
  ): Promise<{ queued: number; failed: number; rateLimited: number }> {
    let queued = 0;
    let failed = 0;
    let rateLimited = 0;

    for (const item of items) {
      await waitForDownloadBatchResume(signal);
      try {
        // Only persist work that actually entered the queue in the durable
        // estimate. The live snapshot still carries the discovered total while
        // queueing, but a rejected item must not leave the completed batch at a
        // permanently misleading partial percentage.
        const queuedBatch = { ...batch, batchEstimatedTotal: queued + 1 };
        await queueDocumentDownload(item.document, item.pathParts, signal, queuedBatch);
        queued += 1;
        markDownloadBatchQueued(batch.batchId);
      } catch (e) {
        if (isDownloadBatchStop(e)) throw e;
        failed += 1;
        if (serverAvailability(e)?.kind === 'rate_limited') rateLimited += 1;
        markDownloadBatchFailed(batch.batchId, e);
      }
    }

    return { queued, failed, rateLimited };
  }

  function batchDownloadFailureText(failed: number, rateLimited: number) {
    if (rateLimited <= 0) {
      return $t('files.batchDownloadPartialFailed', { values: { count: failed } });
    }
    const other = Math.max(0, failed - rateLimited);
    return other > 0
      ? $t('files.batchDownloadRateLimitedMixed', { values: { rateLimited, other } })
      : $t('files.batchDownloadRateLimited', { values: { count: rateLimited } });
  }

  async function runBatchRateLimitedRequest<T>(
    request: () => Promise<T>,
    signal: AbortSignal,
    batchId?: string,
  ): Promise<T> {
    let retryCount = 0;

    while (true) {
      await waitForDownloadBatchResume(signal);
      try {
        const result = await request();
        if (batchId) setDownloadBatchRateLimitWaiting(batchId, false);
        if (retryCount > 0) status = null;
        return result;
      } catch (requestError) {
        const availability = serverAvailability(requestError);
        if (availability?.kind !== 'rate_limited' || retryCount >= MAX_BATCH_RATE_LIMIT_RETRIES) {
          if (batchId) setDownloadBatchRateLimitWaiting(batchId, false);
          if (retryCount > 0) status = null;
          throw requestError;
        }

        retryCount += 1;
        const seconds = availability.retryAfterSeconds ?? Math.min(2 ** (retryCount - 1), 8);
        if (batchId) setDownloadBatchRateLimitWaiting(batchId, true);
        status = $t('files.batchDownloadRateLimitWaiting', { values: { seconds } });
        try {
          await waitForBatchRetryDelay(seconds * 1000, signal);
        } finally {
          if (batchId) setDownloadBatchRateLimitWaiting(batchId, false);
        }
      }
    }
  }

  function waitForBatchRetryDelay(delayMs: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Folder download queueing stopped.', 'AbortError'));
        return;
      }
      const complete = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const timeout = window.setTimeout(complete, delayMs);
      const abort = () => {
        window.clearTimeout(timeout);
        reject(new DOMException('Folder download queueing stopped.', 'AbortError'));
      };
      signal.addEventListener('abort', abort, { once: true });
    });
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

    const batchId = createUploadId();
    const batchCreatedAt = Math.floor(Date.now() / 1000);
    const batchName = breadcrumbSegments.at(-1)?.label ?? $t('files.rootDirectory');
    const requests: UploadEnqueueRequest[] = [];
    const add = (candidate: UploadCandidate, conflictStrategy: UploadConflictStrategy, conflictResolutions: DirectoryFileConflictResolution[] = []) => {
      requests.push({
        uploadId: createUploadId(), fileName: candidate.name, sourcePath: candidate.sourcePath,
        kind: candidate.kind, targetParentId: targetFolderId, conflictStrategy, conflictResolutions,
        uploadName: candidate.name, batchId, batchName, batchCreatedAt, batchIndex: requests.length,
      });
    };
    for (const candidate of availableFiles) add(candidate, 'fail');
    for (const { candidate, action } of decisions) {
      if (candidate.directoryPath && candidate.relativePath) {
        directoryResolutions.get(candidate.directoryPath)?.push({ relativePath: candidate.relativePath, conflictStrategy: action });
      } else { add(candidate, action); }
    }
    for (const candidate of directoryCandidates) add(candidate, 'fail', directoryResolutions.get(candidate.sourcePath) ?? []);
    // Preserve selection order even when conflict decisions were collected separately.
    requests.sort((a, b) => candidates.findIndex(c => c.sourcePath === a.sourcePath) - candidates.findIndex(c => c.sourcePath === b.sourcePath));
    requests.forEach((request, index) => { request.batchIndex = index; });
    try {
      const result = await uploadStore.addBatch(requests);
      queuedUploadCount = result.tasks.length;
      if (result.tasks.length) notificationStore.success($t('tasks.batchQueued', { values: { count: result.tasks.length } }));
      if (result.failed.length) {
        error = $t('tasks.batchEnqueueFailed', { values: { count: result.failed.length } }) + '\n' + result.failed.map(item => `${requests.find(r => r.uploadId === item.id)?.fileName ?? item.id}: ${item.error}`).join('\n');
      }
    } catch (err) { error = formatError(err); }
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
    if (!canUseServerSearch) return;
    searchPreview.open = true;
    queueSearchPreviewPanelPosition();
    scheduleSearchPreview();
  }

  function focusFilesSearchInput() {
    if (!canUseServerSearch) return;
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
        || batchAccessRulesDialog
        || moveTargetDialog
        || batchMoveDialog
        || revisionsDialog
        || documentTagsDialog,
    );
  }

  function handleFindShortcut(event: KeyboardEvent) {
    if (!isFindShortcut(event)) return;

    if (!canUseServerSearch || hasBlockingFilesDialog()) return;
    event.preventDefault();
    focusFilesSearchInput();
  }

  function handleSearchInput(event?: Event) {
    if (!canUseServerSearch) return;
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
    if (!canUseServerSearch) return;
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
    if (!canUseServerSearch) {
      closeSearchPreview();
      return;
    }
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
    if (!canUseServerSearch) return;
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
      if (handleSearchPermissionError(e)) return;
      searchPreview.error = formatError(e);
    }
  }

  function loadMoreSearchPreview() {
    if (!canUseServerSearch) return;
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
    if (!canUseServerSearch) return;
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

  function searchResultDate(row: SearchResultRow) {
    return row.kind === 'directory'
      ? formatDate(row.directory.created_time)
      : formatDate(row.document.last_modified ?? null);
  }

  function openSearchDialog(runImmediately = false) {
    if (!canUseServerSearch) return;
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
    if (!canUseServerSearch) return;
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
      if (handleSearchPermissionError(e)) return;
      error = formatError(e);
    }
  }

  function handleSearchPermissionError(searchError: unknown): boolean {
    if (serverErrorStatus(searchError) !== 403) return false;
    searchDeniedByServer = true;
    closeSearchPreview();
    closeSearchDialog();
    notificationStore.warning($t('files.searchPermissionRequired'), 5000);
    return true;
  }

  function closeSearchDialog() {
    searchRunId += 1;
    searchDialog = { ...searchDialog, open: false, loading: false };
  }

  async function navigateToSearchDirectory(directory: { id: string; name: string }) {
    if (navigationUnavailable) return;
    closeSearchPreview();
    closeSearchDialog();
    const ok = await navigateDirectory({
      folderId: directory.id, navigationRootId: directory.id, navigationRootLabel: directory.name, navHistory: [],
    });
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
    if (navigationUnavailable) return;
    closeSearchPreview();
    closeSearchDialog();
    const parent = normalizeDirectoryId(document.parent_id);
    const ok = await navigateDirectory({
      folderId: parent, navigationRootId: parent,
      navigationRootLabel: parent === null ? null : shortIdentifier(parent), navHistory: [],
    });
    if (ok) {
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
    let unlistenUploads: UnlistenFn | null = null;
    let uploadRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    void listen<UploadTaskDto>('cfms:upload-task', ({ payload: task }) => {
      if (disposed || !['completed', 'skipped'].includes(task.status) || !sameDirectoryId(task.target_parent_id, currentFolderId)) return;
      clearTimeout(uploadRefreshTimer);
      uploadRefreshTimer = setTimeout(() => {
        if (!disposed) void loadDirectory(currentFolderId, true);
      }, 250);
    }).then(stop => { if (disposed) stop(); else unlistenUploads = stop; });
    directorySorter = createProgressiveDirectorySorter(handleDirectorySnapshot, handleDirectorySorterError);
    const unregisterKeyboardCommands = registerKeyboardCommands([
      ...([-1, 1] as const).map((direction) => ({
        id: direction === -1 ? 'files.back' : 'files.forward',
        label: () => $t(direction === -1 ? 'files.goBack' : 'files.goForward'),
        group: () => $t('files.title'),
        shortcuts: [{ key: direction === -1 ? 'ArrowLeft' : 'ArrowRight', alt: true }],
        scope: 'page' as const,
        enabled: () => (direction === -1 ? canGoBack : canGoForward) && !navigationUnavailable && !hasBlockingFilesDialog(),
        handler: () => handleHistoryNavigate(direction),
      })),
      {
        id: 'files.find',
        label: () => $t('files.search'),
        group: () => $t('files.title'),
        shortcuts: [{ key: 'f', primary: true }],
        scope: 'page',
        enabled: () => canUseServerSearch && !hasBlockingFilesDialog(),
        allowInEditable: true,
        handler: handleFindShortcut,
      },
      {
        id: 'files.address',
        label: () => $t('files.editAddress'),
        group: () => $t('files.title'),
        shortcuts: [{ key: 'd', alt: true }, { key: 'F4' }],
        scope: 'page',
        enabled: () => nodeLookupEnabled && !navigationUnavailable && !hasBlockingFilesDialog(),
        allowInEditable: true,
        handler: () => { void addressBar?.beginEdit(); },
      },
      {
        id: 'files.parent',
        label: () => $t('files.parentDirectory'),
        group: () => $t('files.title'),
        shortcuts: [{ key: 'Backspace' }, { key: 'ArrowUp', alt: true }],
        scope: 'page',
        enabled: () => canGoToParent && !navigationUnavailable && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('go-parent', event),
      },
      {
        id: 'files.refresh',
        label: () => $t('common.refresh'),
        group: () => $t('files.title'),
        shortcuts: FILE_SHORTCUTS.refresh,
        scope: 'page',
        enabled: () => !navigationUnavailable && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('refresh', event),
      },
      {
        id: 'files.create-folder',
        label: () => $t('files.createFolder'),
        group: () => $t('files.title'),
        shortcuts: FILE_SHORTCUTS.createFolder,
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
        shortcuts: FILE_SHORTCUTS.delete,
        scope: 'page',
        enabled: () => totalSelected > 0 && canDeleteSelection() && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('delete-selection', event),
      },
      {
        id: 'files.rename',
        label: () => $t('files.rename'),
        group: () => $t('files.title'),
        shortcuts: FILE_SHORTCUTS.rename,
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
    const hasRequestedFolder = page.url.searchParams.has('folder');
    const requestedFolder = normalizeDirectoryId(page.url.searchParams.get('folder'));
    const requestedName = page.url.searchParams.get('name');
    navigationScope = currentFilePreferenceScope();
    const rememberedTimeline = fileManagerNavigationStore.restoreTimeline(navigationScope.serverAddress, navigationScope.username);
    const initialNavigation = rememberedTimeline?.entries[rememberedTimeline.cursor] ?? {
      folderId: null, navigationRootId: null, navigationRootLabel: null, navHistory: [],
    };
    applyDirectoryNavigation(initialNavigation);
    navigationTimeline = rememberedTimeline ?? { entries: [], cursor: -1 };
    navigationStateReady = true;
    if (hasRequestedFolder) {
      const visit = navigateDirectory({
        folderId: requestedFolder, navigationRootId: requestedFolder,
        navigationRootLabel: requestedFolder ? requestedName || shortIdentifier(requestedFolder) : null,
        navHistory: [],
      });
      const generation = directoryGeneration;
      void visit.then((ok) => {
        if (ok || disposed || generation !== directoryGeneration || isDeniedDirectory(requestedFolder)) return;
        // This route has no cached rows yet. Reload the previous location when
        // an explicit URL/favorite cannot be opened, without recording a visit.
        if (navigationTimeline.entries.length === 0) navigationTimeline = recordDirectoryVisit(navigationTimeline, initialNavigation);
        if (!sameDirectoryId(requestedFolder, initialNavigation.folderId)) void loadDirectory(initialNavigation.folderId, true);
      });
    } else {
      navigationTimeline = recordDirectoryVisit(navigationTimeline, initialNavigation);
      void loadDirectory(initialNavigation.folderId);
    }
    reloadUserPreference();
    return () => {
      disposed = true;
      clearTimeout(uploadRefreshTimer);
      unlistenUploads?.();
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
    <div class="drop-upload-overlay pointer-events-none absolute inset-3 z-30 grid place-items-center border border-dashed border-md3-primary bg-md3-surface text-center ">
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

  <ExplorerNavigationBar
    {canGoBack} {canGoForward} {canGoToParent}
    search={canUseServerSearch ? serverSearch : undefined}
    busy={navigationUnavailable}
    onBack={() => { void handleHistoryNavigate(-1); }}
    onForward={() => { void handleHistoryNavigate(1); }}
    onParent={() => { void handleGoToParent(); }}
    onRefresh={() => { void loadDirectory(currentFolderId, true); }}
  >
    {#snippet address()}
      <FileAddressBar
        bind:this={addressBar}
        segments={breadcrumbSegments}
        lookupEnabled={nodeLookupEnabled}
        knownPath={knownAddressPath}
        busy={navigationUnavailable}
        error={addressLookupError}
        onNavigate={handleBreadcrumbNavigate}
        onSubmit={handleAddressSubmit}
        onCancel={handleAddressCancel}
        onBeginEdit={handleAddressBeginEdit}
      />
    {/snippet}
  </ExplorerNavigationBar>

  {#if queuedUploadCount > 0}
    <div class="upload-queued-notice" role="status">
      <span>{$t('tasks.batchQueued', { values: { count: queuedUploadCount } })}</span>
      <FluentButton appearance="subtle" onclick={() => goto('/home/tasks?tab=uploads')}>{$t('tasks.viewTransfers')}</FluentButton>
      <FluentButton appearance="subtle" iconOnly aria-label={$t('common.close')} onclick={() => (queuedUploadCount = 0)}><Icon name="close" size="16px" /></FluentButton>
    </div>
  {/if}

  {#snippet serverSearch()}
    <!-- Search -->
    {#if canUseServerSearch}
      <div bind:this={searchPreviewRoot} class="files-search relative">
      <form
        class="files-search-field cfms-field-surface"
        data-search-box
        onsubmit={(e) => { e.preventDefault(); openSearchDialog(true); }}
      >
          <input
            type="text"
            class="files-search-input cfms-native-field"
            data-focus-ring="delegated"
            placeholder={directorySearchPlaceholder}
            bind:value={searchQuery}
            bind:this={searchInput}
            onfocus={openSearchPreview}
            oninput={handleSearchInput}
            onkeydown={handleSearchKeydown}
            role="combobox"
            aria-expanded={searchPreview.open}
            aria-controls="files-search-preview-list"
            aria-label={directorySearchPlaceholder}
            aria-keyshortcuts="Control+F Meta+F"
            aria-autocomplete="list"
            aria-activedescendant={searchPreview.open && searchPreviewActiveIndex >= 0
              ? `files-search-preview-option-${searchPreviewActiveIndex}`
              : undefined}
          />
          {#if searchQuery}
            <FluentButton data-fluent-owner="routes-home-files-page"
              type="button"
              aria-label={$t('common.clear')}
              onclick={() => {
                searchQuery = '';
                handleSearchInput();
                searchInput?.focus({ preventScroll: true });
              }}
              appearance="subtle"
              class="files-search-clear"
              iconOnly
            >
              <Icon name="close" size="16px" />
            </FluentButton>
          {/if}
        <FluentButton data-fluent-owner="routes-home-files-page"
          type="submit"
          title={$t('files.serverSearch')}
          aria-label={$t('files.serverSearch')}
          disabled={!searchPreviewHasQuery}
          appearance="subtle"
          class="files-search-submit"
          iconOnly
        >
          <Icon name="search" size="16px" />
        </FluentButton>
      </form>

      {#if searchPreview.open}
        <div
          id="files-search-preview-panel"
          class="search-preview-panel cfms-acrylic-surface fixed z-40 overflow-hidden"
          style={searchPreviewPanelStyle}
        >
          <div class="border-b border-md3-outline px-4 py-3">
            <div class="search-preview-controls">
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

              <div class="search-sort" role="toolbar" tabindex="-1" aria-label={$t('workspace.sort')} onkeydown={(event) => focusRovingItem(event, event.currentTarget as HTMLElement, { selector: '[data-search-sort]', orientation: 'horizontal' })}>
                {#each ['name', 'size', 'modified'] as field}
                  <button data-fluent-owner="routes-home-files-page"
                    data-search-sort
                    tabindex={searchPreview.sortBy === field ? 0 : -1}
                    type="button"
                    class="search-sort-option"
                    aria-pressed={searchPreview.sortBy === field}
                    onclick={() => setSearchPreviewSort(field as SortField)}
                  >
                    {searchSortLabel(field as SortField)}
                  </button>
                {/each}
              </div>
              <FluentButton data-fluent-owner="routes-home-files-page"
                type="button"
                title={searchPreview.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
                onclick={toggleSearchPreviewSortOrder}
                appearance="outline"
                class="search-preview-action"
              >
                <Icon name={searchPreview.sortOrder === 'asc' ? 'arrowUpward' : 'arrowDownward'} size="16px" />
                {searchPreview.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
              </FluentButton>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs text-md3-on-surface-variant">
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
                  <button data-fluent-owner="routes-home-files-page"
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

          <div class="search-preview-footer">
            <FluentButton data-fluent-owner="routes-home-files-page"
              type="button"
              disabled={!searchPreviewCanSearch}
              onclick={() => openSearchDialog(true)}
              appearance="subtle"
              class="search-preview-action"
            >
              {$t('files.advancedSearch')}
            </FluentButton>
            <FluentButton data-fluent-owner="routes-home-files-page"
              type="button"
              disabled={!searchPreviewCanSearch}
              onclick={() => openSearchDialog(true)}
              appearance="outline"
              class="search-preview-action"
            >
              <Icon name="search" size="16px" />
              {$t('files.allResults')}
            </FluentButton>
          </div>
        </div>
      {/if}
      </div>
    {/if}

  {/snippet}

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
        <FluentButton data-fluent-owner="routes-home-files-page"
          data-sort-item
          iconOnly
          type="button"
          data-active={sortField === field ? 'true' : undefined}
          title={sortTitle(field as SortField)}
          aria-label={sortTitle(field as SortField)}
          aria-pressed={sortField === field}
          tabindex={sortField === field ? 0 : -1}
          onclick={() => setSort(field as SortField)}
          appearance="subtle"
          class="explorer-command-button explorer-command-button--compact files-sort-button"
        >
          <Icon name={sortFieldIcon(field)} size="17px" />
          {#if sortField === field}
            <span class="files-sort-direction" aria-hidden="true">
              <Icon name={sortDirection === 'asc' ? 'arrowUpward' : 'arrowDownward'} size="10px" />
            </span>
          {/if}
        </FluentButton>
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
      canMoveItems={hasPermission('move')}
      onDragSelection={handleDragSelection}
      onMoveItems={handleDropMove}
      emptyContent={directoryAccessDenied ? deniedDirectoryContent : undefined}
    />
    <ExplorerDetailsPane
      open={detailsOpen}
      model={detailModel}
      emptyTitle={$t('files.properties')}
      emptyLabel={$t('workspace.selectForDetails')}
      closeLabel={$t('workspace.closeDetails')}
      resizeLabel={$t('workspace.resizeDetails')}
      onClose={() => (detailsOpen = false)}
    />
  </div>

  <ExplorerStatusBar
    primary={statusBarPrimary}
    secondary={statusBarSecondary}
    tone={directoryLoadPhase === 'partial-error' ? 'danger' : 'default'}
    actionLabel={directoryLoadPhase === 'partial-error' ? $t('workspace.retryLoading') : ''}
    onAction={retryDirectoryLoad}
  />
</div>

<style>
  .upload-queued-notice { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 16px; font-size: 13px; border-bottom: 1px solid var(--explorer-border); }
  .upload-queued-notice span { margin-inline-end: auto; }

  .files-page {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    color: var(--explorer-text);
  }

  .files-search { min-width: 0; width: 100%; }

  .files-search-field {
    display: flex;
    min-width: 0;
    box-sizing: border-box;
    height: var(--files-field-height);
    align-items: center;
    gap: 2px;
    border: 1px solid var(--colorNeutralStroke1);
    border-bottom-color: var(--colorNeutralStrokeAccessible);
    border-radius: var(--borderRadiusMedium);
    padding: 0;
    color: var(--colorNeutralForeground1);
    background: transparent;
  }
  .files-search-field:hover { border-color: var(--colorNeutralStroke1Hover); }
  [data-search-box]:has([data-focus-ring="delegated"]:focus) {
    border-color: var(--colorStrokeFocus2);
    box-shadow: inset 0 -1px var(--colorStrokeFocus2);
  }
  .files-search-input {
    width: 0;
    min-width: 0;
    flex: 1;
    align-self: stretch;
    border: 0;
    padding: 5px 10px;
    text-overflow: ellipsis;
    color: inherit;
    background: transparent;
    font: 400 14px/20px var(--fontFamilyBase);
  }
  .files-search-input::placeholder { color: var(--colorNeutralForeground3); opacity: 1; }
  :global(.files-search-clear[data-fluent-owner="routes-home-files-page"]),
  :global(.files-search-submit[data-fluent-owner="routes-home-files-page"]) {
    flex: none;
    inline-size: calc(var(--files-field-height) - 2px);
    block-size: calc(var(--files-field-height) - 2px);
    min-block-size: 0;
    min-inline-size: 0;
    padding: 0;
    color: var(--colorNeutralForeground2);
  }
  :global(.files-search-submit[data-fluent-owner="routes-home-files-page"][disabled]) { color: var(--colorNeutralForegroundDisabled); }

  .files-command-row {
    position: relative;
    z-index: 20;
    display: flex;
    min-height: 48px;
    flex-shrink: 0;
    align-items: center;
    gap: 12px;
    overflow: hidden;
    border-bottom: 1px solid var(--explorer-border);
    padding: 0.35rem 0.7rem;
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
    gap: 4px;
    margin-left: auto;
    overflow: hidden;
    white-space: nowrap;
  }

  :global(.files-sort-button[data-fluent-owner="routes-home-files-page"]) {
    position: relative;
    width: 34px;
    height: 34px;
    flex: none;
    overflow: hidden;
    padding: 0;
    white-space: nowrap;
  }

  @media (pointer: coarse) {
    :global(.files-sort-button[data-fluent-owner="routes-home-files-page"]) { width: 44px; height: 44px; }
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

  :global(.server-search-list-viewport) {
    min-height: 0;
    flex: 1 1 auto;
    max-height: calc(52vh - 2.25rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .server-search-form {
    --files-field-height: 32px;
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    color: var(--colorNeutralForeground1);
  }
  .server-search-query {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    flex: none;
  }
  .server-search-controls {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 16px;
    color: var(--colorNeutralForeground2);
    font: 400 14px/20px var(--fontFamilyBase);
  }
  :global(.server-search-action[data-fluent-owner="routes-home-files-page"]) { font-weight: 400; }
  .server-search-results {
    container-type: inline-size;
    display: flex;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: var(--borderRadiusLarge);
  }
  .server-search-summary {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    border-bottom: 1px solid var(--colorNeutralStroke2);
    padding: 8px 12px;
    color: var(--colorNeutralForeground2);
    font: 400 12px/16px var(--fontFamilyBase);
  }
  .server-search-result {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: var(--search-row-height);
    border: 0;
    border-bottom: 1px solid var(--colorNeutralStroke2);
    border-radius: 0;
    padding: 8px 12px;
    background: transparent;
    color: var(--colorNeutralForeground1);
    text-align: left;
    font: 400 14px/20px var(--fontFamilyBase);
    transition: background-color var(--durationFaster) var(--curveEasyEase);
  }
  .server-search-result:hover { background: var(--colorNeutralBackground1Hover); }
  .server-search-result:active { background: var(--colorNeutralBackground1Pressed); }
  .server-search-result:focus-visible { outline-offset: -2px; }
  .server-search-result--last { border-bottom: 0; }
  .server-search-result-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .server-search-result-detail { color: var(--colorNeutralForeground2); text-align: right; font: 400 12px/16px var(--fontFamilyBase); }

  @container (max-width: 480px) {
    .server-search-result { gap: 4px 12px; }
    .server-search-result > :first-child { grid-row: span 2; }
    .server-search-result-name { grid-column: 2 / -1; }
    .server-search-result-detail { grid-column: 2 / -1; text-align: left; }
  }

  :global(.modal-positioner--sized .server-search-list-viewport),
  :global(.modal-positioner--maximized .server-search-list-viewport) {
    max-height: none;
  }

  :global(.search-preview-virtual-viewport) {
    max-height: 360px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .search-preview-panel {
    animation: search-preview-in 180ms var(--motion-easing-emphasized-decelerate) both;
  }

  .search-preview-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .search-sort { display: flex; max-width: 100%; flex-wrap: wrap; gap: 2px; border: 1px solid var(--colorNeutralStroke1); border-radius: var(--borderRadiusMedium); padding: 2px; }
  .search-sort-option { min-height: 32px; border-radius: var(--borderRadiusMedium); padding: 4px 12px; color: var(--colorNeutralForeground2); font: 400 14px/20px var(--fontFamilyBase); transition: background-color var(--durationFaster) var(--curveEasyEase); }
  .search-sort-option:hover:not(:disabled) { background: var(--colorNeutralBackground1Hover); }
  .search-sort-option[aria-pressed="true"] { color: var(--colorBrandForeground1); background: var(--colorBrandBackground2); box-shadow: inset 0 -2px var(--colorBrandStroke1); }
  .search-sort-option:disabled { color: var(--colorNeutralForegroundDisabled); }
  :global(.search-preview-action[data-fluent-owner="routes-home-files-page"]) { font-weight: 400; }
  .search-preview-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; }

  @media (pointer: coarse) {
    .files-search-input { font-size: 16px; }
    .server-search-form { --files-field-height: 44px; }
    .search-sort-option { min-height: 44px; }
  }
  @media (forced-colors: active) {
    :global(html[data-window-backdrop]) .files-page,
    :global(html[data-window-backdrop]) .files-command-row,
    :global(html[data-window-backdrop]) .files-page :global(.explorer-status-bar) { background: Canvas; }
    .files-search-field { color: FieldText; background: Field; border-color: ButtonText; }
    [data-search-box]:has([data-focus-ring="delegated"]:focus) { outline: 2px solid Highlight; outline-offset: -2px; box-shadow: none; }
    .search-sort-option[aria-pressed="true"] { color: HighlightText; background: Highlight; box-shadow: none; outline: 1px solid Highlight; }
  }

  .revision-graph-row {
    position: relative;
    display: grid;
    grid-template-columns: var(--revision-graph-width) minmax(0, 1fr) auto;
    align-items: stretch;
    gap: 12px;
    min-height: 64px;
  }

  .revision-graph-row:not(:last-child)::after {
    position: absolute;
    right: 0;
    bottom: 0;
    left: calc(var(--revision-graph-width) + 12px);
    height: 1px;
    background: var(--colorNeutralStroke2);
    content: '';
    pointer-events: none;
  }

  .revision-graph-track {
    position: relative;
  }

  .revision-graph-path {
    stroke: var(--color-md3-on-surface-variant);
    stroke-width: 1.75;
  }

  .revision-graph-path--active {
    stroke: var(--color-md3-primary-emphasis);
    stroke-width: 2.5;
  }

  .revision-graph-node {
    position: absolute;
    top: 50%;
    width: 10px;
    height: 10px;
    pointer-events: none;
    border: 2px solid var(--color-md3-on-surface-variant);
    border-radius: 999px;
    background: var(--color-md3-surface-container);
    transform: translate(-50%, -50%);
  }

  .revision-graph-node--lineage {
    border-color: var(--color-md3-surface-container);
    background: var(--color-md3-primary-emphasis);
  }

  .revision-graph-node--current {
    width: 12px;
    height: 12px;
    border-width: 3px;
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
    resizable
    maximizable
    minWidth={520}
    minHeight={360}
    closeLabel={$t('common.close')}
    onClose={closeSearchDialog}
  >
    <form class="server-search-form" style:--search-row-height={`${searchRowHeight}px`} onsubmit={(e) => { e.preventDefault(); runServerSearch(); }}>
      <div class="server-search-query">
        <div class="files-search-field cfms-field-surface" data-search-box>
        <input
          class="files-search-input cfms-native-field"
          data-focus-ring="delegated"
          bind:value={searchDialog.query}
          bind:this={searchDialogInput}
          placeholder={$t('files.searchPlaceholder')}
          aria-label={$t('files.searchPlaceholder')}
          disabled={searchDialog.loading}
        />
        {#if searchDialog.query}
          <FluentButton data-fluent-owner="routes-home-files-page"
            type="button"
            appearance="subtle"
            class="files-search-clear"
            iconOnly
            aria-label={$t('common.clear')}
            disabled={searchDialog.loading}
            onclick={() => {
              searchDialog.query = '';
              searchDialogInput?.focus({ preventScroll: true });
            }}
          >
            <Icon name="close" size="16px" />
          </FluentButton>
        {/if}
        </div>
        <FluentButton data-fluent-owner="routes-home-files-page"
          type="submit"
          disabled={searchDialog.loading}
          appearance="primary"
          class="server-search-action"
        >
          {$t('files.serverSearch')}
        </FluentButton>
      </div>

      <div class="server-search-controls">
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

        <div class="search-sort" role="toolbar" tabindex="-1" aria-label={$t('workspace.sort')} onkeydown={(event) => focusRovingItem(event, event.currentTarget as HTMLElement, { selector: '[data-search-sort]', orientation: 'horizontal' })}>
          {#each ['name', 'size', 'modified'] as field}
            <button data-fluent-owner="routes-home-files-page"
              data-search-sort
              tabindex={searchDialog.sortBy === field ? 0 : -1}
              type="button"
              class="search-sort-option"
              aria-pressed={searchDialog.sortBy === field}
              disabled={searchDialog.loading}
              onclick={() => setSearchDialogSort(field as SortField)}
            >
              {searchSortLabel(field as SortField)}
            </button>
          {/each}
        </div>
        <FluentButton data-fluent-owner="routes-home-files-page"
          type="button"
          disabled={searchDialog.loading}
          title={searchDialog.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
          onclick={toggleSearchDialogSortOrder}
          appearance="outline"
          class="server-search-action"
        >
          <Icon name={searchDialog.sortOrder === 'asc' ? 'arrowUpward' : 'arrowDownward'} size="16px" />
          {searchDialog.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
        </FluentButton>
      </div>

      {#if searchDialog.results}
        <div class="server-search-results">
          <div class="server-search-summary" role="status">
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
            estimateSize={searchRowHeight}
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
                  onclick={() => navigateToSearchDirectory(row.directory)}
                  class="server-search-result"
                  class:server-search-result--last={index === searchResultRows.length - 1}
                >
                  <span class="text-md3-primary-emphasis"><Icon name="folder" size="20px" /></span>
                  <span class="server-search-result-name">{row.directory.name}</span>
                  <span class="server-search-result-detail">{formatDate(row.directory.created_time)}</span>
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => navigateToSearchDocument(row.document)}
                  class="server-search-result"
                  class:server-search-result--last={index === searchResultRows.length - 1}
                >
                  <span class="text-md3-on-surface-variant"><Icon name="filePresent" size="20px" /></span>
                  <span class="server-search-result-name">{row.document.name ?? row.document.title}</span>
                  <span class="server-search-result-detail">{formatBytes(row.document.size)}</span>
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
  <ModalFrame
    title={authorizeDialog.title}
    maxWidth="max-w-2xl"
    resizable
    maximizable
    minWidth={520}
    minHeight={480}
    closeLabel={$t('common.close')}
    onClose={() => (authorizeDialog = null)}
  >
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
  <ModalFrame
    title={accessEntriesDialog.title}
    maxWidth="max-w-5xl"
    resizable
    maximizable
    minWidth={720}
    minHeight={360}
    closeLabel={$t('common.close')}
    onClose={() => (accessEntriesDialog = null)}
  >
      <div class="h-full max-h-[70vh] overflow-auto p-5">
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
                    <FluentButton data-fluent-owner="routes-home-files-page"
                      title={$t('files.revoke')}
                      aria-label={$t('files.revoke')}
                      onclick={() => handleRevokeAccess(entry.id)}
                      type="button"
                      appearance="subtle"
                      tone="danger"
                      class="rounded bg-md3-error-container p-2 text-md3-on-error-container transition-all "
                      iconOnly
                    >
                      <Icon name="delete" size="17px" />
                    </FluentButton>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
  </ModalFrame>
{/if}

{#if batchAccessRulesDialog}
  <BatchAccessRulesDialog
    targets={batchAccessRulesDialog.targets}
    initialTemplateKey={batchAccessRulesDialog.initialTemplateKey}
    canReadTemplate={hasPermission('view_access_rules')}
    checkGuard={batchAccessRulesGuard}
    onApplied={refreshAfterBatchAccessRules}
    onClose={closeBatchAccessRules}
  />
{/if}

{#if accessRulesDialog}
  <ModalFrame
    title={accessRulesDialog.title}
    maxWidth="max-w-6xl"
    resizable
    maximizable
    minWidth={680}
    minHeight={480}
    closeLabel={$t('common.close')}
    onClose={() => (accessRulesDialog = null)}
  >
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
  <ModalFrame
    title={revisionsDialog.title}
    maxWidth="max-w-2xl"
    resizable
    maximizable
    minWidth={520}
    minHeight={420}
    closeLabel={$t('common.close')}
    onClose={() => (revisionsDialog = null)}
  >
      <div class="h-full max-h-[72vh] overflow-auto p-5">
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
          <div class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-md3-on-surface-variant">
            <div class="flex items-center gap-2 text-xs font-medium uppercase">
              <Icon name="history" size="16px" />
              {$t('files.revisionGraph')}
            </div>
            <div class="flex items-center gap-1.5 text-[11px] font-medium">
              <span class="relative inline-block h-2 w-6" aria-hidden="true">
                <span class="absolute left-0 top-1/2 h-[2.5px] w-full -translate-y-1/2 rounded-full bg-md3-primary-emphasis"></span>
                <span class="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-md3-surface-container bg-md3-primary-emphasis"></span>
              </span>
              {$t('files.currentRevisionLineage')}
            </div>
          </div>
          <div style={`--revision-graph-width: ${revisionGraphWidth}px`}>
            {#each revisionRows as row (row.revision.id)}
              <div class="revision-graph-row">
                <div class="revision-graph-track" aria-hidden="true">
                  <svg
                    class="absolute inset-0 h-full w-full"
                    viewBox={`0 0 ${revisionGraphWidth} 64`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    {#each row.before as lane, index}
                      {#if lane !== null && (index !== row.lane || row.hasChildren)}
                        <line
                          class="revision-graph-path"
                          class:revision-graph-path--active={lane.isCurrentLineage}
                          x1={laneX(index)}
                          y1="0"
                          x2={laneX(index)}
                          y2="32"
                          stroke-linecap="round"
                          vector-effect="non-scaling-stroke"
                        />
                      {/if}
                    {/each}
                    {#if row.parentLane !== null}
                      <path
                        class="revision-graph-path"
                        class:revision-graph-path--active={row.parentPathInCurrentLineage}
                        d={row.parentLane === row.lane
                          ? `M ${laneX(row.lane)} 32 L ${laneX(row.lane)} 64`
                          : `M ${laneX(row.lane)} 32 C ${laneX(row.lane)} 48, ${laneX(row.parentLane)} 48, ${laneX(row.parentLane)} 64`}
                        fill="none"
                        stroke-linecap="round"
                        vector-effect="non-scaling-stroke"
                      />
                    {/if}
                    {#if row.parentLaneContinuation}
                      <path
                        class="revision-graph-path"
                        class:revision-graph-path--active={row.parentLaneContinuation.isCurrentLineage}
                        d={row.parentLaneContinuation.fromLane === row.parentLaneContinuation.toLane
                          ? `M ${laneX(row.parentLaneContinuation.fromLane)} 32 L ${laneX(row.parentLaneContinuation.toLane)} 64`
                          : `M ${laneX(row.parentLaneContinuation.fromLane)} 32 C ${laneX(row.parentLaneContinuation.fromLane)} 48, ${laneX(row.parentLaneContinuation.toLane)} 48, ${laneX(row.parentLaneContinuation.toLane)} 64`}
                        fill="none"
                        stroke-linecap="round"
                        vector-effect="non-scaling-stroke"
                      />
                    {/if}
                    {#each row.after as lane, index}
                      {#if lane !== null && index !== row.parentLane}
                        <line
                          class="revision-graph-path"
                          class:revision-graph-path--active={lane.isCurrentLineage}
                          x1={laneX(index)}
                          y1="32"
                          x2={laneX(index)}
                          y2="64"
                          stroke-linecap="round"
                          vector-effect="non-scaling-stroke"
                        />
                      {/if}
                    {/each}
                  </svg>
                  <span
                    class="revision-graph-node"
                    class:revision-graph-node--lineage={row.isCurrentLineage}
                    class:revision-graph-node--current={row.isCurrentRevision}
                    style={`left: ${laneX(row.lane)}px;`}
                    aria-hidden="true"
                  ></span>
                </div>

                <div class="min-w-0 break-words py-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-sm font-semibold text-md3-on-surface" title={row.revision.id}>
                      {$t('files.revision')} #{shortIdentifier(row.revision.id)}
                    </p>
                    {#if row.isCurrentRevision}
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
                  <FluentButton data-fluent-owner="routes-home-files-page"
                    title={$t('common.download')}
                    onclick={() => handleDownloadRevision(row.revision)}
                    type="button"
                    appearance="subtle"
                    class="rounded p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface"
                    iconOnly
                    aria-label={$t('common.download')}
                  >
                    <Icon name="download" size="18px" />
                  </FluentButton>
                  {#if !row.revision.is_current}
                    <FluentButton data-fluent-owner="routes-home-files-page"
                      title={$t('files.setCurrentRevision')}
                      onclick={() => handleSetCurrentRevision(row.revision)}
                      type="button"
                      appearance="subtle"
                      class="rounded p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-primary-container hover:text-md3-on-primary-container"
                      iconOnly
                      aria-label={$t('files.setCurrentRevision')}
                    >
                      <Icon name="pushPin" size="18px" />
                    </FluentButton>
                    <FluentButton data-fluent-owner="routes-home-files-page"
                      title={$t('files.deleteRevision')}
                      onclick={() => handleDeleteRevision(row.revision)}
                      type="button"
                      appearance="subtle"
                      tone="danger"
                      class="rounded p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-error-container hover:text-md3-on-error-container"
                      iconOnly
                      aria-label={$t('files.deleteRevision')}
                    >
                      <Icon name="delete" size="18px" />
                    </FluentButton>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
  </ModalFrame>
{/if}
