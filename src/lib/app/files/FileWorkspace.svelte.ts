import { _ as t } from 'svelte-i18n';
import { onMount, tick, untrack } from 'svelte';
import { MediaQuery } from 'svelte/reactivity';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { listen, type UnlistenFn } from '$lib/shared/platform/native-events';
import { getCurrentWebview } from '$lib/shared/platform/native-webview';
import { open } from '$lib/shared/platform/native-dialog';
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
  getAccessRules,
  getDirectoryInfo,
  getDocumentInfo,
  grantAccess,
  listRevisions,
  moveDirectory,
  moveDocument,
  renameDirectory,
  renameDocument,
  resolveNodeTarget,
  revokeAccess,
  setAccessRules,
  setCurrentRevision,
  setDocumentTags,
  searchFiles,
  uploadNewRevision,
  viewAccessEntries,
  type AccessEntry,
  type ListDirectoryResponse,
  type DirectoryFileConflictResolution,
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
import type { ServerDirectoryEntry, ServerDocumentEntry, ServerObjectType } from '$lib/api';
import { batchRulesSessionProblem, type BatchRulesIdentity, type BatchRulesTarget } from '$lib/features/access/batch-access-rules';
import { accessRulesTemplateKey } from '$lib/features/access/access-rules-edit';

import { type FileTableDragItems, type FileTableRow, type FileTableViewportAnchor } from '$lib/features/files/FileTable.svelte';
import type { AccessGrantFormValue } from '$lib/features/access/access-grants';
import type { AccessRulesRecord } from '$lib/features/access/access-rules';
import type { ContextMenuItem } from '$lib/shared/ui/context-menu';
import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';
import { pickDirectory, type SelectedDirectory } from '$lib/shared/platform/directory-picker';
import { normalizeDirectoryId, ROOT_DIRECTORY_ID, sameDirectoryId, type DirectoryBreadcrumbSegment } from '$lib/features/files/file-browser';
import {
  directoryToRecord,
  documentToRecord,
  type FilePreferenceScope,
  type FileRecord,
  isFavoriteRecord,
  rememberVisit,
  setFavoriteRecord,
} from '$lib/features/files/file-preferences';
import {
  formatBytes,
  formatDate,
  formatError,
  formatUnknown,
  isPickerCancel,
} from '$lib/shared/format/values';
import { graphWidth, buildRevisionRows } from '$lib/features/files/revision-graph';
import {
  fileManagerNavigationStore,
  recordDirectoryVisit,
  resolveDirectoryVisit,
  directoryHistoryTarget,
  type DirectoryNavigationTimeline,
  type DirectoryNavigationSnapshot,
} from '$lib/features/files/file-manager-navigation';
import type { SortDirection, SortField } from '$lib/features/files/sorting';
import { createProgressiveDirectorySorter, type ProgressiveDirectorySorter, type ProgressiveSortSnapshot } from '$lib/features/files/sort-worker-client';
import { DIRECTORY_PAGE_SIZE } from '$lib/features/files/progressive-listing';
import { DirectoryLoadController, DirectoryRequestTimeoutError } from '$lib/features/files/directory-load-controller';
import { DirectoryRefreshController } from '$lib/features/files/directory-refresh-controller';
import { canSearchFiles } from '$lib/features/files/search-permissions';
import { isAccessDeniedError, serverAvailability, serverErrorStatus } from '$lib/api/server-errors';
import {
  FILE_SHORTCUTS,
  fileManagerShortcutFor,
  isFindShortcut,
  registerKeyboardCommands,
  keyboardMenuAnchor,
  type FileManagerShortcut,
} from '$lib/shared/ui/keyboard';
import { isAndroidTreeUri, uploadDisplayName } from '$lib/shared/platform/upload-names';
import {
  createUploadConflictResolver,
  partitionUploadConflicts,
  type UploadCandidate,
  type UploadConflictAction,
  type UploadConflictDecision,
} from '$lib/features/files/upload-conflicts';
import { shortIdentifier } from '$lib/shared/format/identifiers';
import { knownAbsoluteNodePath, type ResolvedNodePathSegment } from '$lib/features/files/node-path';
import type { IconName } from '$lib/shared/ui/icons';
import type { CommandAction, FileDetailModel } from '$lib/features/files/explorer-types';
import {
  fileSelectionKey,
  isAllVisibleSelected,
  parseFileSelectionKey,
  selectedDocumentSize as sumDocumentSelectionSize,
  selectFileRangeByIndex,
} from '$lib/features/files/file-selection';
import { isMobilePlatform } from '$lib/shared/platform/platform';
import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
import { floatingProgressStore } from "$lib/shared/notifications/progress.svelte.ts";
import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
import { serverStateStore } from "$lib/features/connection/connection-state.svelte.ts";
import { uploadStore } from "$lib/features/transfers/upload-state.svelte.ts";
import { startDirectoryDownload } from '$lib/features/transfers/directory-download-controller';
import { fromStore } from 'svelte/store';

export type SearchResultRow =
  | { kind: 'directory'; directory: SearchDirectoryEntry }
  | { kind: 'document'; document: SearchDocumentEntry };

export type PendingUploadConflict = UploadCandidate & {
  directoryPath?: string;
  relativePath?: string;
};

export type DirectoryLoadPhase = 'idle' | 'initial-loading' | 'loading-more' | 'complete' | 'partial-error';

export type DirectoryAccessDeniedState = {
  folderId: string | null;
  returnNavigation: DirectoryNavigationSnapshot;
};

export type DirectoryRefreshTarget = FilePreferenceScope & { folderId: string | null };

export type FileListIndex = {
  folderById: Map<string, ServerDirectoryEntry>;
  documentById: Map<string, ServerDocumentEntry>;
  folderIds: string[];
  documentIds: string[];
  keyToIndex: Map<string, number>;
  documentSizeById: Map<string, number>;
  totalDocumentSize: number;
};

