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
  import { authStore, serverStateStore, downloadStore, uploadStore, chromeStore, notificationStore } from '$lib/stores.svelte';
  import { setLockdown } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import { flyScale } from '$lib/motion/transitions';
  import type { IconName } from '$lib/icons';

  let { children }: { children: Snippet } = $props();
  let lockdownBusy = $state(false);

  // Routes that use the tab bar (show the bottom navigation).
  const TAB_ROUTES = ['/home/overview', '/home/files', '/home/tasks', '/home/more'];

  const showTabBar = $derived(TAB_ROUTES.includes($page.url.pathname));
  const canApplyLockdown = $derived(
    authStore.isLoggedIn
      && serverStateStore.connected
      && authStore.permissions.some((permission) =>
        permission === 'apply_lockdown' || permission === 'manage_system'
      ),
  );

  const activeTaskCount = $derived(downloadStore.activeTasks.length + uploadStore.activeTasks.length);
  const tabPadding = $derived(showTabBar ? 112 + chromeStore.snackbarStackHeight : 0);
  const floatingLift = $derived(chromeStore.snackbarStackHeight);

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

  async function toggleLockdown() {
    if (lockdownBusy) return;
    const nextStatus = !serverStateStore.lockdown;

    lockdownBusy = true;
    try {
      await setLockdown(nextStatus);
      serverStateStore.lockdown = nextStatus;
      notificationStore.success(
        nextStatus ? $t('lockdown.enabled') : $t('lockdown.disabled'),
      );
    } catch (err) {
      notificationStore.error(err instanceof Error ? err.message : String(err));
    } finally {
      lockdownBusy = false;
    }
  }
</script>

<div class="relative flex h-full min-h-0 flex-col">
  <!-- Top bar -->
  <header
    class="home-topbar relative flex min-h-12 items-center overflow-hidden px-4 bg-md3-surface/80 backdrop-blur-sm
           border-b border-md3-outline shrink-0 z-10"
    class:home-topbar--lockdown={serverStateStore.lockdown}
  >
    {#if serverStateStore.lockdown}
      <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 text-white">
        <Icon name="warning" size="20px" />
        <span class="text-base font-bold" style="font-family: var(--font-md3-serif);">
          {$t('lockdown.banner')}
        </span>
      </div>
    {/if}

    <div class="relative z-20 ml-auto flex items-center gap-3">
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

  {#if showTabBar && canApplyLockdown}
    <button
      type="button"
      role="switch"
      aria-checked={serverStateStore.lockdown}
      aria-label={$t('lockdown.toggleAction')}
      title={serverStateStore.lockdown ? $t('lockdown.disableAction') : $t('lockdown.enableAction')}
      class="lockdown-fab fixed right-5 z-50 inline-flex h-14 w-14 items-center justify-center rounded-2xl p-0 shadow-2xl transition-all disabled:opacity-60"
      class:lockdown-fab--active={serverStateStore.lockdown}
      style={`bottom: calc(1.25rem + var(--safe-area-bottom, 0px) + ${floatingLift}px); transition: bottom 520ms var(--motion-easing-emphasized-decelerate), transform 200ms var(--motion-easing-standard), background 250ms var(--motion-easing-standard);`}
      onclick={toggleLockdown}
      disabled={lockdownBusy}
      in:flyScale={{ y: 14, duration: 260 }}
    >
      {#if lockdownBusy}
        <ProgressRing size={20} strokeWidth={2.5} label={$t('common.saving')} />
      {:else}
        <Icon name="supervisedUserCircleOff" size="24px" />
      {/if}
    </button>
  {/if}
</div>

<style>
  .lockdown-fab {
    border: 1px solid color-mix(in srgb, var(--color-md3-primary) 45%, transparent);
    color: var(--color-md3-on-primary-container);
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--color-md3-primary) 78%, #ffffff 8%), var(--color-md3-primary-container));
    box-shadow:
      0 18px 46px rgba(0, 0, 0, 0.34),
      0 1px 0 rgba(255, 255, 255, 0.22) inset;
  }

  .lockdown-fab:hover:not(:disabled) {
    transform: translateY(-2px);
  }

  .lockdown-fab--active {
    border-color: color-mix(in srgb, var(--color-md3-error) 62%, transparent);
    color: var(--color-md3-on-error-container);
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--color-md3-error-container) 86%, #ffffff 8%), #991b1b);
  }

  .home-topbar--lockdown::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    background-color: rgb(220 38 38 / 1);
    animation: lockdown-topbar-pulse 3s linear infinite;
  }

  @keyframes lockdown-topbar-pulse {
    0% {
      background-color: rgb(220 38 38 / 1);
    }

    3.33% {
      background-color: rgb(220 38 38 / 0);
    }

    50% {
      background-color: rgb(220 38 38 / 0);
    }

    53.33% {
      background-color: rgb(220 38 38 / 1);
    }

    100% {
      background-color: rgb(220 38 38 / 1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .lockdown-fab,
    .home-topbar--lockdown::before {
      transition: none !important;
      animation: none !important;
    }
  }
</style>
