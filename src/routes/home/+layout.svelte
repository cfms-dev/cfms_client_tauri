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
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { _ as t } from 'svelte-i18n';
  import { authStore, serverStateStore, downloadStore, uploadStore, chromeStore } from '$lib/stores.svelte';
  import SwipePager from '$lib/components/SwipePager.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import { flyScale } from '$lib/motion/transitions';
  import type { IconName } from '$lib/icons';
  import FilesPage from './files/+page.svelte';
  import TasksPage from './tasks/+page.svelte';
  import OverviewPage from './overview/+page.svelte';
  import MorePage from './more/+page.svelte';

  let { children }: { children: Snippet } = $props();
  let isMobileTabShell = $state(false);

  // Routes that use the tab bar (show the bottom navigation).
  const TAB_ROUTES = ['/home/overview', '/home/files', '/home/tasks', '/home/more'];

  const showTabBar = $derived(TAB_ROUTES.includes($page.url.pathname));

  const activeTaskCount = $derived(downloadStore.activeTasks.length + uploadStore.activeTasks.length);
  const tabPadding = $derived(showTabBar ? 112 + chromeStore.snackbarStackHeight : 0);

  interface TabDef {
    href: string;
    label: string;
    icon: IconName;
    badge?: number;
    hidden?: boolean;
  }

  // The four primary destinations.  Management is intentionally NOT here —
  // it is an admin-only area reached via More → Management, and the Manage
  // screen itself runs without the bottom bar.
  const tabs = $derived<TabDef[]>([
    { href: '/home/files',    label: $t('nav.files'),   icon: 'files' },
    { href: '/home/tasks',    label: $t('nav.tasks'),   icon: 'tasks',   badge: activeTaskCount },
    { href: '/home/overview', label: $t('nav.home'),    icon: 'home' },
    { href: '/home/more',     label: $t('nav.more'),    icon: 'more' },
  ]);
  const activeTabIndex = $derived(Math.max(0, tabs.findIndex((tab) => tab.href === $page.url.pathname)));

  onMount(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => {
      isMobileTabShell = media.matches;
    };

    update();
    media.addEventListener('change', update);

    return () => {
      media.removeEventListener('change', update);
    };
  });

  function handlePagerIndexChange(index: number) {
    const next = tabs[index];
    if (!next || next.href === $page.url.pathname) return;

    goto(next.href);
  }
</script>

<div class="relative flex h-full min-h-0 flex-col">
  <!-- Top bar -->
  <header class="flex min-h-12 items-center px-4 bg-md3-surface/80 backdrop-blur-sm
                  border-b border-md3-outline shrink-0 z-10">
    <div class="ml-auto flex items-center gap-3">
      {#if authStore.isLoggedIn}
        <span class="text-xs text-md3-on-surface-variant">
          {authStore.nickname ?? authStore.username}
        </span>
        {#if serverStateStore.connected}
          <span class="w-2 h-2 bg-md3-success rounded-full" title={$t('common.connected')}></span>
        {:else}
          <span class="w-2 h-2 bg-md3-error rounded-full" title={$t('common.disconnected')}></span>
        {/if}
      {/if}
    </div>
  </header>

  {#if showTabBar && isMobileTabShell}
    <SwipePager
      activeIndex={activeTabIndex}
      pageCount={tabs.length}
      bottomPadding={tabPadding}
      ariaLabel={$t('nav.mainNavigation')}
      onIndexChange={handlePagerIndexChange}
    >
      <section class="swipe-pager-page">
        <FilesPage />
      </section>
      <section class="swipe-pager-page">
        <TasksPage />
      </section>
      <section class="swipe-pager-page">
        <OverviewPage />
      </section>
      <section class="swipe-pager-page">
        <MorePage />
      </section>
    </SwipePager>
  {:else}
    <!--
      Scroll container.  `min-h-0` lets this flex child shrink so it actually
      scrolls instead of growing the layout.  The keyed wrapper plays a smooth
      entrance per route (in-only, so outgoing/incoming pages never overlap or
      trap clicks).  Extra bottom padding clears the floating tab bar.
    -->
    <main class="flex-1 min-h-0 overflow-y-auto">
      {#key $page.url.pathname}
        <div
          in:flyScale={{ y: 12, duration: 300 }}
          style={showTabBar ? `padding-bottom: ${tabPadding}px; transition: padding-bottom 520ms var(--motion-easing-emphasized-decelerate);` : ''}
        >
          {@render children()}
        </div>
      {/key}
    </main>
  {/if}

  <!-- Floating capsule tab bar (position: fixed, so it never affects flow). -->
  {#if showTabBar}
    <TabBar {tabs} />
  {/if}
</div>
