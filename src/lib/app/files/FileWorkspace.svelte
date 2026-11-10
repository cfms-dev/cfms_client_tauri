<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { open } from '$lib/shared/platform/native-dialog';
  import { _ as t } from 'svelte-i18n';
  import FileAddressBar from '$lib/features/files/FileAddressBar.svelte';
  import AccessDeniedDialog from '$lib/features/access/AccessDeniedDialog.svelte';
  import AccessDeniedNotice from '$lib/features/access/AccessDeniedNotice.svelte';
  import AuthorizeAccessDialog from '$lib/features/access/AuthorizeAccessDialog.svelte';
  import AccessRulesManager from '$lib/features/access/AccessRulesManager.svelte';
  import BatchAccessRulesDialog from '$lib/features/access/BatchAccessRulesDialog.svelte';
  import ContextMenu from '$lib/shared/ui/ContextMenu.svelte';
  import FileTable from '$lib/features/files/FileTable.svelte';
  import ExplorerCommandBar from '$lib/features/files/ExplorerCommandBar.svelte';
  import ExplorerNavigationBar from '$lib/features/files/ExplorerNavigationBar.svelte';
  import ExplorerDetailsPane from '$lib/features/files/ExplorerDetailsPane.svelte';
  import ExplorerStatusBar from '$lib/features/files/ExplorerStatusBar.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MdCheckbox from '$lib/shared/ui/MdCheckbox.svelte';
  import ManageListEditorDialog from '$lib/shared/ui/ManageListEditorDialog.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import MoveTargetDialog from '$lib/features/files/MoveTargetDialog.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import VirtualList from '$lib/shared/ui/VirtualList.svelte';
  import { accessEntrySubject } from '$lib/features/access/access-entries';
  import { formatBytes, formatDate } from '$lib/shared/format/values';
  import { laneX } from '$lib/features/files/revision-graph';
  import type { SortField } from '$lib/features/files/sorting';
  import { focusRovingItem } from '$lib/shared/ui/keyboard';
  import { shortIdentifier } from '$lib/shared/format/identifiers';
  import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
  import { createFileWorkspace } from './FileWorkspace.svelte.ts';
  const workspace = createFileWorkspace();
</script>

<div
  class="files-page relative"
  role="region"
  aria-label={$t('files.title')}
  oncontextmenu={workspace.showFilesPageBlankContextMenu}
  ondragenter={workspace.handleHtmlDragEnter}
  ondragover={workspace.handleHtmlDragOver}
  ondragleave={workspace.handleHtmlDragLeave}
  ondrop={workspace.handleHtmlDrop}
