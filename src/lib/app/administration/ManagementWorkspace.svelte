<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { _ as t } from 'svelte-i18n';
  import { authStore } from "$lib/features/authentication/auth-state.svelte.ts";
  import ContextMenu from '$lib/shared/ui/ContextMenu.svelte';
  import AuditLogFilter from '$lib/features/administration/AuditLogFilter.svelte';
  import AuditIdentifier from '$lib/features/administration/AuditIdentifier.svelte';
  import AuditUserIdentity from '$lib/features/administration/AuditUserIdentity.svelte';
  import CreateUserAccountDialog from '$lib/features/administration/CreateUserAccountDialog.svelte';
  import CreateUserGroupDialog from '$lib/features/administration/CreateUserGroupDialog.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import BlockUserDialog from '$lib/features/administration/BlockUserDialog.svelte';
  import ManageListEditorDialog from '$lib/shared/ui/ManageListEditorDialog.svelte';
  import PermissionEntriesDialog from '$lib/features/access/PermissionEntriesDialog.svelte';
  import ResetUserPasswordDialog from '$lib/features/authentication/ResetUserPasswordDialog.svelte';
  import ServerSettings from '$lib/features/administration/ServerSettings.svelte';
  import ChangeUsernameDialog from '$lib/features/authentication/ChangeUsernameDialog.svelte';
  import SecurityManagement from '$lib/features/administration/SecurityManagement.svelte';
  import UserAvatarPicker from '$lib/features/authentication/UserAvatarPicker.svelte';
  import AuthenticationManagement from '$lib/features/authentication/AuthenticationManagement.svelte';
  import type { IconName } from '$lib/shared/ui/icons';
  import { createManagementWorkspace } from './ManagementWorkspace.svelte.ts';
  const outlinedId = $props.id();
  const workspace = createManagementWorkspace();
</script>

