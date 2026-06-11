<script lang="ts">
  // File Manager page
  //
  // Browses files and folders on the CFMS server via the `list_directory`
  // and `get_document` actions sent over the active WSS connection.
  //
  // Reference: get_directory / get_document in reference/src/include/ui/util/path.py

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { open } from '@tauri-apps/plugin-dialog';
  import { _ as t } from 'svelte-i18n';
  import {
    listDirectory,
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
    uploadDirectory,
    uploadDocumentFile,
    uploadNewRevision,
    viewAccessEntries,
    type AccessEntry,
    type RevisionEntry,
    type SearchFilesResponse,
    type UploadRevisionProgressEvent,
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
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import type { AccessGrantFormValue } from '$lib/access-grants';
  import type { AccessRulesRecord } from '$lib/access-rules';
  import type { ContextMenuItem } from '$lib/components/context-menu';
  import { dialogStore } from '$lib/dialogs.svelte';
  import { authStore, notificationStore, uploadStore } from '$lib/stores.svelte';

  // --- Navigation state ---
  let currentFolderId = $state<string | null>(null);
  let folders = $state<ServerDirectoryEntry[]>([]);
  let documents = $state<ServerDocumentEntry[]>([]);
  let parentId = $state<string | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let status = $state<string | null>(null);
  let searchQuery = $state('');
  let uploadSchedule = Promise.resolve();

  // Selection mode
  let selectMode = $state(false);
  let selectedFolderIds = $state<Set<string>>(new Set());
  let selectedDocumentIds = $state<Set<string>>(new Set());

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
    navHistory.map((h) => ({ label: h.label, path: h.id })),
  );
  const contextMenuItems = $derived.by<ContextMenuItem[]>(() => getContextMenuItems());
  const revisionRows = $derived(
    revisionsDialog ? buildRevisionRows(revisionsDialog.entries) : [],
  );
  const uploadActiveCount = $derived(uploadStore.activeTasks.length);

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

  async function loadDirectory(folderId: string | null) {
    loading = true;
    error = null;
    currentFolderId = folderId;
    selectedFolderIds = new Set();
    selectedDocumentIds = new Set();
    try {
      const resp = await listDirectory(folderId);
      folders = resp.folders;
      documents = resp.documents;
      parentId = resp.parent_id;
    } catch (e) {
      error = String(e);
      folders = [];
      documents = [];
      parentId = null;
    } finally {
      loading = false;
    }
  }

  // --- Navigation ---

  function handleNavigate(folderId: string, folderName: string) {
    navHistory.push({ label: folderName, id: folderId });
    loadDirectory(folderId);
  }

  function handleBreadcrumbNavigate(targetId: string) {
    // "/" means root
    if (targetId === '/') {
      navHistory = [];
      loadDirectory(null);
      return;
    }
    // Truncate history to the clicked segment
    const idx = navHistory.findIndex((h) => h.id === targetId);
    if (idx >= 0) {
      navHistory = navHistory.slice(0, idx + 1);
    }
    loadDirectory(targetId);
  }

  function handleGoToParent() {
    // Pop the last entry and navigate to its parent
    if (navHistory.length > 0) {
      navHistory.pop();
    }
    loadDirectory(parentId);
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

  function toggleSelectMode() {
    selectMode = !selectMode;
    if (!selectMode) clearSelection();
  }

  const totalSelected = $derived(selectedFolderIds.size + selectedDocumentIds.size);

  // --- Download ---

  async function handleDownload(doc: ServerDocumentEntry) {
    try {
      await getDocument(doc.id, doc.title);
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
      return [
        {
          id: 'download-document',
          label: $t('common.download'),
          icon: 'download',
          onSelect: () => handleDownload(doc),
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
    return [
      {
        id: 'open-folder',
        label: $t('common.open'),
        icon: 'folderOpen',
        onSelect: () => handleNavigate(folder.id, folder.name),
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
    const name = kind === 'folder'
      ? (item as ServerDirectoryEntry).name
      : (item as ServerDocumentEntry).title;
    const confirmed = await dialogStore.confirm({
      title: $t('common.delete'),
      message: $t('files.deleteConfirm', { values: { name } }),
      confirmLabel: $t('common.delete'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    });
    if (!confirmed) return;

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
    const target = await promptTargetFolderId();
    if (target === undefined) return;
    await runFileAction(async () => {
      await moveDocument(doc.id, target);
      status = $t('files.moved');
      await loadDirectory(currentFolderId);
    });
  }

  async function handleMoveFolder(folder: ServerDirectoryEntry) {
    const target = await promptTargetFolderId();
    if (target === undefined) return;
    if (target === folder.id) {
      error = $t('files.moveSelfError');
      return;
    }
    await runFileAction(async () => {
      await moveDirectory(folder.id, target);
      status = $t('files.moved');
      await loadDirectory(currentFolderId);
    });
  }

  async function promptTargetFolderId(): Promise<string | null | undefined> {
    const target = await dialogStore.prompt({
      title: $t('files.move'),
      message: $t('files.movePrompt'),
      defaultValue: currentFolderId ?? '',
      confirmLabel: $t('files.move'),
      cancelLabel: $t('common.cancel'),
    });
    if (target === null) return undefined;
    const trimmed = target.trim();
    return trimmed === '' || trimmed === '/' ? null : trimmed;
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
    const selected = await open({
      multiple: false,
      directory: false,
      title: $t('files.selectRevisionFile'),
    });
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
    const confirmed = await dialogStore.confirm({
      title: $t('common.delete'),
      message: $t('files.deleteSelectedConfirm', { values: { count: totalSelected } }),
      confirmLabel: $t('common.delete'),
      cancelLabel: $t('common.cancel'),
      danger: true,
    });
    if (!confirmed) return;
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

  async function handleUploadFiles() {
    const selected = await open({
      multiple: true,
      directory: false,
      title: $t('files.selectFilesToUpload'),
    });
    if (!selected) return;
    const files = Array.isArray(selected) ? selected : [selected];
    if (files.length === 0) return;

    const targetFolderId = currentFolderId;
    notificationStore.info($t('files.uploadQueued', { values: { count: files.length } }));
    for (const filePath of files) {
      scheduleUpload(filePath, (uploadId) => uploadDocumentFile(targetFolderId, filePath, uploadId));
    }
  }

  async function handleUploadFolder() {
    const selected = await open({
      multiple: false,
      directory: true,
      title: $t('files.selectFolderToUpload'),
    });
    if (!selected || Array.isArray(selected)) return;

    const targetFolderId = currentFolderId;
    scheduleUpload(selected, (uploadId) => uploadDirectory(targetFolderId, selected, uploadId));
  }

  function scheduleUpload(sourcePath: string, action: (uploadId: string) => Promise<unknown>) {
    const uploadId = createUploadId();
    uploadStore.addQueued(uploadId, basename(sourcePath), sourcePath);
    uploadSchedule = uploadSchedule
      .then(async () => {
        try {
          await action(uploadId);
          await loadDirectory(currentFolderId);
        } catch (e) {
          uploadStore.markFailed(uploadId, formatError(e));
          error = formatError(e);
        }
      })
      .catch((e) => {
        uploadStore.markFailed(uploadId, formatError(e));
      });
  }

  function createUploadId() {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function basename(path: string) {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
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

  function navigateToSearchDirectory(directory: { id: string; name: string }) {
    navHistory = [{ label: directory.name, id: directory.id }];
    closeSearchDialog();
    loadDirectory(directory.id);
  }

  function navigateToSearchDocument(document: { parent_id?: string | null; name?: string; title?: string }) {
    navHistory = [];
    closeSearchDialog();
    loadDirectory(document.parent_id ?? null);
    status = $t('files.searchOpenedParent', { values: { name: document.name ?? document.title ?? '' } });
  }

  function handleNavigateTrash() {
    goto('/home/trash');
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
    loadDirectory(null);
    return () => {
      if (unlisten) unlisten();
    };
  });

  // --- Display lists ---

  const filteredFolders = $derived(folders);
  const filteredDocuments = $derived(documents);
</script>

<div class="p-6 space-y-4">
  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    {$t('files.title')}
  </h1>

  <!-- Top toolbar -->
  <div class="flex flex-wrap items-center gap-2">
    <!-- Create folder -->
    <button
      class="px-3 py-1.5 text-xs rounded-full font-medium
             bg-md3-surface-container-high text-md3-on-surface-variant
             hover:brightness-110 transition-all flex items-center gap-1.5"
      style="font-family: var(--font-md3-sans);"
      title={$t('files.createFolder')}
      onclick={handleCreateFolder}
    >
      <Icon name="createNewFolder" size="16px" />
      {$t('files.newFolder')}
    </button>

    <button
      class="px-3 py-1.5 text-xs rounded-full font-medium
             bg-md3-surface-container-high text-md3-on-surface-variant
             hover:brightness-110 transition-all flex items-center gap-1.5"
      style="font-family: var(--font-md3-sans);"
      title={$t('files.uploadFiles')}
      onclick={handleUploadFiles}
    >
      <Icon name="uploadFile" size="16px" />
      {$t('files.uploadFiles')}
    </button>

    <button
      class="px-3 py-1.5 text-xs rounded-full font-medium
             bg-md3-surface-container-high text-md3-on-surface-variant
             hover:brightness-110 transition-all flex items-center gap-1.5"
      style="font-family: var(--font-md3-sans);"
      title={$t('files.uploadFolder')}
      onclick={handleUploadFolder}
    >
      <Icon name="folderUpload" size="16px" />
      {$t('files.uploadFolder')}
      {#if uploadActiveCount > 0}
        <span class="rounded-full bg-md3-primary px-1.5 text-[10px] text-md3-on-primary">{uploadActiveCount}</span>
      {/if}
    </button>

    <!-- Selection mode toggle -->
    <button
      class="px-3 py-1.5 text-xs rounded-full font-medium
             {selectMode
               ? 'bg-md3-primary-container text-md3-on-primary-container'
               : 'bg-md3-surface-container-high text-md3-on-surface-variant'}
             hover:brightness-110 transition-all flex items-center gap-1.5"
      style="font-family: var(--font-md3-sans);"
      onclick={toggleSelectMode}
    >
      <Icon name="checklist" size="16px" />
      {$t('files.select')}
    </button>

    <!-- Trash -->
    <button
      class="px-3 py-1.5 text-xs rounded-full font-medium
             bg-md3-surface-container-high text-md3-on-surface-variant
             hover:brightness-110 transition-all flex items-center gap-1.5"
      style="font-family: var(--font-md3-sans);"
      title={$t('files.recycleBin')}
      onclick={handleNavigateTrash}
    >
      <Icon name="deleteSweep" size="16px" />
      {$t('files.trash')}
    </button>

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
        class="px-3 py-1.5 text-xs rounded-full font-medium
               bg-md3-primary-container text-md3-on-primary-container
               hover:brightness-110 transition-all flex items-center gap-1"
        style="font-family: var(--font-md3-sans);"
      >
        <Icon name="search" size="16px" />
        {$t('files.serverSearch')}
      </button>
    </form>

    <!-- Refresh -->
    <button
      class="p-1.5 rounded-full text-md3-on-surface-variant
             hover:bg-md3-surface-container-high transition-colors"
      onclick={() => loadDirectory(currentFolderId)}
      title={$t('common.refresh')}
    >
      <Icon name="refresh" size="20px" />
    </button>
  </div>

  <!-- Selection toolbar -->
  {#if selectMode && totalSelected > 0}
    <div class="flex items-center gap-2 bg-md3-primary-container/30 rounded-xl
                border border-md3-primary/20 px-3 py-2">
      <span class="text-xs text-md3-on-surface-variant">
        {$t('files.selected', { values: { count: totalSelected } })}
      </span>
      <button
        class="px-2.5 py-1 text-xs rounded-full font-medium
               bg-md3-error-container text-md3-on-error-container
               hover:brightness-110 transition-all flex items-center gap-1"
        style="font-family: var(--font-md3-sans);"
        onclick={handleDeleteSelected}
      >
        <Icon name="delete" size="14px" />
        {$t('common.delete')}
      </button>
      <button
        class="px-2.5 py-1 text-xs rounded-full font-medium
               bg-md3-surface-container-high text-md3-on-surface-variant
               hover:brightness-110 transition-all flex items-center gap-1"
        style="font-family: var(--font-md3-sans);"
        onclick={clearSelection}
      >
        <Icon name="close" size="14px" />
        {$t('common.clear')}
      </button>
    </div>
  {/if}

  <!-- Breadcrumb -->
  <Breadcrumb segments={breadcrumbSegments} onNavigate={handleBreadcrumbNavigate} />

  <!-- Loading -->
  {#if loading}
    <div class="flex items-center gap-2 text-sm text-md3-on-surface-variant">
      <span class="animate-spin">
        <Icon name="refresh" size="18px" />
      </span>
      {$t('common.loadingEllipsis')}
    </div>
  {/if}

  <!-- File list -->
  {#if !loading}
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline overflow-hidden">
      <!-- Header -->
      <div class="grid grid-cols-[auto_1fr_100px_160px] gap-3 px-4 py-2.5
                  bg-md3-surface-container-high/50
                  text-xs font-medium text-md3-on-surface-variant
                  uppercase tracking-wider
                  border-b border-md3-outline"
           style="font-family: var(--font-md3-sans);">
        <span></span>
        <span class="select-none">{$t('files.name')}</span>
        <span class="text-right select-none">{$t('files.size')}</span>
        <span class="text-right select-none">{$t('files.modified')}</span>
      </div>

      {#if filteredFolders.length === 0 && filteredDocuments.length === 0}
        <p class="px-4 py-12 text-center text-sm text-md3-on-surface-variant">
          {$t('files.empty')}
        </p>
      {/if}

      <!-- Parent directory link -->
      {#if parentId !== null}
        <button
          class="grid grid-cols-[auto_1fr_100px_160px] gap-3 px-4 py-2.5 w-full text-left
                 hover:bg-md3-primary-container/20
                 border-b border-md3-outline/50
                 transition-colors select-none"
          onclick={handleGoToParent}
        >
          <span class="self-center text-md3-primary">
            <Icon name="arrowBack" size="20px" />
          </span>
          <span class="text-sm font-medium text-md3-primary truncate">
            &lt;…&gt;
          </span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">—</span>
          <span class="text-xs text-md3-on-surface-variant text-right self-center">{$t('files.parentDirectory')}</span>
        </button>
      {/if}

      <!-- Folders -->
      {#each filteredFolders as folder (folder.id)}
        <button
          class="grid grid-cols-[auto_1fr_100px_160px] gap-3 px-4 py-2.5 w-full text-left
                 hover:bg-md3-primary-container/20
                 border-b border-md3-outline/50
                 transition-colors select-none"
          onclick={() => handleFolderClick(folder)}
          oncontextmenu={(e) => showFolderContextMenu(e, folder)}
        >
          {#if selectMode}
            <span class="self-center">
              <input type="checkbox" checked={selectedFolderIds.has(folder.id)}
                     class="rounded border-md3-outline text-md3-primary" />
            </span>
          {:else}
            <span class="self-center text-md3-primary">
              <Icon name="folder" size="20px" />
            </span>
          {/if}
          <span class="text-sm font-medium text-md3-primary truncate">
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
          class="grid grid-cols-[auto_1fr_100px_160px] gap-3 px-4 py-2.5 w-full text-left
                 hover:bg-md3-surface-container-high/30
                 border-b border-md3-outline/50 last:border-b-0
                 transition-colors select-none"
          onclick={() => handleDocumentClick(doc)}
          oncontextmenu={(e) => showDocumentContextMenu(e, doc)}
        >
          {#if selectMode}
            <span class="self-center">
              <input type="checkbox" checked={selectedDocumentIds.has(doc.id)}
                     class="rounded border-md3-outline text-md3-primary" />
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
        <label class="flex items-center gap-2">
          <input type="checkbox" bind:checked={searchDialog.searchDocuments} />
          {$t('files.searchDocuments')}
        </label>
        <label class="flex items-center gap-2">
          <input type="checkbox" bind:checked={searchDialog.searchDirectories} />
          {$t('files.searchDirectories')}
        </label>
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
          <span class="animate-spin"><Icon name="refresh" size="18px" /></span>
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
              <span class="text-md3-primary"><Icon name="folder" size="20px" /></span>
              <span class="min-w-0 truncate text-sm font-medium text-md3-primary">{directory.name}</span>
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
          <div class="grid grid-cols-[140px_1fr] gap-3 text-sm">
            <span class="text-md3-on-surface-variant">{row.label}</span>
            <span class="text-md3-on-surface whitespace-pre-wrap break-words">{row.value || '—'}</span>
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
                <th class="px-3 py-2">{$t('files.entity')}</th>
                <th class="px-3 py-2">{$t('files.target')}</th>
                <th class="px-3 py-2">{$t('files.accessType')}</th>
                <th class="px-3 py-2">{$t('files.startTime')}</th>
                <th class="px-3 py-2">{$t('files.endTime')}</th>
                <th class="px-3 py-2 text-right">{$t('files.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {#each accessEntriesDialog.entries as entry (entry.id)}
                <tr class="border-t border-md3-outline/50">
                  <td class="px-3 py-2 text-xs text-md3-on-surface-variant">{entry.id}</td>
                  <td class="px-3 py-2">{entry.entity_type}: {entry.entity_identifier}</td>
                  <td class="px-3 py-2">{entry.target_type}: {entry.target_identifier}</td>
                  <td class="px-3 py-2">{entry.access_type}</td>
                  <td class="px-3 py-2 whitespace-nowrap">{formatDate(entry.start_time)}</td>
                  <td class="px-3 py-2 whitespace-nowrap">{formatDate(entry.end_time)}</td>
                  <td class="px-3 py-2 text-right">
                    <button
                      class="px-2.5 py-1 text-xs rounded-full bg-md3-error-container
                             text-md3-on-error-container hover:brightness-110"
                      onclick={() => handleRevokeAccess(entry.id)}
                    >
                      {$t('files.revoke')}
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
                    class="pointer-events-none absolute h-1.5 w-1.5 rounded-full bg-[#c084fc]"
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
                    <p class="text-sm font-semibold text-md3-on-surface">
                      {$t('files.revision')} #{row.revision.id}
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
                      {$t('files.parentRevision')}: #{row.revision.parent_id}
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