>
  {#if workspace.dragUploadActive}
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
    canGoBack={workspace.canGoBack} canGoForward={workspace.canGoForward} canGoToParent={workspace.canGoToParent}
    search={workspace.canUseServerSearch ? serverSearch : undefined}
    busy={workspace.navigationUnavailable}
    onBack={() => { void workspace.handleHistoryNavigate(-1); }}
    onForward={() => { void workspace.handleHistoryNavigate(1); }}
    onParent={() => { void workspace.handleGoToParent(); }}
    onRefresh={() => { void workspace.loadDirectory(workspace.currentFolderId, true); }}
  >
    {#snippet address()}
      <FileAddressBar
        bind:this={workspace.addressBar}
        segments={workspace.breadcrumbSegments}
        lookupEnabled={workspace.nodeLookupEnabled}
        knownPath={workspace.knownAddressPath}
        busy={workspace.navigationUnavailable}
        error={workspace.addressLookupError}
        onNavigate={workspace.handleBreadcrumbNavigate}
        onSubmit={workspace.handleAddressSubmit}
        onCancel={workspace.handleAddressCancel}
        onBeginEdit={workspace.handleAddressBeginEdit}
      />
    {/snippet}
  </ExplorerNavigationBar>

  {#snippet serverSearch()}
    <!-- Search -->
    {#if workspace.canUseServerSearch}
      <div bind:this={workspace.searchPreviewRoot} class="files-search relative">
      <form
        class="files-search-field cfms-field-surface"
        data-search-box
        onsubmit={(e) => { e.preventDefault(); workspace.openSearchDialog(true); }}
      >
          <input
            type="text"
            class="files-search-input cfms-native-field"
            data-focus-ring="delegated"
            placeholder={workspace.directorySearchPlaceholder}
            bind:value={workspace.searchQuery}
            bind:this={workspace.searchInput}
            onfocus={workspace.openSearchPreview}
            oninput={workspace.handleSearchInput}
            onkeydown={workspace.handleSearchKeydown}
            role="combobox"
            aria-expanded={workspace.searchPreview.open}
            aria-controls="files-search-preview-list"
            aria-label={workspace.directorySearchPlaceholder}
            aria-keyshortcuts="Control+F Meta+F"
            aria-autocomplete="list"
            aria-activedescendant={workspace.searchPreview.open && workspace.searchPreviewActiveIndex >= 0
              ? `files-search-preview-option-${workspace.searchPreviewActiveIndex}`
              : undefined}
          />
          {#if workspace.searchQuery}
            <FluentButton data-fluent-owner="routes-home-files-page"
              type="button"
              aria-label={$t('common.clear')}
              onclick={() => {
                workspace.searchQuery = '';
                workspace.handleSearchInput();
                workspace.searchInput?.focus({ preventScroll: true });
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
          disabled={!workspace.searchPreviewHasQuery}
          appearance="subtle"
          class="files-search-submit"
          iconOnly
        >
          <Icon name="search" size="16px" />
        </FluentButton>
      </form>

      {#if workspace.searchPreview.open}
        <div
          id="files-search-preview-panel"
          class="search-preview-panel cfms-acrylic-surface fixed z-40 overflow-hidden"
          style={workspace.searchPreviewPanelStyle}
        >
          <div class="border-b border-md3-outline px-4 py-3">
            <div class="search-preview-controls">
              <label class="inline-flex items-center gap-1.5 text-sm text-md3-on-surface-variant">
                <MdCheckbox
                  bind:checked={workspace.searchPreview.searchDocuments}
                  ariaLabel={$t('files.searchDocuments')}
                  onChange={workspace.updateSearchPreviewOptions}
                />
                {$t('files.searchDocuments')}
              </label>
              <label class="inline-flex items-center gap-1.5 text-sm text-md3-on-surface-variant">
                <MdCheckbox
                  bind:checked={workspace.searchPreview.searchDirectories}
                  ariaLabel={$t('files.searchDirectories')}
                  onChange={workspace.updateSearchPreviewOptions}
                />
                {$t('files.searchDirectories')}
              </label>

              <div class="search-sort" role="toolbar" tabindex="-1" aria-label={$t('workspace.sort')} onkeydown={(event) => focusRovingItem(event, event.currentTarget as HTMLElement, { selector: '[data-search-sort]', orientation: 'horizontal' })}>
                {#each ['name', 'size', 'modified'] as field}
                  <button data-fluent-owner="routes-home-files-page"
                    data-search-sort
                    tabindex={workspace.searchPreview.sortBy === field ? 0 : -1}
                    type="button"
                    class="search-sort-option"
                    aria-pressed={workspace.searchPreview.sortBy === field}
                    onclick={() => workspace.setSearchPreviewSort(field as SortField)}
                  >
                    {workspace.searchSortLabel(field as SortField)}
                  </button>
                {/each}
              </div>
              <FluentButton data-fluent-owner="routes-home-files-page"
                type="button"
                title={workspace.searchPreview.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
                onclick={workspace.toggleSearchPreviewSortOrder}
                appearance="outline"
                class="search-preview-action"
              >
                <Icon name={workspace.searchPreview.sortOrder === 'asc' ? 'arrowUpward' : 'arrowDownward'} size="16px" />
                {workspace.searchPreview.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
              </FluentButton>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs text-md3-on-surface-variant">
            <span>{$t('files.searchPreviewResults')}</span>
            {#if workspace.searchPreview.loading || workspace.searchPreview.loadingMore}
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
            {#if workspace.searchPreview.error}
              <p class="px-4 py-8 text-center text-sm text-md3-error">{workspace.searchPreview.error}</p>
            {:else if !workspace.searchPreviewHasQuery}
              <p class="px-4 py-8 text-center text-sm text-md3-on-surface-variant">{$t('files.searchPreviewEmpty')}</p>
            {:else if workspace.searchPreview.results && workspace.searchPreviewRows.length === 0 && !workspace.searchPreview.loading}
              <p class="px-4 py-8 text-center text-sm text-md3-on-surface-variant">
                {$t('files.searchNoResults', { values: { query: workspace.searchPreview.query } })}
              </p>
            {:else if workspace.searchPreviewRows.length > 0}
              <VirtualList
                items={workspace.searchPreviewRows}
                keyOf={(row) => row.kind === 'directory'
                  ? `preview-directory:${row.directory.id}`
                  : `preview-document:${row.document.id}`}
                estimateSize={48}
                overscan={8}
                threshold={80}
                resetKey={workspace.searchPreviewResetKey}
                viewportClass="search-preview-virtual-viewport"
                onScroll={workspace.handleSearchPreviewScroll}
              >
                {#snippet children(row, index)}
                  <button data-fluent-owner="routes-home-files-page"
                    id={`files-search-preview-option-${index}`}
                    type="button"
                    class="grid min-h-12 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-md3-outline/45 px-4 py-2 text-left transition-colors hover:bg-md3-primary-container/15 {workspace.searchPreviewActiveIndex === index ? 'bg-md3-primary-container/15' : ''}"
                    class:border-b-0={index === workspace.searchPreviewRows.length - 1}
                    role="option"
                    aria-selected={workspace.searchPreviewActiveIndex === index}
                    tabindex="-1"
                    onmouseenter={() => (workspace.searchPreviewActiveIndex = index)}
                    onclick={() => row.kind === 'directory'
                      ? workspace.navigateToSearchDirectory(row.directory)
                      : workspace.navigateToSearchDocument(row.document)}
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
                    <span class="text-xs text-md3-on-surface-variant">{workspace.searchResultDate(row)}</span>
                  </button>
                {/snippet}
              </VirtualList>
            {:else if workspace.searchPreview.loading}
              <div class="flex items-center justify-center gap-2 px-4 py-8 text-sm text-md3-on-surface-variant">
                <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
                {$t('common.loadingEllipsis')}
              </div>
            {/if}
          </div>

          <div class="search-preview-footer">
            <FluentButton data-fluent-owner="routes-home-files-page"
              type="button"
              disabled={!workspace.searchPreviewCanSearch}
              onclick={() => workspace.openSearchDialog(true)}
              appearance="subtle"
              class="search-preview-action"
            >
              {$t('files.advancedSearch')}
            </FluentButton>
            <FluentButton data-fluent-owner="routes-home-files-page"
              type="button"
              disabled={!workspace.searchPreviewCanSearch}
              onclick={() => workspace.openSearchDialog(true)}
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
      <ExplorerCommandBar actions={workspace.fileCommandActions} ariaLabel={$t('workspace.commandBar')} />
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
      {#each workspace.SORT_FIELDS as field}
        <FluentButton data-fluent-owner="routes-home-files-page"
          data-sort-item
          iconOnly
          type="button"
          data-active={workspace.sortField === field ? 'true' : undefined}
          title={workspace.sortTitle(field as SortField)}
          aria-label={workspace.sortTitle(field as SortField)}
          aria-pressed={workspace.sortField === field}
          tabindex={workspace.sortField === field ? 0 : -1}
          onclick={() => workspace.setSort(field as SortField)}
          appearance="subtle"
          class="explorer-command-button explorer-command-button--compact files-sort-button"
        >
          <Icon name={workspace.sortFieldIcon(field)} size="17px" />
          {#if workspace.sortField === field}
            <span class="files-sort-direction" aria-hidden="true">
              <Icon name={workspace.sortDirection === 'asc' ? 'arrowUpward' : 'arrowDownward'} size="10px" />
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
        onAction={workspace.handleReturnFromDeniedDirectory}
      />
    {/snippet}
    <FileTable
      bind:this={workspace.fileTable}
      loading={workspace.loading}
      folders={workspace.folders}
      documents={workspace.documents}
      resetKey={workspace.fileTableResetKey}
      marqueeEnabled={workspace.marqueeSelectionEnabled}
      selectMode={workspace.selectMode}
      selectedFolderIds={workspace.selectedFolderIds}
      selectedDocumentIds={workspace.selectedDocumentIds}
      sortTitle={workspace.sortTitle}
      sortIcon={workspace.sortIcon}
      onSort={workspace.setSort}
      onMarqueeSelection={workspace.applyMarqueeSelection}
      onFolderClick={workspace.handleFolderClick}
      onDocumentClick={workspace.handleDocumentClick}
      onFolderActivate={workspace.handleFolderActivate}
      onDocumentActivate={workspace.handleDocumentActivate}
      onRowKeydown={workspace.handleFileRowKeydown}
      onBlankClick={workspace.deselectAll}
      onBlankContextMenu={workspace.showCurrentDirectoryContextMenu}
      onFolderContextMenu={workspace.showFolderContextMenu}
      onDocumentContextMenu={workspace.showDocumentContextMenu}
      canMoveItems={workspace.hasPermission('move')}
      onDragSelection={workspace.handleDragSelection}
      onMoveItems={workspace.handleDropMove}
      emptyContent={workspace.directoryAccessDenied ? deniedDirectoryContent : undefined}
    />
    <ExplorerDetailsPane
      open={workspace.detailsOpen}
      model={workspace.detailModel}
      emptyTitle={$t('files.properties')}
      emptyLabel={$t('workspace.selectForDetails')}
      closeLabel={$t('workspace.closeDetails')}
      resizeLabel={$t('workspace.resizeDetails')}
      onClose={() => (workspace.detailsOpen = false)}
    />
  </div>

  <ExplorerStatusBar
    primary={workspace.statusBarPrimary}
    secondary={workspace.statusBarSecondary}
    tone={workspace.directoryLoadPhase === 'partial-error' ? 'danger' : 'default'}
    actionLabel={workspace.directoryLoadPhase === 'partial-error' ? $t('workspace.retryLoading') : ''}
    onAction={workspace.retryDirectoryLoad}
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
  open={workspace.contextMenu.open}
  x={workspace.contextMenu.x}
  y={workspace.contextMenu.y}
  items={workspace.contextMenuItems}
  userPermissions={authStore.permissions}
  sourceElement={workspace.contextMenu.sourceElement}
  onClose={workspace.hideContextMenu}
/>

{#if workspace.documentAccessDenied}
  <AccessDeniedDialog
    documentName={workspace.documentAccessDenied.name}
    documentId={workspace.documentAccessDenied.id}
    accessedAt={workspace.documentAccessDenied.accessedAt}
    onClose={() => (workspace.documentAccessDenied = null)}
  />
{/if}

{#if workspace.searchDialog.open}
  <ModalFrame
    title={$t('files.searchTitle')}
    maxWidth="max-w-3xl"
    resizable
    maximizable
    minWidth={520}
    minHeight={360}
    closeLabel={$t('common.close')}
    onClose={workspace.closeSearchDialog}
  >
    <form class="server-search-form" style:--search-row-height={`${workspace.searchRowHeight}px`} onsubmit={(e) => { e.preventDefault(); workspace.runServerSearch(); }}>
      <div class="server-search-query">
        <div class="files-search-field cfms-field-surface" data-search-box>
        <input
          class="files-search-input cfms-native-field"
          data-focus-ring="delegated"
          bind:value={workspace.searchDialog.query}
          bind:this={workspace.searchDialogInput}
          placeholder={$t('files.searchPlaceholder')}
          aria-label={$t('files.searchPlaceholder')}
          disabled={workspace.searchDialog.loading}
        />
        {#if workspace.searchDialog.query}
          <FluentButton data-fluent-owner="routes-home-files-page"
            type="button"
            appearance="subtle"
            class="files-search-clear"
            iconOnly
            aria-label={$t('common.clear')}
            disabled={workspace.searchDialog.loading}
            onclick={() => {
              workspace.searchDialog.query = '';
              workspace.searchDialogInput?.focus({ preventScroll: true });
            }}
          >
            <Icon name="close" size="16px" />
          </FluentButton>
        {/if}
        </div>
        <FluentButton data-fluent-owner="routes-home-files-page"
          type="submit"
          disabled={workspace.searchDialog.loading}
          appearance="primary"
          class="server-search-action"
        >
          {$t('files.serverSearch')}
        </FluentButton>
      </div>

      <div class="server-search-controls">
        <label class="flex items-center gap-2">
          <MdCheckbox
            bind:checked={workspace.searchDialog.searchDocuments}
            ariaLabel={$t('files.searchDocuments')}
            disabled={workspace.searchDialog.loading}
          />
          {$t('files.searchDocuments')}
        </label>
        <label class="flex items-center gap-2">
          <MdCheckbox
            bind:checked={workspace.searchDialog.searchDirectories}
            ariaLabel={$t('files.searchDirectories')}
            disabled={workspace.searchDialog.loading}
          />
          {$t('files.searchDirectories')}
        </label>

        <div class="search-sort" role="toolbar" tabindex="-1" aria-label={$t('workspace.sort')} onkeydown={(event) => focusRovingItem(event, event.currentTarget as HTMLElement, { selector: '[data-search-sort]', orientation: 'horizontal' })}>
          {#each ['name', 'size', 'modified'] as field}
            <button data-fluent-owner="routes-home-files-page"
              data-search-sort
              tabindex={workspace.searchDialog.sortBy === field ? 0 : -1}
              type="button"
              class="search-sort-option"
              aria-pressed={workspace.searchDialog.sortBy === field}
              disabled={workspace.searchDialog.loading}
              onclick={() => workspace.setSearchDialogSort(field as SortField)}
            >
              {workspace.searchSortLabel(field as SortField)}
            </button>
          {/each}
        </div>
        <FluentButton data-fluent-owner="routes-home-files-page"
          type="button"
          disabled={workspace.searchDialog.loading}
          title={workspace.searchDialog.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
          onclick={workspace.toggleSearchDialogSortOrder}
          appearance="outline"
          class="server-search-action"
        >
          <Icon name={workspace.searchDialog.sortOrder === 'asc' ? 'arrowUpward' : 'arrowDownward'} size="16px" />
          {workspace.searchDialog.sortOrder === 'asc' ? $t('files.ascending') : $t('files.descending')}
        </FluentButton>
      </div>

      {#if workspace.searchDialog.results}
        <div class="server-search-results">
          <div class="server-search-summary" role="status">
            <span>
              {workspace.searchDialog.results.total_count === 0 && !workspace.searchDialog.loading
                ? $t('files.searchNoResults', { values: { query: workspace.searchDialog.resultQuery } })
                : $t('files.searchResultCount', { values: { count: workspace.searchDialog.results.total_count, query: workspace.searchDialog.resultQuery } })}
            </span>
            {#if workspace.searchDialog.loading}
              <span class="inline-flex shrink-0 items-center gap-2">
                <ProgressRing size={14} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
                {$t('common.loadingEllipsis')}
              </span>
            {/if}
          </div>
          <VirtualList
            items={workspace.searchResultRows}
            keyOf={(row) => row.kind === 'directory'
              ? `directory:${row.directory.id}`
              : `document:${row.document.id}`}
            estimateSize={workspace.searchRowHeight}
            overscan={10}
            threshold={120}
            resetKey={workspace.searchDialogResetKey}
            viewportClass="server-search-list-viewport"
            keyboardNavigation
            keyboardTargetSelector="button"
          >
            {#snippet children(row, index)}
              {#if row.kind === 'directory'}
                <button
                  type="button"
                  onclick={() => workspace.navigateToSearchDirectory(row.directory)}
                  class="server-search-result"
                  class:server-search-result--last={index === workspace.searchResultRows.length - 1}
                >
                  <span class="text-md3-primary-emphasis"><Icon name="folder" size="20px" /></span>
                  <span class="server-search-result-name">{row.directory.name}</span>
                  <span class="server-search-result-detail">{formatDate(row.directory.created_time)}</span>
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => workspace.navigateToSearchDocument(row.document)}
                  class="server-search-result"
                  class:server-search-result--last={index === workspace.searchResultRows.length - 1}
                >
                  <span class="text-md3-on-surface-variant"><Icon name="filePresent" size="20px" /></span>
                  <span class="server-search-result-name">{row.document.name ?? row.document.title}</span>
                  <span class="server-search-result-detail">{formatBytes(row.document.size)}</span>
                </button>
              {/if}
            {/snippet}
          </VirtualList>
        </div>
      {:else if workspace.searchDialog.loading}
        <div class="flex items-center gap-2 py-6 text-sm text-md3-on-surface-variant">
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {$t('common.loadingEllipsis')}
        </div>
      {/if}
    </form>
  </ModalFrame>
{/if}

{#if workspace.detailTitle}
  <ModalFrame title={workspace.detailTitle} maxWidth="max-w-lg" closeLabel={$t('common.close')} onClose={() => (workspace.detailTitle = null)}>
      <div class="p-5 space-y-3 max-h-[70vh] overflow-auto">
        {#each workspace.detailRows as row}
          <div class="grid min-w-0 grid-cols-[140px_minmax(0,1fr)] gap-3 text-sm">
            <span class="text-md3-on-surface-variant">{row.label}</span>
            <span class="min-w-0 whitespace-pre-wrap text-md3-on-surface" style="overflow-wrap: anywhere;">{row.value || '—'}</span>
          </div>
        {/each}
      </div>
  </ModalFrame>
{/if}

{#if workspace.authorizeDialog}
  <ModalFrame
    title={workspace.authorizeDialog.title}
    maxWidth="max-w-2xl"
    resizable
    maximizable
    minWidth={520}
    minHeight={480}
    closeLabel={$t('common.close')}
    onClose={() => (workspace.authorizeDialog = null)}
  >
    <AuthorizeAccessDialog
      targetName={workspace.authorizeDialog.targetName}
      targetType={workspace.authorizeDialog.targetType}
      canListUsers={authStore.permissions.includes('list_users')}
      canListGroups={authStore.permissions.includes('list_groups')}
      saving={workspace.authorizeDialog.saving}
      onSubmit={workspace.handleSubmitAuthorize}
      onCancel={() => (workspace.authorizeDialog = null)}
    />
  </ModalFrame>
{/if}

{#if workspace.moveTargetDialog}
  <MoveTargetDialog
    objectType={workspace.moveTargetDialog.objectType}
    objectName={workspace.moveTargetDialog.objectName}
    initialFolderId={workspace.currentFolderId}
    navigationRootId={workspace.navigationRootId}
    originalParentId={workspace.moveTargetDialog.originalParentId}
    initialBreadcrumb={workspace.moveInitialBreadcrumb}
    excludedDirectoryIds={workspace.moveTargetDialog.excludedDirectoryIds}
    moving={workspace.moveTargetDialog.saving}
    onMove={workspace.handleMoveToTarget}
    onCancel={() => (workspace.moveTargetDialog = null)}
  />
{/if}

{#if workspace.batchMoveDialog}
  <MoveTargetDialog
    objectType="directory"
    objectName={workspace.selectedItemsLabel}
    initialFolderId={workspace.currentFolderId}
    navigationRootId={workspace.navigationRootId}
    originalParentId={workspace.currentFolderId}
    initialBreadcrumb={workspace.moveInitialBreadcrumb}
    excludedDirectoryIds={workspace.batchMoveDialog.excludedDirectoryIds}
    moving={workspace.batchMoveDialog.saving}
    onMove={workspace.handleBatchMoveToTarget}
    onCancel={() => (workspace.batchMoveDialog = null)}
  />
{/if}

{#if workspace.accessEntriesDialog}
  <ModalFrame
    title={workspace.accessEntriesDialog.title}
    maxWidth="max-w-5xl"
    resizable
    maximizable
    minWidth={720}
    minHeight={360}
    closeLabel={$t('common.close')}
    onClose={() => (workspace.accessEntriesDialog = null)}
  >
      <div class="h-full max-h-[70vh] overflow-auto p-5">
        {#if workspace.accessEntriesDialog.entries.length === 0}
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
              {#each workspace.accessEntriesDialog.entries as entry (entry.id)}
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
                      onclick={() => workspace.handleRevokeAccess(entry.id)}
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

{#if workspace.batchAccessRulesDialog}
  <BatchAccessRulesDialog
    targets={workspace.batchAccessRulesDialog.targets}
    initialTemplateKey={workspace.batchAccessRulesDialog.initialTemplateKey}
    canReadTemplate={workspace.hasPermission('view_access_rules')}
    checkGuard={workspace.batchAccessRulesGuard}
    onApplied={workspace.refreshAfterBatchAccessRules}
    onClose={workspace.closeBatchAccessRules}
  />
{/if}

{#if workspace.accessRulesDialog}
  <ModalFrame
    title={workspace.accessRulesDialog.title}
    maxWidth="max-w-6xl"
    resizable
    maximizable
    minWidth={680}
    minHeight={480}
    closeLabel={$t('common.close')}
    onClose={() => (workspace.accessRulesDialog = null)}
  >
    <AccessRulesManager
      rules={workspace.accessRulesDialog.rules}
      inheritParent={workspace.accessRulesDialog.inheritParent}
      saving={workspace.accessRulesDialog.saving}
      onSave={workspace.handleSaveAccessRules}
      onCancel={() => (workspace.accessRulesDialog = null)}
    />
  </ModalFrame>
{/if}

{#if workspace.documentTagsDialog}
  <ManageListEditorDialog
    title={$t('files.editTagsFor', { values: { name: workspace.documentTagsDialog.title } })}
    description={$t('files.editTagsDescription')}
    icon="label"
    items={workspace.documentTagsDialog.tags.map((tag) => ({ id: tag, label: tag }))}
    selected={workspace.documentTagsDialog.tags}
    allowAdd={true}
    addPlaceholder={$t('files.addTagPlaceholder')}
    emptyMessage={$t('files.noTags')}
    onRefresh={workspace.refreshDocumentTagsEditorData}
    onSave={workspace.saveDocumentTags}
    onClose={() => (workspace.documentTagsDialog = null)}
  />
{/if}

{#if workspace.revisionsDialog}
  <ModalFrame
    title={workspace.revisionsDialog.title}
    maxWidth="max-w-2xl"
    resizable
    maximizable
    minWidth={520}
    minHeight={420}
    closeLabel={$t('common.close')}
    onClose={() => (workspace.revisionsDialog = null)}
  >
      <div class="h-full max-h-[72vh] overflow-auto p-5">
        {#if workspace.uploadProgress && workspace.uploadProgress.documentId === workspace.revisionsDialog.documentId}
          <div class="mb-4 rounded-lg border border-md3-primary/25 bg-md3-primary-container/30 p-3">
            <div class="mb-2 flex items-center justify-between gap-3 text-xs text-md3-on-primary-container">
              <span class="font-medium">{$t('files.uploadRevisionStarted')}</span>
              <span>{Math.round(workspace.uploadProgress.progress * 100)}%</span>
            </div>
            <div class="h-1.5 overflow-hidden rounded-full bg-md3-surface-container-high">
              <span
                class="block h-full rounded-full bg-md3-primary transition-[width] duration-150"
                style={`width: ${Math.max(0, Math.min(1, workspace.uploadProgress.progress)) * 100}%`}
              ></span>
            </div>
          </div>
        {/if}
        {#if workspace.revisionsDialog.entries.length === 0}
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
          <div style={`--revision-graph-width: ${workspace.revisionGraphWidth}px`}>
            {#each workspace.revisionRows as row (row.revision.id)}
              <div class="revision-graph-row">
                <div class="revision-graph-track" aria-hidden="true">
                  <svg
                    class="absolute inset-0 h-full w-full"
                    viewBox={`0 0 ${workspace.revisionGraphWidth} 64`}
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
                    onclick={() => workspace.handleDownloadRevision(row.revision)}
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
                      onclick={() => workspace.handleSetCurrentRevision(row.revision)}
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
                      onclick={() => workspace.handleDeleteRevision(row.revision)}
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
