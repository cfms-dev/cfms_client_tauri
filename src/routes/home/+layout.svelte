<script lang="ts">
  // Home layout — tab bar shell for the main authenticated experience.
  //
  // Provides a bottom TabBar with 4 primary tabs (Files, Tasks, Home, More)
  // and a 5th Manage tab visible only for admin users.
  //
  // The tab bar is hidden for sub-pages (settings, about, trash, manage)
  // which provide their own AppBar-based navigation.
  //
  // Reference: HomeModel in reference/src/include/ui/models/home.py

  import type { Snippet } from 'svelte';
  import { page } from '$app/stores';
  import { authStore, serverStateStore, downloadStore } from '$lib/stores.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import type { IconName } from '$lib/icons';

  let { children }: { children: Snippet } = $props();

  // Routes that use the tab bar (show the bottom navigation).
  const TAB_ROUTES = ['/home/overview', '/home/files', '/home/tasks', '/home/more'];

  const showTabBar = $derived(TAB_ROUTES.includes($page.url.pathname));

  // Admin check — matches the reference's permission checks.
  const isAdmin = $derived(
    authStore.permissions.some((p) =>
      ['manage_system', 'view_audit_logs', 'list_users', 'list_groups',
       'apply_lockdown', 'bypass_lockdown'].includes(p)
    )
  );

  const activeTaskCount = $derived(downloadStore.activeTasks.length);

  interface TabDef {
    href: string;
    label: string;
    icon: IconName;
    badge?: number;
    hidden?: boolean;
  }

  const tabs = $derived<TabDef[]>([
    { href: '/home/files',    label: 'Files',   icon: 'files' },
    { href: '/home/tasks',    label: 'Tasks',   icon: 'tasks',   badge: activeTaskCount },
    { href: '/home/overview', label: 'Home',    icon: 'home' },
    { href: '/home/more',     label: 'More',    icon: 'more' },
    { href: '/home/manage',   label: 'Manage',  icon: 'manage',  hidden: !isAdmin },
  ]);
</script>

<div class="flex flex-col h-full">
  <!-- Top bar -->
  <header class="flex items-center h-12 px-4 bg-md3-surface/80 backdrop-blur-sm
                  border-b border-md3-outline shrink-0">
    <span class="text-sm font-semibold text-md3-on-surface"
          style="font-family: var(--font-md3-sans);">
      CFMS
    </span>

    <div class="ml-auto flex items-center gap-3">
      {#if authStore.isLoggedIn}
        <span class="text-xs text-md3-on-surface-variant">
          {authStore.nickname ?? authStore.username}
        </span>
        {#if serverStateStore.connected}
          <span class="w-2 h-2 bg-md3-success rounded-full" title="Connected"></span>
        {:else}
          <span class="w-2 h-2 bg-md3-error rounded-full" title="Disconnected"></span>
        {/if}
      {:else}
        <span class="text-xs text-md3-on-surface-variant">Not signed in</span>
      {/if}
    </div>
  </header>

  <!-- Page content -->
  <main class="flex-1 overflow-y-auto page-enter">
    {@render children()}
  </main>

  <!-- Bottom tab bar -->
  {#if showTabBar}
    <TabBar tabs={tabs} />
  {/if}
</div>
