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
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { authStore, serverStateStore, downloadStore, uploadStore, chromeStore, notificationStore } from '$lib/stores.svelte';
  import { clearAuthSession, disconnect, setLockdown } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import AvatarPreview from '$lib/components/AvatarPreview.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import { consumeConnectToUtilityTransition } from '$lib/auth-transition';
  import { flyScale } from '$lib/motion/transitions';
  import type { IconName } from '$lib/icons';

  let { children }: { children: Snippet } = $props();
  let lockdownBusy = $state(false);
  let accountMenuOpen = $state(false);
  let accountActionBusy = $state(false);
  let viewportWidth = $state(0);
  let accountCloseTimer: number | null = null;
  let playConnectUtilityTransition = $state(browser ? consumeConnectToUtilityTransition() : false);

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
  const snackbarLift = $derived(chromeStore.snackbarStackHeight);
  const lockdownNavLift = $derived(showTabBar && viewportWidth > 0 && viewportWidth <= 640 ? 86 : 0);

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

  function closeAccountMenu() {
    if (accountCloseTimer !== null) {
      window.clearTimeout(accountCloseTimer);
      accountCloseTimer = null;
    }
    accountMenuOpen = false;
  }

  function toggleAccountMenu(event: MouseEvent) {
    event.stopPropagation();
    accountMenuOpen = !accountMenuOpen;
  }

  function openAccountMenu() {
    if (accountCloseTimer !== null) {
      window.clearTimeout(accountCloseTimer);
      accountCloseTimer = null;
    }
    accountMenuOpen = true;
  }

  function scheduleAccountMenuClose() {
    if (accountCloseTimer !== null) {
      window.clearTimeout(accountCloseTimer);
    }
    accountCloseTimer = window.setTimeout(() => {
      accountMenuOpen = false;
      accountCloseTimer = null;
    }, 180);
  }

  async function handleLogout() {
    if (accountActionBusy) return;
    accountActionBusy = true;
    try {
      await clearAuthSession();
      authStore.clear();
      await goto('/login', { replaceState: true });
    } catch (err) {
      notificationStore.error(err instanceof Error ? err.message : String(err));
    } finally {
      accountActionBusy = false;
      accountMenuOpen = false;
    }
  }

  async function handleDisconnect() {
    if (accountActionBusy) return;
    accountActionBusy = true;
    try {
      await disconnect();
      await clearAuthSession();
      authStore.clear();
      serverStateStore.clear();
      await goto('/connect', { replaceState: true });
    } catch (err) {
      notificationStore.error(err instanceof Error ? err.message : String(err));
    } finally {
      accountActionBusy = false;
      accountMenuOpen = false;
    }
  }
</script>

<svelte:window bind:innerWidth={viewportWidth} onclick={closeAccountMenu} onkeydown={(event) => { if (event.key === 'Escape') closeAccountMenu(); }} />

<div
  class="relative flex h-full min-h-0 flex-col"
  class:home-shell--connect-utility={playConnectUtilityTransition}
