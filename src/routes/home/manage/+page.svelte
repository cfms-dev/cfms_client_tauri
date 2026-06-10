<script lang="ts">
  // Manage page — Admin management hub.
  //
  // Sub-tab navigation for Accounts, Groups, and Audit Logs.
  // Only accessible to users with admin permissions.
  //
  // Reference: ManageModel in reference/src/include/ui/models/manage.py

  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { authStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  interface ManageTab {
    key: string;
    label: string;
    icon: IconName;
  }

  const tabs: ManageTab[] = [
    { key: 'accounts', label: $t('manage.accounts'), icon: 'supervisorAccount' },
    { key: 'groups',   label: $t('manage.groups'),   icon: 'groups' },
    { key: 'logs',     label: $t('manage.logs'),     icon: 'article' },
  ];

  let activeTab = $state('accounts');

  // Redirect non-admin users back to home.
  const isAdmin = $derived(
    authStore.permissions.some((p) =>
      ['manage_system', 'view_audit_logs', 'list_users', 'list_groups',
       'apply_lockdown', 'bypass_lockdown'].includes(p)
    )
  );
</script>

<div class="p-6 space-y-4">
  <!-- Back button -->
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => goto('/home/more')}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    {$t('manage.title')}
  </h1>

  {#if !isAdmin}
    <div class="bg-md3-error-container/60 border border-md3-error/30
                text-md3-on-error-container text-sm rounded-xl p-4">
      {$t('manage.noPermission')}
    </div>
  {:else}
    <!-- Sub-tab bar -->
    <div class="flex gap-1 bg-md3-surface-container-high/50 rounded-xl p-1 w-fit">
      {#each tabs as tab}
        <button
          class="px-4 py-1.5 text-xs rounded-lg font-medium transition-all flex items-center gap-1.5"
          class:bg-md3-primary-container={activeTab === tab.key}
          class:text-md3-on-primary-container={activeTab === tab.key}
          class:text-md3-on-surface-variant={activeTab !== tab.key}
          class:hover:bg-md3-surface-container-highest={activeTab !== tab.key}
          style="font-family: var(--font-md3-sans);"
          onclick={() => (activeTab = tab.key)}
        >
          <Icon name={tab.icon} size="16px" />
          {tab.label}
        </button>
      {/each}
    </div>

    <!-- Tab content -->
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-6 min-h-[200px]">
      {#if activeTab === 'accounts'}
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('manage.userAccounts')}
          </h2>
          <button
            class="px-3 py-1 text-xs rounded-full font-medium
                   bg-md3-primary-container text-md3-on-primary-container
                   hover:brightness-110 transition-all flex items-center gap-1"
            style="font-family: var(--font-md3-sans);"
          >
            <Icon name="groupAdd" size="14px" />
            {$t('manage.addAccount')}
          </button>
        </div>
        <p class="text-sm text-md3-on-surface-variant text-center py-8">
          {$t('manage.accountsUnavailable')}
        </p>
      {:else if activeTab === 'groups'}
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('manage.userGroups')}
          </h2>
          <button
            class="px-3 py-1 text-xs rounded-full font-medium
                   bg-md3-primary-container text-md3-on-primary-container
                   hover:brightness-110 transition-all flex items-center gap-1"
            style="font-family: var(--font-md3-sans);"
          >
            <Icon name="groupAdd" size="14px" />
            {$t('manage.addGroup')}
          </button>
        </div>
        <p class="text-sm text-md3-on-surface-variant text-center py-8">
          {$t('manage.groupsUnavailable')}
        </p>
      {:else}
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('manage.auditLogs')}
          </h2>
          <button
            class="px-3 py-1 text-xs rounded-full font-medium
                   bg-md3-primary-container text-md3-on-primary-container
                   hover:brightness-110 transition-all flex items-center gap-1"
            style="font-family: var(--font-md3-sans);"
          >
            <Icon name="refresh" size="14px" />
            {$t('common.refresh')}
          </button>
        </div>
        <p class="text-sm text-md3-on-surface-variant text-center py-8">
          {$t('manage.logsUnavailable')}
        </p>
      {/if}
    </div>
  {/if}
</div>