<div class="workspace-page space-y-4 p-[clamp(1rem,3.75vw,1.5rem)]">
  <div bind:this={workspace.identityMeasureHost} class="identity-measure-host" aria-hidden="true"></div>

  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('manage.title')}
    </h1>

    {#if workspace.isAdmin}
      <FluentButton data-fluent-owner="routes-home-manage-page"
        title={$t('common.refresh')}
        onclick={workspace.loadActiveTab}
        disabled={workspace.loadingUsers || workspace.loadingGroups || workspace.loadingLogs || workspace.busyKey !== null}
        type="button"
        appearance="subtle"
        class="p-2 rounded text-md3-on-surface-variant\n               hover:bg-md3-surface-container-high transition-colors disabled:opacity-50"
        iconOnly
        aria-label={$t('common.refresh')}
      >
        <Icon name="refresh" size="20px" />
      </FluentButton>
    {/if}
  </div>

  {#if !workspace.isAdmin}
    <div class="bg-md3-error-container/60 border border-md3-error/30
                text-md3-on-error-container text-sm rounded-xl p-4">
      {$t('manage.noPermission')}
    </div>
  {:else}
    <div class="flex gap-1 bg-md3-surface-container-high rounded-xl p-1 w-fit" role="tablist" tabindex="-1" aria-label={$t('manage.title')} onkeydown={workspace.handleManageTabKeydown}>
      {#each workspace.tabs as tab}
        <button data-fluent-owner="routes-home-manage-page"
          data-tab-item
          role="tab"
          aria-selected={workspace.activeTab === tab.key}
          tabindex={workspace.activeTab === tab.key ? 0 : -1}
          class="px-4 py-1.5 text-xs rounded-lg font-medium transition-all flex items-center gap-1.5"
          class:bg-md3-primary-container={workspace.activeTab === tab.key}
          class:text-md3-on-primary-container={workspace.activeTab === tab.key}
          class:text-md3-on-surface-variant={workspace.activeTab !== tab.key}
          class:hover:bg-md3-surface-container-highest={workspace.activeTab !== tab.key}
          style="font-family: var(--font-md3-sans);"
          onclick={() => workspace.setActiveTab(tab.key)}
        >
          <Icon name={tab.icon} size="16px" />
          {$t(tab.labelKey)}
        </button>
      {/each}
    </div>

    <div
      class="management-content"
      class:management-content--contained={workspace.activeTab !== 'security' && workspace.activeTab !== 'settings'}
      class:management-content--audit={workspace.activeTab === 'logs'}
    >
      {#if workspace.activeTab === 'accounts'}
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-md3-outline">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('manage.userAccounts')}
          </h2>
          <FluentButton data-fluent-owner="routes-home-manage-page"
            style="font-family: var(--font-md3-sans);"
            onclick={workspace.handleCreateUser}
            disabled={!workspace.canListUsers || workspace.busyKey !== null}
            type="button"
            appearance="subtle"
            class="px-3 py-1.5 text-xs rounded font-medium\n                   bg-md3-primary-container text-md3-on-primary-container\n                    disabled:opacity-50 transition-all flex items-center gap-1.5"
          >
            <Icon name="groupAdd" size="14px" />
            {$t('manage.addAccount')}
          </FluentButton>
        </div>

        {#if !workspace.canListUsers}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            {$t('manage.missingPermission', { values: { permission: 'list_users' } })}
          </p>
        {:else if workspace.loadingUsers}
          {@render LoadingRow()}
        {:else if workspace.users.length === 0}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            {$t('manage.noUsers')}
          </p>
        {:else}
          <div
            class="manage-list manage-list--accounts"
            class:manage-list--metadata-hidden={workspace.hideAccountMetadata}
            bind:this={workspace.accountListElement}
            style={`--manage-identity-width: ${workspace.accountIdentityColumnWidth}px;`}
            role="list"
          >
            {#each workspace.users as user (user.user_id)}
              {@const actionKey = `user:${user.user_id}`}
              <div
                class="manage-list-row"
                role="listitem"
                oncontextmenu={(event) => workspace.showUserContextMenu(event, user)}
              >
                <span class="manage-list-icon text-md3-primary-emphasis">
                  <Icon name="accountCircle" size="24px" />
                </span>
                <div class="manage-identity min-w-0">
                  <p class="truncate text-sm font-medium leading-snug text-md3-on-surface">
                    {user.nickname || user.username}
                  </p>
                  {@render PrimaryMetadataValue(user.username)}
                </div>
                <div class="metadata-stack">
                  {@render MetadataLine($t('manage.lastLogin'), workspace.formatDate(user.last_login))}
                  {@render MetadataLine($t('manage.groups'), workspace.formatList(user.groups))}
                  {@render MetadataLine($t('manage.effectivePermissions'), workspace.formatList(user.effective_permissions))}
                </div>
                <FluentButton data-fluent-owner="routes-home-manage-page"
                  title={$t('tasks.moreActions')}
                  aria-label={$t('tasks.moreActions')}
                  onclick={() => workspace.toggleActionRow(actionKey)}
                  onkeydown={(event) => {
                    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                      event.preventDefault();
                      workspace.showUserContextMenu(event, user);
                    }
                  }}
                  type="button"
                  appearance="subtle"
                  class="manage-action-toggle rounded p-1.5 text-md3-on-surface-variant transition-colors hover:bg-md3-primary-container/40 hover:text-md3-primary-emphasis"
                  iconOnly
                >
                  <Icon name={workspace.expandedActionRow === actionKey ? 'expandLess' : 'moreVert'} size="20px" />
                </FluentButton>
                <div class="manage-list-actions">
                  {@render ActionButton('info', $t('manage.properties'), () => workspace.handleViewUser(user), workspace.busyKey !== null)}
                  {@render ActionButton('edit', $t('protocol30.changeUsername'), () => workspace.handleSetUsername(user), workspace.busyKey !== null || !workspace.canChangeUsername(user))}
                  {@render ActionButton('edit', $t('manage.changeNickname'), () => workspace.handleRenameUser(user), workspace.busyKey !== null || !workspace.canChangeNickname(user))}
                  {@render ActionButton('formatListBulleted', $t('manage.editGroups'), () => workspace.handleEditUserGroups(user), workspace.busyKey !== null)}
                  {@render ActionButton('accountCircle', workspace.canManageUserAvatars ? $t('manage.changeUserAvatar') : $t('manage.avatarPermissionRequired'), () => workspace.handleChangeUserAvatar(user), !workspace.canManageUserAvatars || workspace.busyKey !== null)}
                  {@render ActionButton('adminPanelSettings', $t('manage.editPermissions'), () => workspace.handleEditUserPermissions(user), !workspace.canSetUserPermissions || workspace.busyKey !== null)}
                  {@render ActionButton('passwordReset', $t('manage.resetPassword'), () => workspace.handleResetPassword(user), !workspace.canResetPassword(user) || workspace.busyKey !== null)}
                  {#if workspace.canReadUserAuthentication(user)}{@render ActionButton('passkey', $t('authManagement.title'), () => { workspace.activeDialog = { kind: 'user-authentication', user }; }, workspace.busyKey !== null)}{/if}
                  {@render ActionButton('manageAccounts', $t('manage.accountManagement'), () => workspace.handleManageAccount(user), (!workspace.canManageUserStatus && !workspace.canManage2fa && !workspace.canReadUserAuthentication(user)) || workspace.busyKey !== null)}
                  {@render ActionButton('block', $t('manage.blockUser'), () => workspace.handleBlockUser(user), !workspace.canBlock || workspace.busyKey !== null)}
                  {@render ActionButton('manageAccounts', $t('manage.viewBlocks'), () => workspace.handleListBlocks(user), !workspace.canListBlocks || workspace.busyKey !== null)}
                  {@render ActionButton('delete', $t('common.delete'), () => workspace.handleDeleteUser(user), workspace.busyKey !== null, true)}
                </div>
                {#if workspace.expandedActionRow === actionKey}
                  <div class="manage-list-expanded rounded-lg border border-md3-outline/50 bg-md3-surface-container-high px-2 py-2 animate-fade-scale-in">
                    <div class="flex flex-wrap justify-end gap-1">
                      {@render ActionButton('info', $t('manage.properties'), () => workspace.handleViewUser(user), workspace.busyKey !== null)}
                      {@render ActionButton('edit', $t('protocol30.changeUsername'), () => workspace.handleSetUsername(user), workspace.busyKey !== null || !workspace.canChangeUsername(user))}
                  {@render ActionButton('edit', $t('manage.changeNickname'), () => workspace.handleRenameUser(user), workspace.busyKey !== null || !workspace.canChangeNickname(user))}
                      {@render ActionButton('formatListBulleted', $t('manage.editGroups'), () => workspace.handleEditUserGroups(user), workspace.busyKey !== null)}
                      {@render ActionButton('accountCircle', workspace.canManageUserAvatars ? $t('manage.changeUserAvatar') : $t('manage.avatarPermissionRequired'), () => workspace.handleChangeUserAvatar(user), !workspace.canManageUserAvatars || workspace.busyKey !== null)}
                      {@render ActionButton('adminPanelSettings', $t('manage.editPermissions'), () => workspace.handleEditUserPermissions(user), !workspace.canSetUserPermissions || workspace.busyKey !== null)}
                      {@render ActionButton('passwordReset', $t('manage.resetPassword'), () => workspace.handleResetPassword(user), !workspace.canResetPassword(user) || workspace.busyKey !== null)}
                      {#if workspace.canReadUserAuthentication(user)}{@render ActionButton('passkey', $t('authManagement.title'), () => { workspace.activeDialog = { kind: 'user-authentication', user }; }, workspace.busyKey !== null)}{/if}
                      {@render ActionButton('manageAccounts', $t('manage.accountManagement'), () => workspace.handleManageAccount(user), (!workspace.canManageUserStatus && !workspace.canManage2fa && !workspace.canReadUserAuthentication(user)) || workspace.busyKey !== null)}
                      {@render ActionButton('block', $t('manage.blockUser'), () => workspace.handleBlockUser(user), !workspace.canBlock || workspace.busyKey !== null)}
                      {@render ActionButton('manageAccounts', $t('manage.viewBlocks'), () => workspace.handleListBlocks(user), !workspace.canListBlocks || workspace.busyKey !== null)}
                      {@render ActionButton('delete', $t('common.delete'), () => workspace.handleDeleteUser(user), workspace.busyKey !== null, true)}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {:else if workspace.activeTab === 'groups'}
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-md3-outline">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('manage.userGroups')}
          </h2>
          <FluentButton data-fluent-owner="routes-home-manage-page"
            style="font-family: var(--font-md3-sans);"
            onclick={workspace.handleCreateGroup}
            disabled={!workspace.canListGroups || workspace.busyKey !== null}
            type="button"
            appearance="subtle"
            class="px-3 py-1.5 text-xs rounded font-medium\n                   bg-md3-primary-container text-md3-on-primary-container\n                    disabled:opacity-50 transition-all flex items-center gap-1.5"
          >
            <Icon name="groupAdd" size="14px" />
            {$t('manage.addGroup')}
          </FluentButton>
        </div>

        {#if !workspace.canListGroups}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            {$t('manage.missingPermission', { values: { permission: 'list_groups' } })}
          </p>
        {:else if workspace.loadingGroups}
          {@render LoadingRow()}
        {:else if workspace.groups.length === 0}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            {$t('manage.noGroups')}
          </p>
        {:else}
          <div
            class="manage-list manage-list--groups"
            class:manage-list--metadata-hidden={workspace.hideGroupMetadata}
            bind:this={workspace.groupListElement}
            style={`--manage-identity-width: ${workspace.groupIdentityColumnWidth}px;`}
            role="list"
          >
            {#each workspace.groups as group (group.name)}
              {@const actionKey = `group:${group.name}`}
              <div
                class="manage-list-row"
                role="listitem"
                oncontextmenu={(event) => workspace.showGroupContextMenu(event, group)}
              >
                <span class="manage-list-icon text-md3-primary-emphasis">
                  <Icon name="groups" size="24px" />
                </span>
                <div class="manage-identity min-w-0">
                  <p class="truncate text-sm font-medium leading-snug text-md3-on-surface">
                    {group.display_name || group.name}
                  </p>
                  {@render PrimaryMetadataValue(group.name)}
                </div>
                <div class="metadata-stack">
                  {@render MetadataLine($t('manage.effectivePermissions'), workspace.formatList(group.effective_permissions))}
                  {@render MetadataLine($t('manage.members'), workspace.formatList(group.members))}
                </div>
                <FluentButton data-fluent-owner="routes-home-manage-page"
                  title={$t('tasks.moreActions')}
                  aria-label={$t('tasks.moreActions')}
                  onclick={() => workspace.toggleActionRow(actionKey)}
                  onkeydown={(event) => {
                    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                      event.preventDefault();
                      workspace.showGroupContextMenu(event, group);
                    }
                  }}
                  type="button"
                  appearance="subtle"
                  class="manage-action-toggle rounded p-1.5 text-md3-on-surface-variant transition-colors hover:bg-md3-primary-container/40 hover:text-md3-primary-emphasis"
                  iconOnly
                >
                  <Icon name={workspace.expandedActionRow === actionKey ? 'expandLess' : 'moreVert'} size="20px" />
                </FluentButton>
                <div class="manage-list-actions">
                  {@render ActionButton('edit', $t('manage.rename'), () => workspace.handleRenameGroup(group), workspace.busyKey !== null)}
                  {@render ActionButton('settings', $t('manage.setPermissions'), () => workspace.handleEditGroupPermissions(group), workspace.busyKey !== null)}
                  {@render ActionButton('groupRemove', $t('common.delete'), () => workspace.handleDeleteGroup(group), workspace.busyKey !== null, true)}
                </div>
                {#if workspace.expandedActionRow === actionKey}
                  <div class="manage-list-expanded rounded-lg border border-md3-outline/50 bg-md3-surface-container-high px-2 py-2 animate-fade-scale-in">
                    <div class="flex flex-wrap justify-end gap-1">
                      {@render ActionButton('edit', $t('manage.rename'), () => workspace.handleRenameGroup(group), workspace.busyKey !== null)}
                      {@render ActionButton('settings', $t('manage.setPermissions'), () => workspace.handleEditGroupPermissions(group), workspace.busyKey !== null)}
                      {@render ActionButton('groupRemove', $t('common.delete'), () => workspace.handleDeleteGroup(group), workspace.busyKey !== null, true)}
                    </div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      {:else if workspace.activeTab === 'settings'}
        <ServerSettings bind:this={workspace.serverSettings} />
      {:else if workspace.activeTab === 'security'}
        <SecurityManagement
          canListSubnets={workspace.canListBannedSubnets}
          canManageSubnets={workspace.canManageBannedSubnets}
          canListLockouts={workspace.canListAuthLockouts}
          canUnlockLockouts={workspace.canUnlockAuthLockouts}
          refreshKey={workspace.securityRefreshKey}
        />
      {:else}
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-md3-outline">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('manage.auditLogs')}
          </h2>
          <div class="flex items-center gap-2">
            <AuditLogFilter
              availableActions={workspace.auditKnownActions}
              selectedActions={workspace.auditFilters}
              disabled={!workspace.canViewLogs || workspace.loadingLogs}
              onApply={workspace.applyAuditFilters}
            />
            <span class="text-xs text-md3-on-surface-variant">
              {workspace.auditDisplayRange === null
                ? $t('manage.auditRangeEmpty')
                : $t('manage.auditPageRange', {
                    values: {
                      start: workspace.auditDisplayRange.start,
                      end: workspace.auditDisplayRange.end,
                    },
                  })}
            </span>
            <FluentButton data-fluent-owner="routes-home-manage-page"
              title={$t('common.previous')}
              onclick={() => workspace.loadAuditLogPage(workspace.auditCursorStack[Math.max(0, workspace.auditPageIndex - 1)] ?? null, 'previous')}
              disabled={workspace.auditPageIndex <= 0 || workspace.loadingLogs}
              type="button"
              appearance="subtle"
              class="p-1.5 rounded text-md3-on-surface-variant hover:bg-md3-surface-container-high disabled:opacity-40"
              iconOnly
              aria-label={$t('common.previous')}
            >
              <Icon name="navigateBefore" size="18px" />
            </FluentButton>
            <FluentButton data-fluent-owner="routes-home-manage-page"
              title={$t('common.next')}
              onclick={() => workspace.loadAuditLogPage(workspace.auditNextCursor, 'next')}
              disabled={!workspace.auditNextCursor || workspace.loadingLogs}
              type="button"
              appearance="subtle"
              class="p-1.5 rounded text-md3-on-surface-variant hover:bg-md3-surface-container-high disabled:opacity-40"
              iconOnly
              aria-label={$t('common.next')}
            >
              <Icon name="navigateNext" size="18px" />
            </FluentButton>
          </div>
        </div>

        {#if workspace.canViewLogs && workspace.auditFilters.length > 0}
          <div class="audit-active-filters" aria-label={$t('manage.auditActiveFilters')}>
            <span class="audit-active-filters__label">
              <Icon name="filterList" size="16px" />
              {$t('manage.auditFilteringBy')}
            </span>
            <div class="audit-filter-chips">
              {#each workspace.auditFilters as action (action)}
                <span class="audit-filter-chip">
                  <code>{action}</code>
                  <FluentButton data-fluent-owner="routes-home-manage-page"
                    type="button"
                    aria-label={$t('manage.auditFilterRemove', { values: { action } })}
                    disabled={workspace.loadingLogs}
                    onclick={() => workspace.removeAuditFilter(action)}
                    appearance="subtle"
                    iconOnly
                  >
                    <Icon name="close" size="14px" />
                  </FluentButton>
                </span>
              {/each}
            </div>
            <FluentButton data-fluent-owner="routes-home-manage-page"
              type="button"
              disabled={workspace.loadingLogs}
              onclick={() => workspace.applyAuditFilters([])}
              appearance="subtle"
              class="audit-filter-clear"
            >
              {$t('manage.auditFilterClearAll')}
            </FluentButton>
          </div>
        {/if}

        {#if !workspace.canViewLogs}
          <p class="text-sm text-md3-on-surface-variant text-center py-8">
            {$t('manage.missingPermission', { values: { permission: 'view_audit_logs' } })}
          </p>
        {:else if workspace.loadingLogs}
          {@render LoadingRow()}
        {:else if workspace.auditEntries.length === 0}
          {#if workspace.auditFilters.length > 0}
            <div class="audit-filter-empty">
              <span class="audit-filter-empty__icon"><Icon name="filterList" size="22px" /></span>
              <p>{$t('manage.noAuditLogsMatchingFilters')}</p>
              <FluentButton data-fluent-owner="routes-home-manage-page"
                type="button"
                onclick={() => workspace.applyAuditFilters([])}
                appearance="subtle"
              >
                {$t('manage.auditFilterClearAll')}
              </FluentButton>
            </div>
          {:else}
            <p class="text-sm text-md3-on-surface-variant text-center py-8">
              {$t('manage.noAuditLogs')}
            </p>
          {/if}
        {:else}
          <div class="overflow-x-auto">
            <table class="audit-table w-full text-left text-sm">
              <colgroup>
                <col style="width: 10%" />
                <col style="width: 18%" />
                <col style="width: 12%" />
                <col style="width: 20%" />
                <col style="width: 9%" />
                <col style="width: 15%" />
                <col style="width: 16%" />
              </colgroup>
              <thead class="text-xs uppercase text-md3-on-surface-variant">
                <tr>
                  <th class="px-3 py-2">{$t('manage.id')}</th>
                  <th class="px-3 py-2">{$t('manage.action')}</th>
                  <th class="px-3 py-2">{$t('manage.userId')}</th>
                  <th class="px-3 py-2">{$t('manage.target')}</th>
                  <th class="px-3 py-2">{$t('manage.result')}</th>
                  <th class="px-3 py-2">{$t('manage.remote')}</th>
                  <th class="px-3 py-2 text-right">{$t('manage.time')}</th>
                </tr>
              </thead>
              <tbody>
                {#each workspace.auditEntries as entry (entry.id)}
                  <tr class="border-t border-md3-outline/50 text-md3-on-surface">
                    <td class="px-3 py-2 align-top text-md3-on-surface-variant">
                      <AuditIdentifier value={entry.id} />
                    </td>
                    <td class="px-3 py-2 align-top">{entry.action}</td>
                    <td class="px-3 py-2 align-top">
                      {#key workspace.userPreviewRevision}
                      <AuditUserIdentity value={entry.user_id} previewKey={entry.id}
                        bind:activeKey={workspace.activeUserPreviewKey} cache={workspace.userPreviewCache}
                        disabled={workspace.busyKey !== null}
                        onViewDetails={(userId, info) => workspace.handleViewUser({ user_id: userId }, info)} />
                      {/key}
                    </td>
                    <td class="px-3 py-2 align-top">{entry.target}</td>
                    <td class="px-3 py-2 align-top">{entry.result}</td>
                    <td class="px-3 py-2 align-top">{entry.remote_address}</td>
                    <td class="px-3 py-2 align-top text-right">{workspace.formatDate(entry.logged_time)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="px-3 py-2 text-xs text-md3-on-surface-variant">{$t('manage.auditIdentifierHelp')}</p>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<ContextMenu
  open={workspace.contextMenu.open}
  x={workspace.contextMenu.x}
  y={workspace.contextMenu.y}
  items={workspace.contextMenuItems}
  sourceElement={workspace.contextMenu.sourceElement}
  onClose={workspace.hideContextMenu}
/>

{#if workspace.activeDialog?.kind === 'user-authentication'}
  <ModalFrame title={`${$t('authManagement.title')} · ${workspace.activeDialog.user.username}`} maxWidth="max-w-6xl" onClose={async () => { if (await workspace.authenticationManagement?.canLeave() ?? true) workspace.activeDialog = null; }} closeLabel={$t('common.close')}>
    <div class="p-5"><AuthenticationManagement bind:this={workspace.authenticationManagement} userId={workspace.activeDialog.user.user_id} username={workspace.activeDialog.user.username} /></div>
  </ModalFrame>
{:else if workspace.activeDialog?.kind === 'create-user'}
  <CreateUserAccountDialog
    onSave={workspace.saveCreatedUser}
    onClose={() => (workspace.activeDialog = null)}
  />
{:else if workspace.activeDialog?.kind === 'create-group'}
  <CreateUserGroupDialog
    onSave={workspace.saveCreatedGroup}
    onClose={() => (workspace.activeDialog = null)}
  />
{:else if workspace.activeDialog?.kind === 'user-avatar'}
  <UserAvatarPicker
    userId={workspace.activeDialog.user.user_id}
    username={workspace.activeDialog.user.username}
    requireSuperPermission={true}
    onClose={() => (workspace.activeDialog = null)}
  />
{:else if workspace.activeDialog?.kind === 'user-groups'}
  <ManageListEditorDialog
    title={$t('manage.editUserGroupsTitle', { values: { username: workspace.activeDialog.user.username } })}
    description={$t('manage.editUserGroupsDescription')}
    icon="formatListBulleted"
    items={(workspace.activeDialog.user.groups ?? []).map((group) => ({ id: group, label: group }))}
    selected={workspace.activeDialog.user.groups ?? []}
    emptyMessage={$t('manage.noGroups')}
    onRefresh={workspace.refreshActiveUserGroups}
    onSave={workspace.saveActiveUserGroups}
    onClose={() => (workspace.activeDialog = null)}
  />
{:else if workspace.activeDialog?.kind === 'user-permissions'}
  <PermissionEntriesDialog
    title={$t('manage.editUserPermissionsTitle', { values: { username: workspace.activeDialog.user.username } })}
    description={$t('manage.editUserPermissionsDescription')}
    entries={workspace.activeDialog.user.permissions}
    effectivePermissions={workspace.activeDialog.user.effective_permissions}
    inheritedPermissions={workspace.activeDialog.user.effective_inherited_permissions}
    onRefresh={workspace.refreshActiveUserPermissions}
    onSave={workspace.saveActiveUserPermissions}
    onClose={() => (workspace.activeDialog = null)}
  />
{:else if workspace.activeDialog?.kind === 'reset-password'}
  <ResetUserPasswordDialog
    username={workspace.activeDialog.user.username}
    canDisableTwoFactor={workspace.canManage2fa}
    onSave={workspace.saveActiveResetPassword}
    onClose={() => (workspace.activeDialog = null)}
  />
{:else if workspace.activeDialog?.kind === 'account-management'}
  <ModalFrame
    title={$t('manage.accountManagementTitle', { values: { username: workspace.activeDialog.user.username } })}
    maxWidth="max-w-lg"
    closeLabel={$t('common.cancel')}
    onClose={() => (workspace.activeDialog = null)}
  >
    <div class="divide-y divide-md3-outline/60">
      {#if workspace.activeDialog.info}
        <section class="space-y-4 p-5" aria-labelledby="managed-account-status-title">
          <div>
            <h3 id="managed-account-status-title" class="text-sm font-semibold text-md3-on-surface">{$t('manage.accountStatus')}</h3>
            <p class="mt-1 text-xs leading-5 text-md3-on-surface-variant">{$t('manage.setAccountStatusDescription')}</p>
          </div>
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-md3-on-surface-variant">{$t('manage.currentAccountStatus')}</span>
            <span class={`rounded-full px-3 py-1 text-xs font-semibold ${workspace.activeDialog.info.status === 'active' ? 'bg-md3-primary-container text-md3-on-primary-container' : 'bg-md3-error-container text-md3-on-error-container'}`}>
              {workspace.activeDialog.info.status === 'active' ? $t('manage.statusActive') : $t('manage.statusDisabled')}
            </span>
          </div>
          <div class="grid gap-2 text-sm text-md3-on-surface">
            <MdOutlinedField inputId={`${outlinedId}-1`} label={workspace.activeDialog.info.status === 'disabled' ? $t('manage.replaceDisableReasonLabel') : $t('manage.disableReasonLabel')} disabled={workspace.busyKey !== null}>
              <textarea id={`${outlinedId}-1`} data-focus-ring="delegated" bind:value={workspace.accountDisableReason} maxlength="1024" rows="3" placeholder={$t('manage.disableReasonPlaceholder')} class="cfms-native-field w-full resize-y px-3 py-2.5 text-sm text-md3-on-surface transition disabled:opacity-50" disabled={workspace.busyKey !== null}></textarea>
            </MdOutlinedField>
            <span class="text-xs text-md3-on-surface-variant">
              {workspace.activeDialog.info.status === 'disabled' ? $t('manage.replaceDisableReasonHelp') : $t('manage.reasonOptional')}
            </span>
          </div>
          <div class="flex flex-wrap gap-2">
            {#if workspace.activeDialog.info.status === 'disabled'}
              <FluentButton data-fluent-owner="routes-home-manage-page"
                type="button"
                disabled={workspace.busyKey !== null}
                onclick={workspace.updateActiveAccountReason}
                appearance="subtle"
                class="flex items-center gap-2 rounded bg-md3-primary-container px-4 py-2 text-sm font-medium text-md3-on-primary-container transition-colors  disabled:opacity-50"
              >
                <Icon name="edit" size="18px" />
                {$t('manage.updateDisableReasonAction')}
              </FluentButton>
            {/if}
            <FluentButton data-fluent-owner="routes-home-manage-page"
              type="button"
              disabled={workspace.busyKey !== null}
              onclick={workspace.toggleActiveUserStatus}
              appearance="subtle"
              class="flex items-center gap-2 rounded bg-md3-surface-container-high px-4 py-2 text-sm font-medium text-md3-on-surface transition-colors hover:bg-md3-surface-container-highest disabled:opacity-50"
            >
              <Icon name={workspace.activeDialog.info.status === 'disabled' ? 'verifiedUser' : 'block'} size="18px" />
              {workspace.activeDialog.info.status === 'disabled' ? $t('manage.enableAccountAction') : $t('manage.disableAccountAction')}
            </FluentButton>
          </div>
        </section>
      {/if}

      {#if workspace.activeDialog.twoFactor || (workspace.canManage2fa && workspace.activeDialog.user.user_id !== authStore.userId)}
        <section class="space-y-4 p-5" aria-labelledby="managed-twofa-title">
          <div>
            <h3 id="managed-twofa-title" class="text-sm font-semibold text-md3-on-surface">{$t('manage.twoFactorManagement')}</h3>
            <p class="mt-1 text-xs leading-5 text-md3-on-surface-variant">{$t('manage.twoFactorManagementDescription')}</p>
          </div>
          {#if workspace.activeDialog.twoFactor}
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-md3-on-surface-variant">{$t('manage.twoFactorStatus')}</span>
            <span class={`rounded-full px-3 py-1 text-xs font-semibold ${workspace.activeDialog.twoFactor.enabled ? 'bg-md3-primary-container text-md3-on-primary-container' : 'bg-md3-surface-container-high text-md3-on-surface-variant'}`}>
              {workspace.activeDialog.twoFactor.enabled ? $t('common.enabled') : workspace.activeDialog.twoFactor.configured ? $t('authManagement.pendingTotp') : $t('authManagement.notRegistered')}
            </span>
          </div>
          {#if workspace.activeDialog.twoFactor.enabled}
            <dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
              <dt class="text-md3-on-surface-variant">{$t('manage.backupCodesRemaining')}</dt>
              <dd class="text-md3-on-surface">{workspace.activeDialog.twoFactor.backup_codes_count}</dd>
            </dl>
          {/if}
          {:else}<p class="text-sm text-md3-on-surface-variant">{$t('authManagement.inventoryPermissionRequired')}</p>{/if}
          {#if workspace.activeDialog.twoFactor?.enabled || !workspace.activeDialog.twoFactor}
            <FluentButton data-fluent-owner="routes-home-manage-page"
              type="button"
              disabled={workspace.busyKey !== null || !workspace.canManage2fa || workspace.activeDialog.user.user_id === authStore.userId}
              onclick={workspace.disableActiveUserTwoFactor}
              appearance="subtle"
              tone="danger"
              class="flex items-center gap-2 rounded bg-md3-error-container px-4 py-2 text-sm font-medium text-md3-on-error-container transition-all  disabled:opacity-50"
            >
              <Icon name="lockOpen" size="18px" />
              {$t('manage.disableUserTwoFactor')}
            </FluentButton>
          {/if}
        </section>
      {/if}
    </div>
  </ModalFrame>
{:else if workspace.activeDialog?.kind === 'block-user'}
  <BlockUserDialog
    username={workspace.activeDialog.user.username}
    onSave={workspace.saveActiveBlockUser}
    onClose={() => (workspace.activeDialog = null)}
  />
{:else if workspace.activeDialog?.kind === 'group-permissions'}
  <PermissionEntriesDialog
    title={$t('manage.editGroupPermissionsTitle', { values: { group: workspace.activeDialog.group.name } })}
    description={$t('manage.editGroupPermissionsDescription')}
    entries={workspace.activeDialog.group.permissions}
    effectivePermissions={workspace.activeDialog.group.effective_permissions}
    onRefresh={workspace.refreshActiveGroupPermissions}
    onSave={workspace.saveActiveGroupPermissions}
    onClose={() => (workspace.activeDialog = null)}
  />
{/if}

{#if workspace.detailTitle}
  <ModalFrame
    title={workspace.detailTitle}
    maxWidth="max-w-lg"
    closeLabel={$t('common.close')}
    onClose={() => (workspace.detailTitle = null)}
  >
    <div class="p-5 space-y-3">
      {#each workspace.detailRows as row}
        <div class="grid grid-cols-1 gap-1 text-sm sm:grid-cols-[140px_1fr] sm:gap-3">
          <span class="min-w-0 text-md3-on-surface-variant">{row.label}</span>
          <span class="text-md3-on-surface break-words">{row.value || '-'}</span>
        </div>
      {/each}
    </div>
  </ModalFrame>
{/if}

{#if workspace.blocksDialog}
  <ModalFrame
    title={$t('manage.blocksFor', { values: { username: workspace.blocksDialog.username } })}
    maxWidth="max-w-2xl"
    resizable
    maximizable
    minWidth={480}
    minHeight={360}
    closeLabel={$t('common.close')}
    onClose={() => (workspace.blocksDialog = null)}
  >
    <div class="h-full max-h-[70vh] space-y-3 overflow-auto p-5">
      {#if workspace.blocksDialog.blocks.length === 0}
        <p class="text-sm text-md3-on-surface-variant">{$t('manage.noActiveBlocks')}</p>
      {:else}
        {#each workspace.blocksDialog.blocks as block (block.block_id)}
          <div class="border border-md3-outline rounded-xl p-3 space-y-2">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium text-md3-on-surface truncate">
                  {$t('manage.blockRecordTitle', {
                    values: {
                      types: workspace.formatList(block.block_types),
                      target: workspace.formatBlockTarget(block),
                    },
                  })}
                </p>
                <p class="text-xs text-md3-on-surface-variant break-all">
                  {$t('manage.idWithValue', { values: { id: block.block_id } })}
                </p>
              </div>
              <div class="flex flex-none gap-1.5">
                <FluentButton data-fluent-owner="routes-home-manage-page"
                  onclick={() => workspace.handleEditBlockReason(block)}
                  disabled={workspace.busyKey !== null}
                  type="button"
                  appearance="subtle"
                  class="px-3 py-1 text-xs rounded bg-md3-primary-container text-md3-on-primary-container  disabled:opacity-50"
                >
                  {$t('common.edit')}
                </FluentButton>
                <FluentButton data-fluent-owner="routes-home-manage-page"
                  onclick={() => workspace.handleUnblock(block.block_id)}
                  disabled={workspace.busyKey !== null}
                  type="button"
                  appearance="subtle"
                  tone="danger"
                  class="px-3 py-1 text-xs rounded bg-md3-error-container\n                         text-md3-on-error-container  disabled:opacity-50"
                >
                  {$t('files.revoke')}
                </FluentButton>
              </div>
            </div>
            <p class="text-xs text-md3-on-surface-variant">
              {$t('manage.blockRecordPeriod', {
                values: {
                  created: workspace.formatDate(block.timestamp),
                  start: workspace.formatDate(block.not_before),
                  end: block.not_after === -1 ? $t('manage.permanent') : workspace.formatDate(block.not_after),
                },
              })}
            </p>
            <p class="whitespace-pre-wrap break-words text-xs text-md3-on-surface-variant">
              {$t('manage.blockRecordReason', { values: { reason: block.reason ?? $t('manage.noReason') } })}
            </p>
          </div>
        {/each}
      {/if}
    </div>
  </ModalFrame>
{/if}

{#snippet LoadingRow()}
  <div class="flex items-center gap-2 px-4 py-8 text-sm text-md3-on-surface-variant justify-center">
    <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
    {$t('common.loadingEllipsis')}
  </div>
{/snippet}

{#snippet PrimaryMetadataValue(value: string)}
  <p class="min-w-0 truncate text-xs leading-relaxed text-md3-on-surface-variant" title={value}>
    {value}
  </p>
{/snippet}

{#snippet MetadataLine(label: string, value: string)}
  <div class="grid min-w-0 grid-cols-[6.5rem_1fr] gap-2 text-xs leading-relaxed sm:grid-cols-[7.5rem_1fr]">
    <span class="text-md3-on-surface-variant/80">{label}</span>
    <span class="metadata-clamp min-w-0 text-md3-on-surface-variant" title={value}>{value}</span>
  </div>
{/snippet}

{#snippet ActionButton(icon: IconName, title: string, onClick: () => void | Promise<void>, disabled = false, danger = false)}
  <FluentButton data-fluent-owner="routes-home-manage-page"
    type="button"
    {title}
    aria-label={title}
    onclick={onClick}
    {disabled}
    appearance="subtle"
    tone="danger"
    class={"p-1.5 rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40\n           " + (danger
             ? 'text-md3-error hover:bg-md3-error-container/40'
             : 'text-md3-on-surface-variant hover:bg-md3-primary-container/40 hover:text-md3-primary-emphasis')}
    iconOnly
  >
    <Icon name={icon} size="18px" />
  </FluentButton>
{/snippet}

<style>
  .management-content--contained {
    overflow: hidden;
    border: 1px solid var(--color-md3-outline);
    border-radius: 0.75rem;
  }

  .identity-measure-host {
    position: absolute;
    width: max-content;
    height: 0;
    overflow: visible;
    visibility: hidden;
    pointer-events: none;
    white-space: nowrap;
  }

  .manage-list {
    container-type: inline-size;
  }

  .manage-list-row {
    display: grid;
    grid-template-columns:
      auto
      minmax(0, var(--manage-identity-width))
      minmax(0, 1fr)
      auto;
    align-items: center;
    column-gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 50%, transparent);
    transition: background-color 160ms ease;
  }

  .manage-list-row:last-child {
    border-bottom: 0;
  }

  .manage-list-row:hover {
    background: color-mix(in srgb, var(--color-md3-primary-container) 10%, transparent);
  }

  .manage-list-icon {
    display: inline-flex;
    grid-column: 1;
    width: 1.5rem;
    align-items: center;
    justify-content: center;
  }

  .manage-identity {
    grid-column: 2;
  }

  .metadata-stack {
    display: grid;
    grid-column: 3;
    min-width: 0;
    row-gap: 0.125rem;
  }

  .manage-list-actions {
    display: flex;
    grid-column: 4;
    min-width: max-content;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 4px;
  }

  .management-content--audit {
    overflow: visible;
  }

  .audit-table {
    table-layout: fixed;
    min-width: 40rem;
  }

  .audit-table th,
  .audit-table td {
    padding-inline: 0.5rem;
    overflow-wrap: anywhere;
  }

  .audit-active-filters {
    display: flex;
    min-height: 2.9rem;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 65%, transparent);
    padding: 0.5rem 1rem;
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 38%, transparent);
    font-family: var(--font-md3-sans);
  }

  .audit-active-filters__label {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 4px;
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    font-weight: 600;
  }

  .audit-filter-chips {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-wrap: wrap;
    gap: 4px;
  }

  .audit-filter-chip {
    display: inline-flex;
    min-width: 0;
    max-width: min(20rem, 100%);
    min-height: 1.75rem;
    align-items: center;
    gap: 4px;
    border-radius: 9999px;
    padding: 0.18rem 0.25rem 0.18rem 0.55rem;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  .audit-filter-chip code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-md3-mono);
    font-size: 12px;
  }

  .audit-filter-chip :global(:is(button[data-fluent-owner="routes-home-manage-page"], .cfms-button[data-fluent-owner="routes-home-manage-page"])) {
    display: inline-grid;
    width: 1.4rem;
    height: 1.4rem;
    flex: none;
    place-items: center;
    border-radius: 9999px;
    transition: background-color 120ms ease, opacity 120ms ease;
  }

  .audit-filter-chip :global(:is(button[data-fluent-owner="routes-home-manage-page"], .cfms-button[data-fluent-owner="routes-home-manage-page"]):hover:not(:is(:disabled, [disabled]))) {
    background: color-mix(in srgb, var(--color-md3-on-primary-container) 12%, transparent);
  }

  .audit-filter-chip :global(:is(button[data-fluent-owner="routes-home-manage-page"], .cfms-button[data-fluent-owner="routes-home-manage-page"]):is(:disabled, [disabled])),
  :global(.audit-filter-clear[data-fluent-owner="routes-home-manage-page"]:is(:disabled, [disabled])) {
    cursor: not-allowed;
    opacity: 0.45;
  }

  :global(.audit-filter-clear[data-fluent-owner="routes-home-manage-page"]) {
    min-height: 1.9rem;
    flex: none;
    border-radius: 5px;
    padding: 0.25rem 0.5rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 12px;
    font-weight: 600;
    transition: background-color 120ms ease, color 120ms ease;
  }

  :global(.audit-filter-clear[data-fluent-owner="routes-home-manage-page"]:hover:not(:is(:disabled, [disabled]))) {
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
  }

  .audit-filter-empty {
    display: grid;
    min-height: 11rem;
    place-items: center;
    align-content: center;
    gap: 12px;
    padding: 2rem 1rem;
    color: var(--color-md3-on-surface-variant);
    text-align: center;
    font-family: var(--font-md3-sans);
  }

  .audit-filter-empty__icon {
    display: inline-grid;
    width: 2.5rem;
    height: 2.5rem;
    place-items: center;
    border-radius: 9999px;
    color: var(--color-md3-primary-emphasis);
    background: var(--color-md3-primary-container);
  }

  .audit-filter-empty p {
    max-width: 42ch;
    font-size: 12px;
    line-height: 1.5;
  }

  .audit-filter-empty :global(:is(button[data-fluent-owner="routes-home-manage-page"], .cfms-button[data-fluent-owner="routes-home-manage-page"])) {
    min-height: 2rem;
    border-radius: var(--borderRadiusMedium);
    padding: 0.35rem 0.7rem;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
    font-size: 12px;
    font-weight: 600;
    transition: filter 120ms ease, transform 120ms ease;
  }

  .audit-filter-empty :global(:is(button[data-fluent-owner="routes-home-manage-page"], .cfms-button[data-fluent-owner="routes-home-manage-page"]):hover) {
    filter: none;
  }

  .audit-filter-empty :global(:is(button[data-fluent-owner="routes-home-manage-page"], .cfms-button[data-fluent-owner="routes-home-manage-page"]):active) {
    transform: none;
  }

  @media (pointer: coarse) {
    .audit-filter-chip {
      min-height: 2.5rem;
    }

    .audit-filter-chip :global(:is(button[data-fluent-owner="routes-home-manage-page"], .cfms-button[data-fluent-owner="routes-home-manage-page"])),
    :global(.audit-filter-clear[data-fluent-owner="routes-home-manage-page"]),
    .audit-filter-empty :global(:is(button[data-fluent-owner="routes-home-manage-page"], .cfms-button[data-fluent-owner="routes-home-manage-page"])) {
      min-width: 2.75rem;
      min-height: 2.75rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .audit-filter-chip :global(:is(button[data-fluent-owner="routes-home-manage-page"], .cfms-button[data-fluent-owner="routes-home-manage-page"])),
    :global(.audit-filter-clear[data-fluent-owner="routes-home-manage-page"]),
    .audit-filter-empty :global(:is(button[data-fluent-owner="routes-home-manage-page"], .cfms-button[data-fluent-owner="routes-home-manage-page"])) {
      transition: none;
    }

    .audit-filter-empty :global(:is(button[data-fluent-owner="routes-home-manage-page"], .cfms-button[data-fluent-owner="routes-home-manage-page"]):active) {
      transform: none;
    }
  }
  :global(.manage-action-toggle[data-fluent-owner="routes-home-manage-page"]) {
    display: none;
    grid-column: 4;
  }

  .manage-list-expanded {
    display: none;
    grid-column: 1 / -1;
    margin-top: 0.25rem;
  }

  .metadata-clamp {
    display: -webkit-box;
    max-height: 2.75rem;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }

  .manage-list--metadata-hidden .manage-list-row {
    grid-template-columns:
      auto
      minmax(0, var(--manage-identity-width))
      minmax(0, 1fr)
      auto;
  }

  .manage-list--metadata-hidden .metadata-stack {
    display: none;
  }

  .manage-list--metadata-hidden .manage-list-actions,
  .manage-list--metadata-hidden :global(.manage-action-toggle[data-fluent-owner="routes-home-manage-page"]) {
    grid-column: 4;
  }

  @container (max-width: 36rem) {
    .manage-list-row {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }

    .metadata-stack {
      display: none;
    }

    .manage-list-actions,
    :global(.manage-action-toggle[data-fluent-owner="routes-home-manage-page"]) {
      grid-column: 3;
    }
  }

  @container (max-width: 35rem) {
    .manage-list--accounts .manage-list-actions {
      display: none;
    }

    .manage-list--accounts :global(.manage-action-toggle[data-fluent-owner="routes-home-manage-page"]) {
      display: inline-flex;
    }

    .manage-list--accounts .manage-list-expanded {
      display: block;
    }
  }

  @container (max-width: 25rem) {
    .manage-list--groups .manage-list-actions {
      display: none;
    }

    .manage-list--groups :global(.manage-action-toggle[data-fluent-owner="routes-home-manage-page"]) {
      display: inline-flex;
    }

    .manage-list--groups .manage-list-expanded {
      display: block;
    }
  }
</style>

{#if workspace.activeDialog?.kind === 'username'}
  <ChangeUsernameDialog userId={workspace.activeDialog.user.user_id} username={workspace.activeDialog.user.username} onClose={() => { workspace.activeDialog = null; }} onSaved={workspace.loadActiveTab} />
{/if}