>
  <!-- Top bar -->
  <header
    class="home-topbar relative flex min-h-10 items-center overflow-visible px-4 bg-md3-surface/80 backdrop-blur-sm
           border-b border-md3-outline shrink-0 z-10"
    class:home-topbar--lockdown={serverStateStore.lockdown}
  >
    {#if serverStateStore.lockdown}
      <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 text-white">
        <Icon name="warning" size="18px" />
        <span class="text-sm font-bold" style="font-family: var(--font-md3-serif);">
          {$t('lockdown.banner')}
        </span>
      </div>
    {/if}

    <div class="relative z-20 ml-auto flex items-center gap-3">
      {#if authStore.isLoggedIn}
        <div
          class="relative"
          role="presentation"
          onpointerenter={openAccountMenu}
          onpointerleave={scheduleAccountMenuClose}
        >
          <button
            type="button"
            class="account-trigger inline-flex max-w-[15rem] items-center gap-2 rounded-full px-2.5 py-1.5 text-xs text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high/70 hover:text-md3-on-surface"
            aria-label={$t('common.accountMenu')}
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            onclick={toggleAccountMenu}
          >
            <span
              class={`h-2 w-2 rounded-full ${serverStateStore.connected ? 'bg-md3-success' : 'bg-md3-error'}`}
              title={serverStateStore.connected ? $t('common.connected') : $t('common.disconnected')}
            ></span>
            <span class="min-w-0 truncate">
              {authStore.nickname ?? authStore.username}
            </span>
            <Icon name="expandMore" size="16px" />
          </button>

          {#if accountMenuOpen}
            <div
              class="account-menu absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-60 overflow-hidden rounded-lg border border-md3-outline/70 bg-md3-surface-container/95 py-1 shadow-2xl backdrop-blur-xl"
              role="menu"
              tabindex="-1"
              in:flyScale={{ y: -6, duration: 180 }}
              out:flyScale={{ y: -4, duration: 120 }}
              onclick={(event) => event.stopPropagation()}
              onkeydown={(event) => event.stopPropagation()}
            >
              <div class="flex items-center gap-3 border-b border-md3-outline/50 px-3 py-2.5">
                <AvatarPreview
                  username={authStore.username ?? ''}
                  avatarPath={authStore.avatarPath}
                  size={34}
                />
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-md3-on-surface">{authStore.nickname ?? authStore.username}</p>
                  <p class="truncate text-xs text-md3-on-surface-variant">{authStore.username}</p>
                </div>
              </div>
              <button
                type="button"
                class="account-menu-item"
                role="menuitem"
                disabled={accountActionBusy}
                onclick={handleLogout}
              >
                <Icon name="logout" size="18px" />
                <span>{$t('lockdown.logout')}</span>
              </button>
              <button
                type="button"
                class="account-menu-item"
                role="menuitem"
                disabled={accountActionBusy}
                onclick={handleDisconnect}
              >
                <Icon name="connect" size="18px" />
                <span>{$t('lockdown.disconnect')}</span>
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </header>

  <!--
    Scroll container.  `min-h-0` lets this flex child shrink so it actually
    scrolls instead of growing the layout.  The keyed wrapper plays a smooth
    entrance per route (in-only, so outgoing/incoming pages never overlap or
    trap clicks).  Extra bottom padding clears the floating tab bar.
  -->
  <main
    class="flex-1 min-h-0 overflow-y-auto"
    class:home-main--connect-utility={playConnectUtilityTransition}
  >
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
      style={`--lockdown-snackbar-lift: ${snackbarLift}px; --lockdown-nav-lift: ${lockdownNavLift}px;`}
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
    bottom: calc(1.25rem + var(--safe-area-bottom, 0px));
    border: 1px solid color-mix(in srgb, var(--color-md3-primary) 45%, transparent);
    color: var(--color-md3-on-primary-container);
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--color-md3-primary) 78%, #ffffff 8%), var(--color-md3-primary-container));
    transition:
      bottom 520ms var(--motion-easing-emphasized-decelerate),
      transform 200ms var(--motion-easing-standard),
      background 250ms var(--motion-easing-standard);
    box-shadow:
      0 18px 46px rgba(0, 0, 0, 0.34),
      0 1px 0 rgba(255, 255, 255, 0.22) inset;
  }

  .home-shell--connect-utility .home-topbar {
    animation: utility-topbar-enter 260ms var(--motion-easing-emphasized-decelerate) both;
    will-change: opacity, transform;
  }

  .home-main--connect-utility {
    animation: utility-main-enter 360ms var(--motion-easing-emphasized-decelerate) both;
    transform-origin: calc(100% - 3rem) 0.75rem;
    will-change: opacity, transform, filter;
  }

  .account-menu-item {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.65rem;
    padding: 0.48rem 0.75rem;
    color: var(--color-md3-on-surface);
    font-size: 0.8125rem;
    text-align: left;
    transition:
      background-color 160ms var(--motion-easing-standard),
      color 160ms var(--motion-easing-standard);
  }

  .account-menu-item:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-md3-primary-container) 45%, transparent);
    color: var(--color-md3-primary-emphasis);
  }

  .account-menu-item:disabled {
    opacity: 0.5;
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

  @media (max-width: 640px) {
    .lockdown-fab {
      bottom: calc(1.25rem + var(--safe-area-bottom, 0px) + var(--lockdown-snackbar-lift, 0px) + var(--lockdown-nav-lift, 0px));
    }
  }

  .home-topbar--lockdown::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    background-color: rgb(220 38 38 / 0);
    animation: lockdown-topbar-pulse 3s linear infinite;
  }

  @keyframes lockdown-topbar-pulse {
    0% {
      background-color: rgb(220 38 38 / 0);
    }

    46.67% {
      background-color: rgb(220 38 38 / 0);
    }

    50% {
      background-color: rgb(220 38 38 / 1);
    }

    96.67% {
      background-color: rgb(220 38 38 / 1);
    }

    100% {
      background-color: rgb(220 38 38 / 0);
    }
  }

  @keyframes utility-topbar-enter {
    from {
      opacity: 0;
      transform: translate3d(0, -8px, 0);
    }

    to {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes utility-main-enter {
    0% {
      opacity: 0;
      transform: translate3d(0, -10px, 0) scale(0.985);
      filter: blur(6px);
    }

    72% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1.002);
      filter: blur(0);
    }

    100% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
      filter: blur(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .lockdown-fab,
    .home-topbar--lockdown::before,
    .home-shell--connect-utility .home-topbar,
    .home-main--connect-utility {
      transition: none !important;
      animation: none !important;
    }

    .home-topbar--lockdown::before {
      background-color: rgb(220 38 38 / 1);
    }
  }
</style>