/** Per-view workflow; reusable business rules live in features. */
export function createFileWorkspace() {
  const translator = fromStore(t);

  const SERVER_SEARCH_PAGE_SIZE = 128;

  const SEARCH_PREVIEW_PAGE_SIZE = 24;

  const SEARCH_PREVIEW_DEBOUNCE_MS = 120;

  const SEARCH_PREVIEW_SCROLL_THRESHOLD = 72;

  const SORT_FIELDS: SortField[] = ['name', 'modified', 'size'];

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

  const directoryRefresh = new DirectoryRefreshController(
    listDirectoryPage,
    applyBackgroundDirectory,
    handleBackgroundDirectoryError,
  );

  let refreshLocation: DirectoryRefreshTarget | null = null;

  let refreshErrorNotification: number | null = null;

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
    refreshTarget: DirectoryRefreshTarget;
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
    translator.current('files.directorySearchPlaceholder', { values: { directory: currentDirectoryName() } }),
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
      navigationScope.userId,
      navigationTimeline,
    );
  });

  $effect(() => {
    const target = captureDirectoryRefreshTarget();
    const blocked = loading || navigationBusy || addressLookupBusy
      || directoryLoadPhase === 'initial-loading' || directoryLoadPhase === 'loading-more';
    untrack(() => {
      if (refreshLocation && !sameRefreshTarget(refreshLocation, target)) {
        directoryRefresh.invalidate();
        clearRefreshErrorNotification();
      }
      refreshLocation = target;
      directoryRefresh.setBlocked(blocked);
    });
  });

  function captureDirectoryRefreshTarget(): DirectoryRefreshTarget {
    return { ...currentFilePreferenceScope(), folderId: currentFolderId };
  }

  function sameRefreshTarget(left: DirectoryRefreshTarget, right: DirectoryRefreshTarget) {
    return sameDirectoryId(left.folderId, right.folderId)
      && left.serverAddress === right.serverAddress && left.userId === right.userId;
  }

  function isCurrentRefreshTarget(target: DirectoryRefreshTarget) {
    return directorySorter !== null && !directoryAccessDenied
      && sameRefreshTarget(target, captureDirectoryRefreshTarget());
  }

  function refreshDirectory(target: DirectoryRefreshTarget): Promise<boolean> {
    if (!isCurrentRefreshTarget(target)) return Promise.resolve(false);
    return directoryRefresh.request(target.folderId, () => isCurrentRefreshTarget(target));
  }

  function clearRefreshErrorNotification() {
    if (refreshErrorNotification !== null) notificationStore.remove(refreshErrorNotification);
    refreshErrorNotification = null;
  }

  function handleBackgroundDirectoryError(folderId: string | null, cause: unknown) {
    if (!sameDirectoryId(folderId, currentFolderId)) return;
    if (isAccessDeniedError(cause)) {
      directoryRefresh.invalidate();
      directoryGeneration = directoryLoader.invalidate();
      clearRefreshErrorNotification();
      clearSelection();
      showDirectoryAccessDenied(folderId, activeDirectoryReturnNavigation ?? captureDirectoryNavigation());
      return;
    }
    clearRefreshErrorNotification();
    const target = captureDirectoryRefreshTarget();
    refreshErrorNotification = notificationStore.warning(
      translator.current('workspace.backgroundRefreshFailed', { values: { error: formatDirectoryLoadError(cause) } }),
      undefined,
      { action: { label: translator.current('common.retry'), onClick: () => { void refreshDirectory(target); } } },
    );
  }

  function applyBackgroundDirectory(listing: ListDirectoryResponse, signal: AbortSignal): Promise<void> {
    const target = captureDirectoryRefreshTarget();
    const generation = directoryGeneration;
    return new Promise((resolve, reject) => {
      let committed = false;
      const cancel = () => { sorter.dispose(); resolve(); };
      const sorter = createProgressiveDirectorySorter((snapshot) => {
        if (committed) {
          handleDirectorySnapshot(snapshot);
          return;
        }
        if (signal.aborted || generation !== directoryGeneration || !isCurrentRefreshTarget(target)) {
          signal.removeEventListener('abort', cancel);
          cancel();
          return;
        }
        if (snapshot.revision !== sortRevision) {
          sorter.resort(generation, sortRevision, sortField, sortDirection);
          return;
        }
        committed = true;
        signal.removeEventListener('abort', cancel);
        directorySorter?.dispose();
        directorySorter = sorter;
        parentId = normalizeDirectoryId(listing.parent_id);
        directoryLoadError = null;
        clearRefreshErrorNotification();
        handleDirectorySnapshot(snapshot, true);
        resolve();
      }, (cause) => {
        if (committed) handleDirectorySorterError(cause);
        else {
          signal.removeEventListener('abort', cancel);
          sorter.dispose();
          reject(cause);
        }
      });
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) { cancel(); return; }
      sorter.reset(generation, sortRevision, sortField, sortDirection);
      sorter.append(generation, sortRevision, listing.folders, listing.documents, true);
    });
  }

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

  function handleDirectorySnapshot(snapshot: ProgressiveSortSnapshot, preserveSelection = false) {
    if (snapshot.generation !== directoryGeneration || snapshot.revision !== sortRevision) return;
    const viewportAnchor = directoryLoadedCount > 0 ? fileTable?.captureViewportAnchor() ?? null : null;
    folders = snapshot.folders;
    documents = snapshot.documents;
    fileListIndex = createFileListIndex(snapshot.folders, snapshot.documents);
    if (preserveSelection) {
      commitSelection(
        new Set([...selectedFolderIds].filter((id) => fileListIndex.folderById.has(id))),
        new Set([...selectedDocumentIds].filter((id) => fileListIndex.documentById.has(id))),
      );
      if (focusedItemKey && !fileListIndex.keyToIndex.has(focusedItemKey)) focusedItemKey = null;
      if (selectionAnchorKey && !fileListIndex.keyToIndex.has(selectionAnchorKey)) selectionAnchorKey = null;
    }
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
        void tick().then(() => {
          if (snapshot.generation === directoryGeneration && snapshot.revision === sortRevision) {
            return fileTable?.restoreViewportAnchor(anchorIndex, viewportAnchor.offset);
          }
        });
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
      ? translator.current('workspace.directoryRequestTimedOut')
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
  ): Promise<boolean> {
    if (!directorySorter) return false;
    directoryRefresh.setBlocked(true);
    directoryRefresh.invalidate();
    clearRefreshErrorNotification();
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
      if (isAccessDeniedError(e)) {
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

  const navigationUnavailable = $derived(navigationBusy || addressLookupBusy || directoryLoadPhase === 'initial-loading');

  const canGoBack = $derived(navigationTimeline.cursor > 0);

  const canGoForward = $derived(navigationTimeline.cursor + 1 < navigationTimeline.entries.length);

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
    if (statusCode === 400) return translator.current('files.addressInvalid');
    if (statusCode === 403 || statusCode === 404) return translator.current('files.addressUnavailable');
    return translator.current('files.addressRequestFailed');
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
        notificationStore.warning(translator.current('files.addressDocumentChanged', {
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
    status = translator.current('files.addressDocumentLocated', { values: { name: pending.label } });
  }

  async function handleAddressSubmit(rawPath: string) {
    if (navigationUnavailable) return;
    const path = rawPath.trim();
    if (!path) {
      addressLookupError = translator.current('files.addressRequired');
      return;
    }

    const runId = ++addressLookupRunId;
    addressLookupBusy = true;
    addressLookupError = null;
    try {
      const response = await resolveNodeTarget(path);
      if (runId !== addressLookupRunId) return;
      const resolvedSegments = response.segments;

      if (resolvedSegments.length === 0) {
        const ok = await navigateDirectory({ folderId: null, navigationRootId: null, navigationRootLabel: null, navHistory: [] });
        if (runId !== addressLookupRunId) return;
        if (!ok && !isDeniedDirectory(null)) {
          error = null;
          addressLookupError = translator.current('files.addressRequestFailed');
          return;
        }
        addressBar?.finishEdit();
        if (ok) status = translator.current('files.addressDirectoryOpened');
        return;
      }

      const terminal = resolvedSegments[resolvedSegments.length - 1];
      const target = response.target;
      const expectedParentId = target.kind === 'document' ? target.parentId : null;
      if (runId !== addressLookupRunId) return;

      if (target.kind === 'directory') {
        const ok = await navigateDirectory({
          folderId: terminal.id, navigationRootId: null, navigationRootLabel: null,
          navHistory: resolvedDirectoryHistory(resolvedSegments),
        });
        if (runId !== addressLookupRunId) return;
        if (!ok && !isDeniedDirectory(terminal.id)) {
          error = null;
          addressLookupError = translator.current('files.addressRequestFailed');
          return;
        }
        addressBar?.finishEdit();
        if (ok) status = translator.current('files.addressDirectoryOpened');
        return;
      }

      const ok = await navigateDirectory({
        folderId: expectedParentId, navigationRootId: null, navigationRootLabel: null,
        navHistory: resolvedDirectoryHistory(resolvedSegments.slice(0, -1)),
      });
      if (runId !== addressLookupRunId) return;
      if (!ok && !isDeniedDirectory(expectedParentId)) {
        error = null;
        addressLookupError = translator.current('files.addressRequestFailed');
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
      title: translator.current('files.jumpToDirectory'),
      message: translator.current('files.jumpToDirectoryPrompt'),
      defaultValue: currentFolderId ?? ROOT_DIRECTORY_ID,
      confirmLabel: translator.current('common.open'),
      cancelLabel: translator.current('common.cancel'),
      selectOnOpen: true,
    });
    if (value === null) return;
    const target = normalizeDirectoryId(value);
    const ok = await navigateDirectory({
      folderId: target, navigationRootId: target,
      navigationRootLabel: target === null ? null : shortIdentifier(target), navHistory: [],
    });
    if (ok) status = translator.current('files.jumpToDirectorySuccess');
  }

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
    translator.current('files.batchSelectionName', { values: { count: totalSelected } }),
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
      ? translator.current('workspace.itemCount', { values: { count: totalVisibleSelectable } })
      : translator.current('workspace.itemsLoaded', { values: { count: directoryLoadedCount } }),
  );

  const statusBarSecondary = $derived(
    directoryLoadPhase === 'partial-error'
      ? `${translator.current('workspace.loadingInterrupted')}${directoryLoadError ? `: ${directoryLoadError}` : ''}`
      : totalSelected > 0
        ? `${translator.current('workspace.selectedItems', { values: { count: totalSelected } })}${selectedDocumentSize > 0 ? ` · ${formatBytes(selectedDocumentSize)}` : ''}`
        : directoryLoadPhase === 'initial-loading'
          ? translator.current('workspace.loadingDirectory')
          : directoryLoadPhase === 'loading-more'
            ? translator.current('workspace.loadingMoreItems')
            : '',
  );

  const fileCommandActions = $derived.by<CommandAction[]>(() => [
    { id: 'new-folder', label: translator.current('files.createFolder'), icon: 'createNewFolder', run: handleCreateFolder },
    { id: 'upload-files', label: translator.current('files.uploadFiles'), icon: 'uploadFile', run: handleUploadFiles },
    { id: 'upload-folder', label: translator.current('files.uploadFolder'), icon: 'folderUpload', run: handleUploadFolder },
    {
      id: 'download-selected',
      label: translator.current('files.downloadSelected'),
      icon: 'download',
      visible: totalSelected > 0,
      disabled: batchBusy,
      dividerBefore: true,
      run: handleDownloadSelected,
    },
    {
      id: 'rename-selected',
      label: translator.current('files.rename'),
      icon: 'edit',
      visible: totalSelected === 1,
      disabled: batchBusy || !canRenameSelected(),
      run: handleRenameSelected,
    },
    {
      id: 'move-selected',
      label: translator.current('files.moveSelected'),
      icon: 'driveFileMove',
      visible: totalSelected > 0,
      disabled: batchBusy || !hasPermission('move'),
      run: handleMoveSelected,
    },
    {
      id: 'access-rules-selected',
      label: translator.current('files.setPermissions'),
      icon: 'settings',
      visible: totalSelected > 1 || !!selectedFolder,
      disabled: batchBusy || loading || !hasPermission('set_access_rules'),
      run: handleBatchAccessRules,
    },
    {
      id: 'delete-selected',
      label: translator.current('common.delete'),
      icon: 'delete',
      tone: 'danger',
      visible: totalSelected > 0,
      disabled: batchBusy || !canDeleteSelection(),
      run: handleDeleteSelected,
    },
    {
      id: 'selection-mode',
      label: translator.current('files.select'),
      icon: 'checklist',
      compact: true,
      active: selectMode,
      dividerBefore: true,
      run: toggleSelectMode,
    },
    {
      id: 'select-all',
      label: allVisibleSelected ? translator.current('files.selectNone') : translator.current('files.selectAll'),
      icon: allVisibleSelected ? 'clearAll' : 'selectAll',
      active: allVisibleSelected,
      visible: selectMode,
      disabled: totalVisibleSelectable === 0,
      run: toggleAllVisibleSelection,
    },
    {
      id: 'jump',
      label: translator.current('files.jumpToDirectory'),
      icon: 'folderEye',
      compact: true,
      run: handleJumpToDirectory,
    },
    {
      id: 'details',
      label: translator.current('workspace.details'),
      icon: 'info',
      compact: true,
      active: detailsOpen,
      run: () => { detailsOpen = !detailsOpen; },
    },
    {
      id: 'trash',
      label: translator.current('workspace.recycleBin'),
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
    return permissions.some((permission) => authStore.permissions.includes(permission));
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
        title: translator.current('workspace.selectedItems', { values: { count: totalSelected } }),
        icon: 'checklist',
        rows: [
          { label: translator.current('files.directory'), value: String(selectedFolderIds.size) },
          { label: translator.current('files.document'), value: String(selectedDocumentIds.size) },
          { label: translator.current('files.size'), value: formatBytes(selectedDocumentSize) },
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
          subtitle: translator.current('files.directory'),
          icon: 'folder',
          rows: [
            { label: translator.current('files.directoryId'), value: info.directory_id ?? selectedFolder.id },
            { label: translator.current('files.childCount'), value: String(info.count_of_child ?? '-') },
            { label: translator.current('files.created'), value: formatDate(info.created_time ?? selectedFolder.created_time) },
            { label: translator.current('files.parentId'), value: info.parent_id ?? '-' },
          ],
        };
      } else if (selectedDocument) {
        const info = await getDocumentInfo(selectedDocument.id);
        if (requestId !== detailRequestId) return;
        detailModel = {
          title: info.title ?? selectedDocument.title,
          subtitle: translator.current('files.document'),
          icon: 'filePresent',
          rows: [
            { label: translator.current('files.documentId'), value: info.document_id ?? selectedDocument.id },
            { label: translator.current('files.size'), value: formatBytes(info.size ?? selectedDocument.size) },
            { label: translator.current('files.created'), value: formatDate(info.created_time ?? null) },
            { label: translator.current('files.modified'), value: formatDate(info.last_modified ?? selectedDocument.last_modified) },
            { label: translator.current('files.creator'), value: info.metadata?.creator ?? '-' },
            { label: translator.current('files.tags'), value: formatList(info.metadata?.tags) },
          ],
        };
      }
    } catch (detailError) {
      if (requestId !== detailRequestId) return;
      detailModel = { title: selectedName, icon: selectedFolder ? 'folder' : 'filePresent', error: formatError(detailError), rows: [] };
    }
  }

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
      ?? translator.current('files.rootDirectory');
  }

  function getContextMenuItems(): ContextMenuItem[] {
    if (contextMenu.kind === 'selection') {
      // ContextMenu closes before invoking the action, so capture its target now.
      const targetKey = contextMenu.targetKey ?? null;
      return [
        {
          id: 'download-selection',
          label: translator.current('files.downloadSelected'),
          icon: 'download',
          disabled: batchBusy,
          onSelect: handleDownloadSelected,
        },
        {
          id: 'move-selection',
          label: translator.current('files.moveSelected'),
          icon: 'driveFileMove',
          disabled: batchBusy || !hasPermission('move'),
          onSelect: handleMoveSelected,
        },
        {
          id: 'access-rules-selection',
          label: translator.current('files.setPermissions'),
          icon: 'settings',
          disabled: batchBusy || loading,
          requiredPermissions: ['set_access_rules'],
          onSelect: () => handleBatchAccessRules(targetKey),
        },
        { type: 'divider' },
        {
          id: 'delete-selection',
          shortcuts: FILE_SHORTCUTS.delete,
          label: translator.current('common.delete'),
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
          label: translator.current('common.refresh'),
          icon: 'refresh',
          onSelect: async () => {
            await loadDirectory(currentFolderId);
          },
        },
        { type: 'divider' },
        {
          id: 'create-directory-here',
          shortcuts: FILE_SHORTCUTS.createFolder,
          label: translator.current('files.createFolder'),
          icon: 'createNewFolder',
          onSelect: handleCreateFolder,
        },
        {
          id: 'upload-folder-here',
          label: translator.current('files.uploadFolder'),
          icon: 'folderUpload',
          onSelect: handleUploadFolder,
        },
        {
          id: 'upload-files-here',
          label: translator.current('files.uploadFiles'),
          icon: 'uploadFile',
          onSelect: handleUploadFiles,
        },
        { type: 'divider' },
        {
          id: 'authorize-current-directory',
          label: translator.current('files.authorize'),
          icon: 'lockPerson',
          requiredPermissions: ['manage_access'],
          onSelect: () => handleAuthorize('directory', directoryId, directoryName),
        },
        {
          id: 'view-current-directory-access',
          label: translator.current('files.viewAccessEntries'),
          icon: 'listAlt',
          requiredPermissions: ['view_access_entries'],
          onSelect: () => handleViewAccessEntries('directory', directoryId, directoryName),
        },
        {
          id: 'current-directory-rules',
          label: translator.current('files.setPermissions'),
          icon: 'settings',
          requiredPermissions: ['set_access_rules'],
          onSelect: () => handleSetAccessRules('directory', directoryId, directoryName),
        },
        { type: 'divider' },
        {
          id: 'current-directory-properties',
          label: translator.current('files.properties'),
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
          label: translator.current('common.download'),
          icon: 'download',
          onSelect: () => handleDownload(doc),
        },
        {
          id: 'favorite-document',
          label: favorite ? translator.current('files.removeFavorite') : translator.current('files.addFavorite'),
          icon: favorite ? 'star' : 'starOutline',
          iconFilled: favorite,
          onSelect: () => handleToggleFavorite(record, !favorite),
        },
        { type: 'divider' },
        {
          id: 'rename-document',
          shortcuts: FILE_SHORTCUTS.rename,
          label: translator.current('files.rename'),
          icon: 'edit',
          requiredPermissions: ['rename_document'],
          onSelect: () => handleRenameDocument(doc),
        },
        {
          id: 'move-document',
          label: translator.current('files.move'),
          icon: 'driveFileMove',
          requiredPermissions: ['move'],
          onSelect: () => handleMoveDocument(doc),
        },
        {
          id: 'delete-document',
          shortcuts: FILE_SHORTCUTS.delete,
          label: translator.current('common.delete'),
          icon: 'delete',
          requiredPermissions: ['delete_document'],
          onSelect: () => handleDeleteSingle('document', doc),
          danger: true,
        },
        { type: 'divider' },
        {
          id: 'authorize-document',
          label: translator.current('files.authorize'),
          icon: 'lockPerson',
          requiredPermissions: ['manage_access'],
          onSelect: () => handleAuthorize('document', doc.id, doc.title),
        },
        {
          id: 'view-document-access',
          label: translator.current('files.viewAccessEntries'),
          icon: 'listAlt',
          requiredPermissions: ['view_access_entries'],
          onSelect: () => handleViewAccessEntries('document', doc.id, doc.title),
        },
        {
          id: 'document-rules',
          label: translator.current('files.setPermissions'),
          icon: 'settings',
          requiredPermissions: ['set_access_rules'],
          onSelect: () => handleSetAccessRules('document', doc.id, doc.title),
        },
        {
          id: 'edit-document-tags',
          label: translator.current('files.editTags'),
          icon: 'label',
          requiredPermissions: ['view_metadata', 'set_metadata_tags'],
          onSelect: () => handleEditDocumentTags(doc),
        },
        { type: 'divider' },
        {
          id: 'upload-document-revision',
          label: translator.current('files.uploadNewVersion'),
          icon: 'uploadFile',
          onSelect: () => handleUploadNewVersion(doc),
        },
        {
          id: 'view-document-revisions',
          label: translator.current('files.viewRevisions'),
          icon: 'history',
          requiredPermissions: ['list_revisions'],
          onSelect: () => handleViewRevisions(doc),
        },
        { type: 'divider' },
        {
          id: 'document-properties',
          label: translator.current('files.properties'),
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
        label: translator.current('common.open'),
        icon: 'folderOpen',
        onSelect: () => handleNavigate(folder.id, folder.name),
      },
      {
        id: 'download-folder',
        label: translator.current('common.download'),
        icon: 'download',
        disabled: batchBusy,
        onSelect: () => handleDownloadFolder(folder),
      },
      {
        id: 'favorite-folder',
        label: favorite ? translator.current('files.removeFavorite') : translator.current('files.addFavorite'),
        icon: favorite ? 'star' : 'starOutline',
        iconFilled: favorite,
        onSelect: () => handleToggleFavorite(record, !favorite),
      },
      { type: 'divider' },
      {
        id: 'rename-folder',
        shortcuts: FILE_SHORTCUTS.rename,
        label: translator.current('files.rename'),
        icon: 'edit',
        requiredPermissions: ['rename_directory'],
        onSelect: () => handleRenameFolder(folder),
      },
      {
        id: 'move-folder',
        label: translator.current('files.move'),
        icon: 'driveFileMove',
        requiredPermissions: ['move'],
        onSelect: () => handleMoveFolder(folder),
      },
      {
        id: 'delete-folder',
        shortcuts: FILE_SHORTCUTS.delete,
        label: translator.current('common.delete'),
        icon: 'delete',
        requiredPermissions: ['delete_directory'],
        onSelect: () => handleDeleteSingle('folder', folder),
        danger: true,
      },
      { type: 'divider' },
      {
        id: 'authorize-folder',
        label: translator.current('files.authorize'),
        icon: 'lockPerson',
        requiredPermissions: ['manage_access'],
        onSelect: () => handleAuthorize('directory', folder.id, folder.name),
      },
      {
        id: 'view-folder-access',
        label: translator.current('files.viewAccessEntries'),
        icon: 'listAlt',
        requiredPermissions: ['view_access_entries'],
        onSelect: () => handleViewAccessEntries('directory', folder.id, folder.name),
      },
      {
        id: 'folder-rules',
        label: translator.current('files.setPermissions'),
        icon: 'settings',
        requiredPermissions: ['set_access_rules'],
        onSelect: () => handleSetAccessRules('directory', folder.id, folder.name),
      },
      { type: 'divider' },
      {
        id: 'folder-properties',
        label: translator.current('files.properties'),
        icon: 'info',
        onSelect: () => handleFolderProperties(folder),
      },
    ];
  }

  async function handleDeleteSingle(
    kind: 'folder' | 'document',
    item: ServerDirectoryEntry | ServerDocumentEntry,
  ) {
    const refreshTarget = captureDirectoryRefreshTarget();
    try {
      if (kind === 'folder') {
        await deleteDirectory((item as ServerDirectoryEntry).id);
      } else {
        await deleteDocument((item as ServerDocumentEntry).id);
      }
      status = translator.current('files.deleted');
      await refreshDirectory(refreshTarget);
    } catch (e) {
      error = String(e);
    }
  }

  async function handleRenameDocument(doc: ServerDocumentEntry) {
    const refreshTarget = captureDirectoryRefreshTarget();
    const next = await dialogStore.prompt({
      title: translator.current('files.rename'),
      message: translator.current('files.renamePrompt'),
      defaultValue: doc.title,
      confirmLabel: translator.current('common.save'),
      cancelLabel: translator.current('common.cancel'),
    });
    if (next === null || !next.trim() || next.trim() === doc.title) return;
    await runFileAction(async () => {
      await renameDocument(doc.id, next.trim());
      status = translator.current('files.renamed');
      await refreshDirectory(refreshTarget);
    });
  }

  async function handleRenameFolder(folder: ServerDirectoryEntry) {
    const refreshTarget = captureDirectoryRefreshTarget();
    const next = await dialogStore.prompt({
      title: translator.current('files.rename'),
      message: translator.current('files.renamePrompt'),
      defaultValue: folder.name,
      confirmLabel: translator.current('common.save'),
      cancelLabel: translator.current('common.cancel'),
    });
    if (next === null || !next.trim() || next.trim() === folder.name) return;
    await runFileAction(async () => {
      await renameDirectory(folder.id, next.trim());
      status = translator.current('files.renamed');
      await refreshDirectory(refreshTarget);
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
    const refreshTarget = { ...captureDirectoryRefreshTarget(), folderId: dialog.originalParentId };
    const target = normalizeDirectoryId(targetFolderId);

    if (dialog.objectType === 'directory' && target === dialog.objectId) {
      error = translator.current('files.moveSelfError');
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
      status = translator.current('files.moved');
      await refreshDirectory(refreshTarget);
    } catch (err) {
      error = formatError(err);
      moveTargetDialog = { ...dialog, saving: false };
    }
  }

  async function handleBatchMoveToTarget(targetFolderId: string | null) {
    if (!batchMoveDialog || totalSelected === 0) return;
    const refreshTarget = captureDirectoryRefreshTarget();
    const target = normalizeDirectoryId(targetFolderId);
    const selectedFolders = [...selectedFolderIds];
    const selectedDocuments = [...selectedDocumentIds];

    if (target && selectedFolders.includes(target)) {
      error = translator.current('files.moveSelfError');
      return;
    }

    batchMoveDialog = { ...batchMoveDialog, saving: true };
    error = null;

    try {
      await moveFileItems({ folderIds: selectedFolders, documentIds: selectedDocuments }, target);
      batchMoveDialog = null;
      clearSelection();
      status = translator.current('files.batchMoved', { values: { count: selectedDocuments.length + selectedFolders.length } });
      await refreshDirectory(refreshTarget);
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
    const refreshTarget = captureDirectoryRefreshTarget();
    error = null;
    try {
      await moveFileItems(items, targetFolderId);
      const movedCount = items.folderIds.length + items.documentIds.length;
      clearSelection();
      status = movedCount === 1
        ? translator.current('files.moved')
        : translator.current('files.batchMoved', { values: { count: movedCount } });
      await refreshDirectory(refreshTarget);
    } catch (err) {
      const accessDenied = isAccessDeniedError(err);
      // Reload because an earlier item in a multi-item move may have succeeded.
      await refreshDirectory(refreshTarget);
      if (!accessDenied) error = formatError(err);
    } finally {
      dropMoveBusy = false;
    }
  }

  async function handleDocumentProperties(doc: ServerDocumentEntry) {
    await runFileAction(async () => {
      const info = await getDocumentInfo(doc.id);
      detailTitle = translator.current('files.documentDetails');
      detailRows = [
        { label: translator.current('files.documentId'), value: info.document_id ?? doc.id },
        { label: translator.current('files.documentTitle'), value: info.title ?? doc.title },
        { label: translator.current('files.size'), value: formatBytes(info.size ?? doc.size) },
        { label: translator.current('files.created'), value: formatDate(info.created_time ?? null) },
        { label: translator.current('files.modified'), value: formatDate(info.last_modified ?? doc.last_modified) },
        { label: translator.current('files.parentId'), value: info.parent_id ?? '-' },
        { label: translator.current('files.creator'), value: info.metadata?.creator ?? '-' },
        { label: translator.current('files.lastModifiedBy'), value: info.metadata?.last_modified_by ?? '-' },
        { label: translator.current('files.tags'), value: formatList(info.metadata?.tags) },
        { label: translator.current('files.accessRules'), value: formatUnknown(info.info_code ? null : info.access_rules) },
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
    const refreshTarget = captureDirectoryRefreshTarget();
    const tags = normalizeTags(selected);
    await setDocumentTags(documentTagsDialog.documentId, tags);
    status = translator.current('files.tagsUpdated', { values: { name: documentTagsDialog.title } });
    documentTagsDialog = null;
    await refreshDirectory(refreshTarget);
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
      detailTitle = translator.current('files.directoryDetails');
      detailRows = [
        { label: translator.current('files.directoryId'), value: info.directory_id ?? directoryId },
        { label: translator.current('files.directoryName'), value: info.name ?? fallbackName },
        { label: translator.current('files.childCount'), value: String(info.count_of_child ?? '-') },
        { label: translator.current('files.created'), value: formatDate(info.created_time ?? fallbackCreatedTime) },
        { label: translator.current('files.parentId'), value: info.parent_id ?? '-' },
        { label: translator.current('files.accessRules'), value: formatUnknown(info.info_code ? null : info.access_rules) },
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
        title: translator.current('files.accessEntriesFor', { values: { name: objectName } }),
        objectType,
        objectId,
        entries,
      };
    });
  }

  async function handleRevokeAccess(entryId: number) {
    if (!accessEntriesDialog) return;
    const refreshTarget = captureDirectoryRefreshTarget();
    await runFileAction(async () => {
      await revokeAccess(entryId);
      accessEntriesDialog = {
        ...accessEntriesDialog!,
        entries: await viewAccessEntries(
          accessEntriesDialog!.objectType,
          accessEntriesDialog!.objectId,
        ),
      };
      status = translator.current('files.accessRevoked');
      await refreshDirectory(refreshTarget);
    });
  }

  async function handleAuthorize(
    targetType: ServerObjectType,
    targetIdentifier: string,
    targetName: string,
  ) {
    authorizeDialog = {
      title: translator.current('files.authorizeTitle', { values: { name: targetName } }),
      targetType,
      targetIdentifier,
      targetName,
      saving: false,
    };
  }

  async function handleSubmitAuthorize(value: AccessGrantFormValue) {
    if (!authorizeDialog) return;
    const refreshTarget = captureDirectoryRefreshTarget();
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
      status = translator.current('files.accessGrantedTo', {
        values: {
          entity: value.entityIdentifier,
          name: dialog.targetName,
        },
      });
      await refreshDirectory(refreshTarget);
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
      identity: { server: serverStateStore.remoteAddress, userId: authStore.userId },
      initialTemplateKey: accessRulesTemplateKey(targets, focusedItemKey, contextItemKey),
      refreshTarget: captureDirectoryRefreshTarget(),
    };
    batchBusy = true;
  }

  function batchAccessRulesGuard() {
    if (!batchAccessRulesDialog) return { kind: 'stopped' as const };
    return batchRulesSessionProblem(batchAccessRulesDialog.identity, {
      server: serverStateStore.remoteAddress,
      userId: authStore.userId,
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
    const target = batchAccessRulesDialog!.refreshTarget;
    const loaded = await refreshDirectory(target);
    if (!loaded) throw new Error(translator.current('files.batchRules.refreshFailed'));
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
        title: translator.current('files.ruleManagerTitle', { values: { name: objectName } }),
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
    const refreshTarget = captureDirectoryRefreshTarget();
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
      status = translator.current('files.accessRulesSaved');
      await refreshDirectory(refreshTarget);
    } catch (err) {
      error = formatError(err);
      accessRulesDialog = { ...dialog, saving: false };
    }
  }

  async function handleUploadNewVersion(doc: ServerDocumentEntry) {
    const refreshTarget = captureDirectoryRefreshTarget();
    let selected: string | null;
    try {
      selected = await open({
        multiple: false,
        directory: false,
        pickerMode: 'document',
        fileAccessMode: 'scoped',
        title: translator.current('files.selectRevisionFile'),
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
        notificationStore.info(translator.current('files.uploadRevisionStarted'), 2500);
        await uploadNewRevision(doc.id, selected);
        await refreshDirectory(refreshTarget);
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
        title: translator.current('files.revisionsFor', { values: { name: doc.title } }),
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
      status = translator.current('files.revisionDownloaded');
    });
  }

  async function handleSetCurrentRevision(revision: RevisionEntry) {
    if (!revisionsDialog || revision.is_current) return;
    const refreshTarget = captureDirectoryRefreshTarget();
    await runFileAction(async () => {
      await setCurrentRevision(revisionsDialog!.documentId, revision.id);
      await refreshRevisionsDialog();
      await refreshDirectory(refreshTarget);
      status = translator.current('files.setCurrentRevisionSuccess');
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
      status = favorite ? translator.current('files.favoriteAdded') : translator.current('files.favoriteRemoved');
    });
  }

  async function handleCreateFolder() {
    const refreshTarget = captureDirectoryRefreshTarget();
    const name = await dialogStore.prompt({
      title: translator.current('files.newFolder'),
      message: translator.current('files.newFolderPrompt'),
      confirmLabel: translator.current('files.createFolder'),
      cancelLabel: translator.current('common.cancel'),
    });
    if (!name || !name.trim()) return;
    try {
      await createDirectory(refreshTarget.folderId, name.trim(), true);
      await refreshDirectory(refreshTarget);
    } catch (e) {
      error = String(e);
    }
  }

  async function handleDeleteSelected() {
    if (totalSelected === 0 || batchBusy) return;
    const refreshTarget = captureDirectoryRefreshTarget();
    const progressId = 'files:batch-delete';
    const progressTitle = translator.current('files.batchDeleting');
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
      await refreshDirectory(refreshTarget);
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
      translator.current('files.batchProgress', { values: { current, total, percent } }),
      current,
      total,
    );
  }

  async function handleDownloadSelected() {
    if (totalSelected === 0 || batchBusy) return;
    batchBusy = true;
    error = null;
    try {
      await startDirectoryDownload([
        ...documents.filter(doc => selectedDocumentIds.has(doc.id)).map(doc => ({ id: doc.id, name: doc.title, kind: 'document' as const })),
        ...folders.filter(folder => selectedFolderIds.has(folder.id)).map(folder => ({ id: folder.id, name: folder.name, kind: 'directory' as const })),
      ], selectedItemsLabel, currentFolderId);
      clearSelection();
    } catch (e) { error = formatError(e); }
    finally { batchBusy = false; }
  }

  async function handleDownloadFolder(folder: ServerDirectoryEntry) {
    if (batchBusy) return;
    batchBusy = true;
    error = null;
    try { await startDirectoryDownload([{ id: folder.id, name: folder.name, kind: 'directory' }], folder.name || translator.current('tasks.folderBatch'), folder.id); }
    catch (e) { error = formatError(e); }
    finally { batchBusy = false; }
  }

  async function handleDeleteRevision(revision: RevisionEntry) {
    if (!revisionsDialog || revision.is_current) return;
    const refreshTarget = captureDirectoryRefreshTarget();
    if (!(await dialogStore.confirm({
      title: translator.current('files.deleteRevision'),
      message: translator.current('files.deleteRevisionConfirm', {
        values: { revision: shortIdentifier(revision.id) },
      }),
      confirmLabel: translator.current('common.delete'),
      cancelLabel: translator.current('common.cancel'),
      danger: true,
    }))) return;

    await runFileAction(async () => {
      await deleteRevision(revision.id);
      await refreshRevisionsDialog();
      await refreshDirectory(refreshTarget);
      status = translator.current('files.deleteRevisionSuccess');
    });
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
        title: translator.current('files.selectFilesToUpload'),
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
        title: translator.current('files.selectFolderToUpload'),
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
      notificationStore.warning(translator.current('files.dropUnsupported'));
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
      notificationStore.warning(translator.current('files.dropUnsupported'));
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
          title: translator.current('files.uploadConflictTitle'),
          message: translator.current('files.uploadConflictMessage'),
          detailLabel: translator.current('files.uploadConflictProgress', {
            values: { current: index + 1 },
          }),
          details: [{
            label: candidate.name,
            meta: candidate.relativePath
              ? translator.current('files.uploadConflictDirectoryFile', {
                values: { path: candidate.relativePath },
              })
              : translator.current('files.uploadConflictFile'),
            badge: translator.current('files.uploadConflictBadge'),
            kind: candidate.kind,
          }],
          applyToAllLabel: translator.current('files.uploadConflictApplyRemaining'),
          choices: [
            {
              value: 'overwrite',
              label: translator.current('files.uploadConflictOverwrite'),
              description: translator.current('files.uploadConflictOverwriteHint'),
              icon: 'refresh',
              intent: 'danger',
            },
            {
              value: 'keep_both',
              label: translator.current('files.uploadConflictKeepBoth'),
              description: translator.current('files.uploadConflictKeepBothHint'),
              icon: 'edit',
              intent: 'primary',
            },
            {
              value: 'skip',
              label: translator.current('files.uploadConflictSkip'),
              description: translator.current('files.uploadConflictSkipHint'),
              icon: 'block',
              intent: 'neutral',
            },
          ],
          cancelLabel: translator.current('common.cancel'),
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
    const batchName = breadcrumbSegments.at(-1)?.label ?? translator.current('files.rootDirectory');
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
      if (result.tasks.length > 1) notificationStore.success(
        translator.current('tasks.batchQueued', { values: { count: result.tasks.length } }),
        undefined,
        { action: { label: translator.current('tasks.viewTransfers'), onClick: () => { void goto('/home/tasks?tab=uploads'); } } },
      );
      if (result.failed.length) {
        error = translator.current('tasks.batchEnqueueFailed', { values: { count: result.failed.length } }) + '\n' + result.failed.map(item => `${requests.find(r => r.uploadId === item.id)?.fileName ?? item.id}: ${item.error}`).join('\n');
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
    return value?.length ? value.join(', ') : translator.current('common.none');
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
      searchPreview.error = translator.current('files.searchTypeRequired');
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
      ? translator.current('files.searchSortName')
      : field === 'size'
        ? translator.current('files.searchSortSize')
        : translator.current('files.searchSortModified');
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
      error = translator.current('files.searchQueryRequired');
      return;
    }
    if (!searchDialog.searchDocuments && !searchDialog.searchDirectories) {
      error = translator.current('files.searchTypeRequired');
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
    notificationStore.warning(translator.current('files.searchPermissionRequired'), 5000);
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
      userId: authStore.userId,
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
      status = translator.current('files.searchOpenedParent', { values: { name: document.name ?? document.title ?? '' } });
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
      ? translator.current('files.sortByName')
      : field === 'size'
        ? translator.current('files.sortBySize')
        : translator.current('files.sortByModified');
    const direction = sortField === field
      ? (sortDirection === 'asc' ? translator.current('files.ascending') : translator.current('files.descending'))
      : translator.current('files.notSorted');
    return `${label} · ${direction}`;
  }

  function handlePickerError(err: unknown) {
    const message = formatError(err);
    if (isPickerCancel(message)) return;

    error = message.includes('Folder picker is not implemented')
      ? translator.current('files.mobileFolderUploadUnsupported')
      : message;
  }

  onMount(() => {
    let unlisten: UnlistenFn | null = null;
    let unlistenDragDrop: UnlistenFn | null = null;
    let disposed = false;
    let unlistenUploads: UnlistenFn | null = null;
    let uploadRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    void listen<UploadTaskDto>('cfms:upload-task', ({ payload: task }) => {
      if (disposed || !['completed', 'skipped'].includes(task.status) || !sameDirectoryId(task.target_parent_id, currentFolderId)) return;
      const refreshTarget = captureDirectoryRefreshTarget();
      const refreshGeneration = directoryGeneration;
      clearTimeout(uploadRefreshTimer);
      uploadRefreshTimer = setTimeout(() => {
        if (!disposed && refreshGeneration === directoryGeneration) void refreshDirectory(refreshTarget);
      }, 250);
    }).then(stop => { if (disposed) stop(); else unlistenUploads = stop; });
    directorySorter = createProgressiveDirectorySorter(handleDirectorySnapshot, handleDirectorySorterError);
    const unregisterKeyboardCommands = registerKeyboardCommands([
      ...([-1, 1] as const).map((direction) => ({
        id: direction === -1 ? 'files.back' : 'files.forward',
        label: () => translator.current(direction === -1 ? 'files.goBack' : 'files.goForward'),
        group: () => translator.current('files.title'),
        shortcuts: [{ key: direction === -1 ? 'ArrowLeft' : 'ArrowRight', alt: true }],
        scope: 'page' as const,
        enabled: () => (direction === -1 ? canGoBack : canGoForward) && !navigationUnavailable && !hasBlockingFilesDialog(),
        handler: () => handleHistoryNavigate(direction),
      })),
      {
        id: 'files.find',
        label: () => translator.current('files.search'),
        group: () => translator.current('files.title'),
        shortcuts: [{ key: 'f', primary: true }],
        scope: 'page',
        enabled: () => canUseServerSearch && !hasBlockingFilesDialog(),
        allowInEditable: true,
        handler: handleFindShortcut,
      },
      {
        id: 'files.address',
        label: () => translator.current('files.editAddress'),
        group: () => translator.current('files.title'),
        shortcuts: [{ key: 'd', alt: true }, { key: 'F4' }],
        scope: 'page',
        enabled: () => nodeLookupEnabled && !navigationUnavailable && !hasBlockingFilesDialog(),
        allowInEditable: true,
        handler: () => { void addressBar?.beginEdit(); },
      },
      {
        id: 'files.parent',
        label: () => translator.current('files.parentDirectory'),
        group: () => translator.current('files.title'),
        shortcuts: [{ key: 'Backspace' }, { key: 'ArrowUp', alt: true }],
        scope: 'page',
        enabled: () => canGoToParent && !navigationUnavailable && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('go-parent', event),
      },
      {
        id: 'files.refresh',
        label: () => translator.current('common.refresh'),
        group: () => translator.current('files.title'),
        shortcuts: FILE_SHORTCUTS.refresh,
        scope: 'page',
        enabled: () => !navigationUnavailable && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('refresh', event),
      },
      {
        id: 'files.create-folder',
        label: () => translator.current('files.createFolder'),
        group: () => translator.current('files.title'),
        shortcuts: FILE_SHORTCUTS.createFolder,
        scope: 'page',
        enabled: () => !loading && !batchBusy && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('create-folder', event),
      },
      {
        id: 'files.select-all',
        label: () => translator.current('files.selectAll'),
        group: () => translator.current('files.title'),
        shortcuts: [{ key: 'a', primary: true }],
        scope: 'page',
        enabled: () => !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('select-all', event),
      },
      {
        id: 'files.clear-selection',
        label: () => translator.current('files.selectNone'),
        group: () => translator.current('files.title'),
        shortcuts: [{ key: 'Escape' }],
        scope: 'page',
        enabled: () => totalSelected > 0 && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('clear-selection', event),
      },
      {
        id: 'files.delete',
        label: () => translator.current('common.delete'),
        group: () => translator.current('files.title'),
        shortcuts: FILE_SHORTCUTS.delete,
        scope: 'page',
        enabled: () => totalSelected > 0 && canDeleteSelection() && !hasBlockingFilesDialog(),
        handler: (event) => executeFileManagerShortcut('delete-selection', event),
      },
      {
        id: 'files.rename',
        label: () => translator.current('files.rename'),
        group: () => translator.current('files.title'),
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
    const rememberedTimeline = fileManagerNavigationStore.restoreTimeline(navigationScope.serverAddress, navigationScope.userId);
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
      directoryRefresh.setBlocked(true);
      directoryRefresh.invalidate();
      clearRefreshErrorNotification();
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

  return {

    get SORT_FIELDS() { return SORT_FIELDS; },
    get accessEntriesDialog() { return accessEntriesDialog; },
    set accessEntriesDialog(value) { accessEntriesDialog = value; },
    get accessRulesDialog() { return accessRulesDialog; },
    set accessRulesDialog(value) { accessRulesDialog = value; },
    get addressBar() { return addressBar; },
    set addressBar(value) { addressBar = value; },
    get addressLookupError() { return addressLookupError; },
    set addressLookupError(value) { addressLookupError = value; },
    applyMarqueeSelection,
    get authorizeDialog() { return authorizeDialog; },
    set authorizeDialog(value) { authorizeDialog = value; },
    get batchAccessRulesDialog() { return batchAccessRulesDialog; },
    set batchAccessRulesDialog(value) { batchAccessRulesDialog = value; },
    batchAccessRulesGuard,
    get batchMoveDialog() { return batchMoveDialog; },
    set batchMoveDialog(value) { batchMoveDialog = value; },
    get breadcrumbSegments() { return breadcrumbSegments; },
    get canGoBack() { return canGoBack; },
    get canGoForward() { return canGoForward; },
    get canGoToParent() { return canGoToParent; },
    get canUseServerSearch() { return canUseServerSearch; },
    closeBatchAccessRules,
    closeSearchDialog,
    get contextMenu() { return contextMenu; },
    set contextMenu(value) { contextMenu = value; },
    get contextMenuItems() { return contextMenuItems; },
    get currentFolderId() { return currentFolderId; },
    set currentFolderId(value) { currentFolderId = value; },
    deselectAll,
    get detailModel() { return detailModel; },
    set detailModel(value) { detailModel = value; },
    get detailRows() { return detailRows; },
    set detailRows(value) { detailRows = value; },
    get detailTitle() { return detailTitle; },
    set detailTitle(value) { detailTitle = value; },
    get detailsOpen() { return detailsOpen; },
    set detailsOpen(value) { detailsOpen = value; },
    get directoryAccessDenied() { return directoryAccessDenied; },
    set directoryAccessDenied(value) { directoryAccessDenied = value; },
    get directoryLoadPhase() { return directoryLoadPhase; },
    set directoryLoadPhase(value) { directoryLoadPhase = value; },
    get directorySearchPlaceholder() { return directorySearchPlaceholder; },
    get documentAccessDenied() { return documentAccessDenied; },
    set documentAccessDenied(value) { documentAccessDenied = value; },
    get documentTagsDialog() { return documentTagsDialog; },
    set documentTagsDialog(value) { documentTagsDialog = value; },
    get documents() { return documents; },
    set documents(value) { documents = value; },
    get dragUploadActive() { return dragUploadActive; },
    set dragUploadActive(value) { dragUploadActive = value; },
    get fileCommandActions() { return fileCommandActions; },
    get fileTable() { return fileTable; },
    set fileTable(value) { fileTable = value; },
    get fileTableResetKey() { return fileTableResetKey; },
    set fileTableResetKey(value) { fileTableResetKey = value; },
    get folders() { return folders; },
    set folders(value) { folders = value; },
    handleAddressBeginEdit,
    handleAddressCancel,
    handleAddressSubmit,
    handleBatchMoveToTarget,
    handleBreadcrumbNavigate,
    handleDeleteRevision,
    handleDocumentActivate,
    handleDocumentClick,
    handleDownloadRevision,
    handleDragSelection,
    handleDropMove,
    handleFileRowKeydown,
    handleFolderActivate,
    handleFolderClick,
    handleGoToParent,
    handleHistoryNavigate,
    handleHtmlDragEnter,
    handleHtmlDragLeave,
    handleHtmlDragOver,
    handleHtmlDrop,
    handleMoveToTarget,
    handleReturnFromDeniedDirectory,
    handleRevokeAccess,
    handleSaveAccessRules,
    handleSearchInput,
    handleSearchKeydown,
    handleSearchPreviewScroll,
    handleSetCurrentRevision,
    handleSubmitAuthorize,
    hasPermission,
    hideContextMenu,
    get knownAddressPath() { return knownAddressPath; },
    loadDirectory,
    get loading() { return loading; },
    set loading(value) { loading = value; },
    get marqueeSelectionEnabled() { return marqueeSelectionEnabled; },
    set marqueeSelectionEnabled(value) { marqueeSelectionEnabled = value; },
    get moveInitialBreadcrumb() { return moveInitialBreadcrumb; },
    get moveTargetDialog() { return moveTargetDialog; },
    set moveTargetDialog(value) { moveTargetDialog = value; },
    navigateToSearchDirectory,
    navigateToSearchDocument,
    get navigationRootId() { return navigationRootId; },
    set navigationRootId(value) { navigationRootId = value; },
    get navigationUnavailable() { return navigationUnavailable; },
    get nodeLookupEnabled() { return nodeLookupEnabled; },
    openSearchDialog,
    openSearchPreview,
    refreshAfterBatchAccessRules,
    refreshDocumentTagsEditorData,
    retryDirectoryLoad,
    get revisionGraphWidth() { return revisionGraphWidth; },
    get revisionRows() { return revisionRows; },
    get revisionsDialog() { return revisionsDialog; },
    set revisionsDialog(value) { revisionsDialog = value; },
    runServerSearch,
    saveDocumentTags,
    get searchDialog() { return searchDialog; },
    set searchDialog(value) { searchDialog = value; },
    get searchDialogInput() { return searchDialogInput; },
    set searchDialogInput(value) { searchDialogInput = value; },
    get searchDialogResetKey() { return searchDialogResetKey; },
    get searchInput() { return searchInput; },
    set searchInput(value) { searchInput = value; },
    get searchPreview() { return searchPreview; },
    set searchPreview(value) { searchPreview = value; },
    get searchPreviewActiveIndex() { return searchPreviewActiveIndex; },
    set searchPreviewActiveIndex(value) { searchPreviewActiveIndex = value; },
    get searchPreviewCanSearch() { return searchPreviewCanSearch; },
    get searchPreviewHasQuery() { return searchPreviewHasQuery; },
    get searchPreviewPanelStyle() { return searchPreviewPanelStyle; },
    set searchPreviewPanelStyle(value) { searchPreviewPanelStyle = value; },
    get searchPreviewResetKey() { return searchPreviewResetKey; },
    get searchPreviewRoot() { return searchPreviewRoot; },
    set searchPreviewRoot(value) { searchPreviewRoot = value; },
    get searchPreviewRows() { return searchPreviewRows; },
    get searchQuery() { return searchQuery; },
    set searchQuery(value) { searchQuery = value; },
    searchResultDate,
    get searchResultRows() { return searchResultRows; },
    get searchRowHeight() { return searchRowHeight; },
    searchSortLabel,
    get selectMode() { return selectMode; },
    set selectMode(value) { selectMode = value; },
    get selectedDocumentIds() { return selectedDocumentIds; },
    set selectedDocumentIds(value) { selectedDocumentIds = value; },
    get selectedFolderIds() { return selectedFolderIds; },
    set selectedFolderIds(value) { selectedFolderIds = value; },
    get selectedItemsLabel() { return selectedItemsLabel; },
    setSearchDialogSort,
    setSearchPreviewSort,
    setSort,
    showCurrentDirectoryContextMenu,
    showDocumentContextMenu,
    showFilesPageBlankContextMenu,
    showFolderContextMenu,
    get sortDirection() { return sortDirection; },
    set sortDirection(value) { sortDirection = value; },
    get sortField() { return sortField; },
    set sortField(value) { sortField = value; },
    sortFieldIcon,
    sortIcon,
    sortTitle,
    get statusBarPrimary() { return statusBarPrimary; },
    get statusBarSecondary() { return statusBarSecondary; },
    toggleSearchDialogSortOrder,
    toggleSearchPreviewSortOrder,
    updateSearchPreviewOptions,
    get uploadProgress() { return uploadProgress; },
    set uploadProgress(value) { uploadProgress = value; },

  };

}

export type FileWorkspaceController = ReturnType<typeof createFileWorkspace>;
