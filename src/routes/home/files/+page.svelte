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
  import { open } from '@tauri-apps/plugin-dialog';
  import { _ as t } from 'svelte-i18n';
  import {
    listDirectory,
    loadUserPreference,
    getDocument,
    getRevision,
    createDirectory,
    deleteDirectory,
    deleteDocument,
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
    searchFiles,
    selectUploadDirectory,
    uploadDirectory,
    uploadDocumentFile,
    uploadNewRevision,
    viewAccessEntries,
    type AccessEntry,
    type RevisionEntry,
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
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import MdCheckbox from '$lib/components/MdCheckbox.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import MoveTargetDialog from '$lib/components/MoveTargetDialog.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import { accessEntrySubject } from '$lib/access-entries';
  import type { AccessGrantFormValue } from '$lib/access-grants';
  import type { AccessRulesRecord } from '$lib/access-rules';
  import type { ContextMenuItem } from '$lib/components/context-menu';
  import { dialogStore } from '$lib/dialogs.svelte';
  import { normalizeDirectoryId, type DirectoryBreadcrumbSegment } from '$lib/file-browser';
  import {
    directoryToRecord,
    documentToRecord,
    type FilePreferenceScope,
    type FileRecord,
    isFavoriteRecord,
    rememberVisit,
    setFavoriteRecord,
  } from '$lib/file-preferences';
  import { shortIdentifier } from '$lib/identifiers';
  import { authStore, notificationStore, serverStateStore, uploadStore } from '$lib/stores.svelte';

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
  type SortField = 'name' | 'size' | 'modified';
  type SortDirection = 'asc' | 'desc';
  let sortField = $state<SortField>('name');
  let sortDirection = $state<SortDirection>('asc');

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
  let uploadProgress = $state<{
    documentId: string;
    taskId: string;
    currentBytes: number;
    totalBytes: number;
    progress: number;
  } | null>(null);
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
  const uploadActiveCount = $derived(uploadStore.activeTasks.length);
  const canGoToParent = $derived(parentId !== null);

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

  async function loadDirectory(folderId: string | null, preserveOnError = false): Promise<boolean> {
    loading = true;
    error = null;
    selectedFolderIds = new Set();
    selectedDocumentIds = new Set();
    try {
      const normalizedFolderId = normalizeDirectoryId(folderId);
      const resp = await listDirectory(normalizedFolderId);
      currentFolderId = normalizedFolderId;
      folders = resp.folders;
      documents = resp.documents;
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
    if (sameDirectory(targetId, navigationRootId)) {
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
    if (parentId === null) return;
    const targetParentId = parentId;
    const shouldRebaseNavigationRoot =
      navigationRootId !== null
      && navHistory.length === 0
      && sameDirectory(currentFolderId, navigationRootId);

    // Pop the last breadcrumb entry when moving within the known path. If the
    // current directory was opened as a custom root, rebase that root upward.
    const ok = await loadDirectory(targetParentId);
    if (ok && navHistory.length > 0) {
      navHistory = navHistory.slice(0, -1);
    } else if (ok && shouldRebaseNavigationRoot) {
      navigationRootId = targetParentId;
      navigationRootLabel = shortIdentifier(targetParentId);
    }
  }

  function sameDirectory(a: string | null | undefined, b: string | null | undefined) {
    return normalizeDirectoryId(a) === normalizeDirectoryId(b);
  }

  async function handleJumpToDirectory() {
    const value = await dialogStore.prompt({
      title: $t('files.jumpToDirectory'),
      message: $t('files.jumpToDirectoryPrompt'),
      defaultValue: currentFolderId ?? '/',
      confirmLabel: $t('common.open'),
      cancelLabel: $t('common.cancel'),
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
    selectedFolderIds = new Set(filteredFolders.map((folder) => folder.id));
    selectedDocumentIds = new Set(filteredDocuments.map((doc) => doc.id));
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
        { label: $t('files.accessRules'), value: formatUnknown(info.info_code ? null : info.access_rules) },
      ];
    });
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
    if (totalSelected === 0) return;
    try {
      for (const id of selectedFolderIds) {
        await deleteDirectory(id);
      }
      for (const id of selectedDocumentIds) {
        await deleteDocument(id);
      }
      clearSelection();
      await loadDirectory(currentFolderId);
    } catch (e) {
      error = String(e);
    }
  }

  async function handleDownloadSelected() {
    if (totalSelected === 0 || batchBusy) return;
    batchBusy = true;
    error = null;

    const selectedDocuments = documents.filter((doc) => selectedDocumentIds.has(doc.id));
    const selectedFolders = folders.filter((folder) => selectedFolderIds.has(folder.id));
    let queued = 0;
    let failed = 0;

    try {
      for (const doc of selectedDocuments) {
        try {
          await queueDocumentDownload(doc, []);
          queued += 1;
        } catch {
          failed += 1;
        }
      }

      for (const folder of selectedFolders) {
        try {
          const result = await queueDirectoryDownloads(folder, [folder.name]);
          queued += result.queued;
          failed += result.failed;
        } catch {
          failed += 1;
        }
      }

      if (queued > 0) {
        status = $t('files.batchDownloadQueued', { values: { count: queued } });
      }
      if (failed > 0) {
        error = $t('files.batchDownloadPartialFailed', { values: { count: failed } });
      }
      if (queued > 0 && failed === 0) clearSelection();
    } finally {
      batchBusy = false;
    }
  }

  async function queueDocumentDownload(
    doc: Pick<ServerDocumentEntry, 'id' | 'title'>,
    pathParts: string[],
  ) {
    await getDocument(doc.id, makeDownloadFilename([...pathParts, doc.title]));
  }

  async function queueDirectoryDownloads(
    folder: Pick<ServerDirectoryEntry, 'id' | 'name'>,
    pathParts: string[],
  ): Promise<{ queued: number; failed: number }> {
    const response = await listDirectory(folder.id);
    let queued = 0;
    let failed = 0;

    for (const doc of response.documents) {
      try {
        await queueDocumentDownload(doc, pathParts);
        queued += 1;
      } catch {
        failed += 1;
      }
    }

    for (const child of response.folders) {
      try {
        const result = await queueDirectoryDownloads(child, [...pathParts, child.name]);
        queued += result.queued;
        failed += result.failed;
      } catch {
        failed += 1;
      }
    }

    return { queued, failed };
  }

  function makeDownloadFilename(parts: string[]) {
    return parts
      .filter(Boolean)
      .map((part) => part.replace(/[\\/:*?"<>|]+/g, ' ').trim())
      .filter(Boolean)
      .join(' - ');
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
    notificationStore.info($t('files.uploadQueued', { values: { count: files.length } }));
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

  function basename(path: string) {
    if (path.includes('://')) {
      try {
        const url = new URL(path);
        const candidate = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '');
        if (candidate) return candidate;
      } catch {
        // Fall through to plain path parsing.
      }
    }
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  }

  function uploadDisplayName(path: string) {
    return stripUploadCachePrefix(basename(path));
  }

  function stripUploadCachePrefix(name: string) {
    return name
      .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_/i, '')
      .replace(/^[0-9a-f]{32}_/i, '')
      .replace(/^\d{10,}[-_][0-9a-f]{6,}[-_]/i, '');
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
    goto('/home/trash');
  }

  function setSort(field: SortField) {
    if (sortField === field) {
      sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }
    sortField = field;
    sortDirection = field === 'name' ? 'asc' : 'desc';
  }

  function sortIcon(field: SortField) {
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

  function sortedFolders(input: ServerDirectoryEntry[]) {
    return [...input].sort((a, b) => compareEntries(
      {
        name: a.name,
        size: 0,
        modified: a.created_time ?? 0,
      },
      {
        name: b.name,
        size: 0,
        modified: b.created_time ?? 0,
      },
    ));
  }

  function sortedDocuments(input: ServerDocumentEntry[]) {
    return [...input].sort((a, b) => compareEntries(
      {
        name: a.title,
        size: a.size ?? 0,
        modified: a.last_modified ?? 0,
      },
      {
        name: b.title,
        size: b.size ?? 0,
        modified: b.last_modified ?? 0,
      },
    ));
  }

  function compareEntries(
    a: { name: string; size: number; modified: number },
    b: { name: string; size: number; modified: number },
  ) {
    const sign = sortDirection === 'asc' ? 1 : -1;
    if (sortField === 'name') {
      return sign * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (sortField === 'size') {
      return sign * ((a.size - b.size) || a.name.localeCompare(b.name));
    }
    return sign * ((a.modified - b.modified) || a.name.localeCompare(b.name));
  }

  // --- Formatting helpers ---

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '—';
    const k = 1024;
    const sizes = ['B', 'KiB', 'MiB', 'GiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
  }

  function formatDate(ts: number | null): string {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString();
  }

  function formatUnknown(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  }

  function formatError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  function handlePickerError(err: unknown) {
    const message = formatError(err);
    if (isPickerCancel(message)) return;

    error = message.includes('Folder picker is not implemented')
      ? $t('files.mobileFolderUploadUnsupported')
      : message;
  }

  function isPickerCancel(message: string) {
    const normalized = message.toLowerCase();
    return normalized.includes('cancelled')
      || normalized.includes('canceled')
      || normalized.includes('cancel')
      || normalized.includes('no folder was selected');
  }

  interface RevisionGraphRow {
    revision: RevisionEntry;
    lane: number;
    laneCount: number;
    before: Array<string | null>;
    after: Array<string | null>;
    parentLane: number | null;
    hasChildren: boolean;
    hasBranch: boolean;
    hasMerge: boolean;
  }

  function buildRevisionRows(entries: RevisionEntry[]): RevisionGraphRow[] {
    const sorted = [...entries].sort((a, b) => {
      const at = a.created_time ?? 0;
      const bt = b.created_time ?? 0;
      if (bt !== at) return bt - at;
      return String(b.id).localeCompare(String(a.id));
    });
    const childCount = new Map<string, number>();
    for (const entry of sorted) {
      if (entry.parent_id !== null && entry.parent_id !== undefined) {
        const parentKey = String(entry.parent_id);
        childCount.set(parentKey, (childCount.get(parentKey) ?? 0) + 1);
      }
    }

    let lanes: Array<string | null> = [];
    const rows: RevisionGraphRow[] = [];

    for (const revision of sorted) {
      const revisionId = String(revision.id);
      let lane = lanes.findIndex((id) => id === revisionId);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(revisionId);
      }

      const before = [...lanes];
      let after = [...lanes];
      let parentLane: number | null = null;
      const parentId = revision.parent_id === null || revision.parent_id === undefined
        ? null
        : String(revision.parent_id);

      if (parentId !== null) {
        const existingParentLane = after.findIndex((id, index) => index !== lane && id === parentId);
        if (existingParentLane >= 0) {
          after.splice(lane, 1);
          parentLane = existingParentLane > lane ? existingParentLane - 1 : existingParentLane;
        } else {
          after[lane] = parentId;
          parentLane = lane;
        }
      } else {
        after.splice(lane, 1);
        parentLane = null;
      }

      const laneCount = Math.max(before.length, after.length, lane + 1, 1);
      const children = childCount.get(revisionId) ?? 0;
      rows.push({
        revision,
        lane,
        laneCount,
        before,
        after,
        parentLane,
        hasChildren: children > 0,
        hasBranch: children > 1,
        hasMerge: parentLane !== null && parentLane !== lane,
      });
      lanes = after;
    }

    return rows;
  }

  function graphWidth(row: RevisionGraphRow): number {
    return row.laneCount * 24 + 16;
  }

  function laneX(lane: number): number {
    return lane * 24 + 12;
  }

  function graphLineColor(id: string | null | undefined): string {
    if (id === null || id === undefined) return 'var(--color-md3-outline)';
    const colors = ['#4ea1ff', '#c084fc', '#34d399', '#f59e0b', '#fb7185'];
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return colors[hash % colors.length];
  }

  // --- Init ---

  onMount(() => {
    let unlisten: UnlistenFn | null = null;
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
    };
  });

  // --- Display lists ---

  const filteredFolders = $derived.by(() => sortedFolders(folders));
  const filteredDocuments = $derived.by(() => sortedDocuments(documents));
</script>

<div class="p-6 space-y-4">
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
        disabled={totalSelected === 0}
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

  <!-- Loading -->
  {#if loading}
    <div class="flex items-center gap-2 text-sm text-md3-on-surface-variant">
      <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
      {$t('common.loadingEllipsis')}
    </div>
  {/if}

  <!-- File list -->
  {#if !loading}
    <div class="overflow-x-auto rounded-xl border border-md3-outline bg-md3-surface-container/70 backdrop-blur-sm">
      <div class="min-w-[620px] overflow-hidden">
        <!-- Header -->
        <div class="grid grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 px-4 py-2.5
                  bg-md3-surface-container-high/50
                  text-xs font-medium text-md3-on-surface-variant
                  uppercase tracking-wider
                  border-b border-md3-outline"
           style="font-family: var(--font-md3-sans);">
        <span aria-hidden="true"></span>
        <button
          type="button"
          class="flex min-w-0 items-center gap-1 text-left uppercase transition-colors hover:text-md3-on-surface"
          title={sortTitle('name')}
          onclick={() => setSort('name')}
        >
          <span class="select-none">{$t('files.name')}</span>
          <Icon name={sortIcon('name')} size="15px" />
        </button>
        <button
          type="button"
          class="flex items-center justify-end gap-1 text-right uppercase transition-colors hover:text-md3-on-surface"
          title={sortTitle('size')}
          onclick={() => setSort('size')}
        >
          <span class="select-none">{$t('files.size')}</span>
          <Icon name={sortIcon('size')} size="15px" />
        </button>
        <button
          type="button"
          class="flex items-center justify-end gap-1 text-right uppercase transition-colors hover:text-md3-on-surface"
          title={sortTitle('modified')}
          onclick={() => setSort('modified')}
        >
          <span class="select-none">{$t('files.modified')}</span>
          <Icon name={sortIcon('modified')} size="15px" />
        </button>
        </div>

        {#if filteredFolders.length === 0 && filteredDocuments.length === 0 && !canGoToParent}
          <p class="px-4 py-12 text-center text-sm text-md3-on-surface-variant">
            {$t('files.empty')}
          </p>
        {/if}

        {#if canGoToParent}
          <button
            class="grid w-full grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 px-4 py-2.5 text-left
                 border-md3-outline/50
                 text-md3-primary-emphasis
                 hover:bg-md3-primary-container/20
                 transition-colors select-none"
            class:border-b={filteredFolders.length > 0 || filteredDocuments.length > 0}
            onclick={handleGoToParent}
          >
            <span class="self-center text-md3-primary-emphasis" aria-hidden="true">
              <Icon name="arrowUpward" size="20px" />
            </span>
            <span class="text-sm font-medium truncate">
              {$t('files.parentDirectory')}
            </span>
            <span class="text-xs text-md3-on-surface-variant text-right self-center">—</span>
            <span class="text-xs text-md3-on-surface-variant text-right self-center">—</span>
          </button>
        {/if}

        <!-- Folders -->
        {#each filteredFolders as folder (folder.id)}
          <button
            class="grid w-full grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 px-4 py-2.5 text-left
                 hover:bg-md3-primary-container/20
                 border-b border-md3-outline/50
                 transition-colors select-none"
            onclick={() => handleFolderClick(folder)}
            oncontextmenu={(e) => showFolderContextMenu(e, folder)}
          >
          {#if selectMode}
            <span
              class="self-center {selectedFolderIds.has(folder.id) ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}"
              aria-hidden="true"
            >
              <Icon name={selectedFolderIds.has(folder.id) ? 'checkBox' : 'checkBoxBlank'} size="22px" />
            </span>
          {:else}
            <span class="self-center text-md3-primary-emphasis">
              <Icon name="folder" size="20px" />
            </span>
          {/if}
          <span class="text-sm font-medium text-md3-primary-emphasis truncate">
            {folder.name}
          </span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">—</span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">
            {formatDate(folder.created_time)}
          </span>
          </button>
        {/each}

        <!-- Documents / Files -->
        {#each filteredDocuments as doc (doc.id)}
          <button
            class="grid w-full grid-cols-[auto_minmax(260px,1fr)_100px_160px] gap-3 px-4 py-2.5 text-left
                 hover:bg-md3-surface-container-high/30
                 border-b border-md3-outline/50 last:border-b-0
                 transition-colors select-none"
            onclick={() => handleDocumentClick(doc)}
            oncontextmenu={(e) => showDocumentContextMenu(e, doc)}
          >
          {#if selectMode}
            <span
              class="self-center {selectedDocumentIds.has(doc.id) ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}"
              aria-hidden="true"
            >
              <Icon name={selectedDocumentIds.has(doc.id) ? 'checkBox' : 'checkBoxBlank'} size="22px" />
            </span>
          {:else}
            <span class="self-center text-md3-on-surface-variant">
              <Icon name="filePresent" size="20px" />
            </span>
          {/if}
          <span class="text-sm text-md3-on-surface truncate">
            {doc.title}
          </span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">
            {formatBytes(doc.size)}
          </span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">
            {formatDate(doc.last_modified)}
          </span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

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
          {#each searchDialog.results.directories as directory (directory.id)}
            <button
              type="button"
              class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-md3-outline/50 px-3 py-2 text-left transition-colors hover:bg-md3-primary-container/20"
              onclick={() => navigateToSearchDirectory(directory)}
            >
              <span class="text-md3-primary-emphasis"><Icon name="folder" size="20px" /></span>
              <span class="min-w-0 truncate text-sm font-medium text-md3-primary-emphasis">{directory.name}</span>
              <span class="text-xs text-md3-on-surface-variant">{formatDate(directory.created_time)}</span>
            </button>
          {/each}
          {#each searchDialog.results.documents as document (document.id)}
            <button
              type="button"
              class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-md3-outline/50 px-3 py-2 text-left transition-colors hover:bg-md3-surface-container-high/40 last:border-b-0"
              onclick={() => navigateToSearchDocument(document)}
            >
              <span class="text-md3-on-surface-variant"><Icon name="filePresent" size="20px" /></span>
              <span class="min-w-0 truncate text-sm text-md3-on-surface">{document.name ?? document.title}</span>
              <span class="text-xs text-md3-on-surface-variant">{formatBytes(document.size ?? 0)}</span>
            </button>
          {/each}
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
