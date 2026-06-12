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
  import { _ as t } from 'svelte-i18n';
  import { downloadStore, uploadStore, chromeStore } from '$lib/stores.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import { flyScale } from '$lib/motion/transitions';
  import type { IconName } from '$lib/icons';

  let { children }: { children: Snippet } = $props();

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
</script>

<div class="relative flex h-full min-h-0 flex-col">
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

  <!-- Floating capsule tab bar (position: fixed, so it never affects flow). -->
  {#if showTabBar}
    <TabBar {tabs} />
  {/if}
</div>
