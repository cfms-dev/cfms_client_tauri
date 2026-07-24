<script lang="ts">
  // CFMS Client — Root layout
  //
  // Provides the background gradient, initializes backend event listeners,
  // and enforces auth-gated navigation.  The sidebar has been removed in
  // favour of a bottom tab bar inside /home/+layout.svelte.
  //
  // Public routes:    /connect, /connect/disclaimer, /init
  // Auth routes:      /login (requires connection, not login)
  // Lockdown:         /lockdown (always accessible)
  // Protected routes: /home/* (requires full auth)
  //
  // Reference: main.py router + AppShared auth state in reference project.

  import "../app.css";
  import type { Snippet } from "svelte";
  import { onMount, tick } from "svelte";
  import { page } from "$app/state";
  import { afterNavigate, goto } from "$app/navigation";
  import { _ as t } from "svelte-i18n";
  import { onBackButtonPress } from "@tauri-apps/api/app";
  import { initEventListeners } from "$lib/events";
  import { initI18n } from "$lib/i18n";
  import { initNavigationHistory, navigateUp, parentRouteFor } from "$lib/navigation";
  import { appUpdateState } from "$lib/app-update-state.svelte";
  import { appearanceStore } from "$lib/appearance.svelte";
  import { screenProtectionStore } from "$lib/screen-protection.svelte";
  import {
    cycleKeyboardRegion,
    dispatchKeyboardCommand,
    KEYBOARD_HELP_SHORTCUTS,
    registerKeyboardCommands,
  } from "$lib/keyboard";
  import {
    authStore,
    serverStateStore,
    serviceStatusStore,
    disclaimerStore,
    uploadStore,
    notificationStore,
  } from "$lib/stores.svelte";
  import { appLockStore } from "$lib/app-lock.svelte";
  import { extensionsStore } from "$lib/extensions.svelte";
  import { USER_EXTENSIONS_ENABLED } from "$lib/feature-flags";
  import { clearAuthSession, getServiceStatus, getAuthStatus, getServerState } from "$lib/api";
  import AppLockOverlay from "$lib/components/AppLockOverlay.svelte";
  import LockdownBanner from "$lib/components/LockdownBanner.svelte";
  import DialogHost from "$lib/components/DialogHost.svelte";
  import NewUpdatePrompt from "$lib/components/NewUpdatePrompt.svelte";
  import SnackBarHost from "$lib/components/SnackBarHost.svelte";
  import KeyboardShortcutHelp from "$lib/components/KeyboardShortcutHelp.svelte";

  let { children }: { children: Snippet } = $props();
  let lastRecordedActivityAt = 0;
  let keyboardHelpOpen = $state(false);
  let hasShownLockdownBanner = $state(false);
  initNavigationHistory();

  afterNavigate((navigation) => {
    if (!navigation.from || navigation.from.url.pathname === navigation.to?.url.pathname) return;
    void tick().then(() => {
      const heading = document.querySelector<HTMLElement>(
        '.explorer-content h1, #app-main-content main h1, #app-main-content h1',
      );
      if (!heading) return;
      heading.tabIndex = -1;
      heading.dataset.programmaticFocus = 'true';
      heading.focus({ preventScroll: true });
    });
  });

  // Routes that don't require any connection/auth.
  const PUBLIC_ROUTES = ["/connect", "/connect/disclaimer", "/init"];
  // Routes that require WebSocket connection but not login.
  const CONNECTION_ROUTES = ["/login"];
  // Lockdown override route.
  const LOCKDOWN_ROUTE = "/lockdown";
  // Home routes that are intentionally reachable from /connect before login.
  const PUBLIC_HOME_ROUTES = ["/home/about", "/home/settings"];
  // Auth-protected route prefix.
  const HOME_PREFIX = "/home";

  function isPublicHomeRoute(path: string) {
    return PUBLIC_HOME_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
  }

  const showRootLockdownBanner = $derived(
    serverStateStore.lockdown && page.url.pathname !== LOCKDOWN_ROUTE,
  );
  const forcedScreenProtection = $derived(
    appLockStore.locked
      || appLockStore.pinSetupActive
      || (page.url.pathname === "/login" && serverStateStore.connected && !authStore.isLoggedIn),
  );
  const desiredScreenProtection = $derived(
    forcedScreenProtection || (authStore.isLoggedIn && screenProtectionStore.userEnabled),
  );

  $effect(() => {
    if (showRootLockdownBanner) hasShownLockdownBanner = true;
  });

  // ---------------------------------------------------------------------------
  // Auth guard — runs reactively whenever the URL or auth state changes.
  // ---------------------------------------------------------------------------
  $effect(() => {
    const path = page.url.pathname;

    // Extension routes remain compiled for ongoing development, but must not
    // be user-reachable until the release gate in feature-flags.ts is enabled.
    if (!USER_EXTENSIONS_ENABLED && path === "/home/settings/extensions") {
      goto("/home/settings", { replaceState: true });
      return;
    }
    if (!USER_EXTENSIONS_ENABLED && path.startsWith("/home/extensions")) {
      goto(authStore.isLoggedIn ? "/home/overview" : "/home/settings", { replaceState: true });
      return;
    }

    if (!authStore.isLoggedIn && !authStore.postLoginPending) {
      appLockStore.resetForSignedOut();
      screenProtectionStore.resetForSignedOut();
    }

    if (
      disclaimerStore.checked &&
      !disclaimerStore.accepted &&
      path !== "/connect/disclaimer"
    ) {
      goto("/connect/disclaimer", { replaceState: true });
      return;
    }

    // 1. Lockdown — only redirect authenticated users who lack bypass
    //    permission.  Users who haven't logged in yet can still reach the
    //    login page (the LockdownBanner will warn them).
    //
    //    Reference: lockdown_handler in
    //    reference/src/include/backend/event_handlers/lockdown.py
    if (
      serverStateStore.lockdown &&
      path !== LOCKDOWN_ROUTE &&
      authStore.isLoggedIn &&
      !authStore.permissions.includes("bypass_lockdown")
    ) {
      goto(LOCKDOWN_ROUTE, { replaceState: true });
      return;
    }

    // 2. If lockdown is cleared and we're on the lockdown page, resume the
    //    current session instead of discarding it.
    if (!serverStateStore.lockdown && path === LOCKDOWN_ROUTE) {
      goto(authStore.isLoggedIn ? "/home/overview" : serverStateStore.connected ? "/login" : "/connect", {
        replaceState: true,
      });
      return;
    }

    // 3. If not connected and trying to access protected/connection routes,
    //    redirect to connect.
    if (!serverStateStore.connected) {
      const hasReconnectTarget = serverStateStore.remoteAddress !== null;
      if (authStore.postLoginPending) {
        authStore.clear();
        appLockStore.resetForSignedOut();
        void clearAuthSession().catch(() => {
          /* backend may already be disconnected/cleared */
        });
        if (path !== "/connect") {
          goto("/connect", { replaceState: true });
        }
        return;
      }

      if (!hasReconnectTarget && (authStore.isLoggedIn || authStore.isPending2FA)) {
        authStore.clear();
        appLockStore.resetForSignedOut();
      }

      if (!hasReconnectTarget && !PUBLIC_ROUTES.includes(path) && path !== LOCKDOWN_ROUTE && !isPublicHomeRoute(path)) {
        goto("/connect", { replaceState: true });
        return;
      }
    }

    // 4. If connected but not logged in, and trying to access home routes,
    //    redirect to login.
    if (serverStateStore.connected && !authStore.isLoggedIn) {
      if (path.startsWith(HOME_PREFIX) && !isPublicHomeRoute(path)) {
        goto("/login", { replaceState: true });
        return;
      }
    }

    // The recycle bin exposes deleted-item metadata and must not be reachable
    // through a manually entered URL without the corresponding server grant.
    if (
      authStore.isLoggedIn
      && path === "/home/trash"
      && !authStore.permissions.includes("list_deleted_items")
    ) {
      goto("/home/files", { replaceState: true });
      return;
    }

    if (USER_EXTENSIONS_ENABLED && authStore.isLoggedIn && path === "/home/extensions/view" && extensionsStore.overview && !extensionsStore.loading) {
      const extensionId = page.url.searchParams.get("extension");
      if (!extensionId || !extensionsStore.enabledInstallations.some((item) => item.manifest.id === extensionId)) {
        goto("/home/overview", { replaceState: true });
        return;
      }
    }

    // 5. If fully authenticated and on connect or login, go to home.
    if (serverStateStore.connected && authStore.isLoggedIn && !authStore.postLoginPending) {
      if (path === "/connect" || path === "/login") {
        goto("/home/overview", { replaceState: true });
        return;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------
  onMount(async () => {
    await initI18n();
    await appLockStore.refreshPlatformAvailability();

    // Initialize disclaimer check.
    disclaimerStore.init();

    // Start listening for backend events.
    await initEventListeners();

    // Kick off one non-blocking update check for this client session.
    void appUpdateState.check();

    // Fetch initial service status.
    try {
      const status = await getServiceStatus();
      serviceStatusStore.setAll(status);
    } catch {
      setTimeout(async () => {
        try {
          const status = await getServiceStatus();
          serviceStatusStore.setAll(status);
        } catch {
          /* ignore */
        }
      }, 2000);
    }
  });

  onMount(() => appearanceStore.init());

  $effect(() => {
    if (authStore.postLoginPending) return;
    const scopeKey = authStore.isLoggedIn && authStore.username
      ? `user:${serverStateStore.remoteAddress ?? 'local'}:${authStore.username}`
      : 'global';
    void appearanceStore.load(scopeKey).catch((error) => {
      notificationStore.error(error instanceof Error ? error.message : String(error));
    });
  });

  $effect(() => {
    if (!authStore.isLoggedIn || !authStore.username) return;
    const scopeKey = `${serverStateStore.remoteAddress ?? 'local'}:${authStore.username}`;
    void appLockStore.init(scopeKey);
    void screenProtectionStore.init(scopeKey);
    void uploadStore.initConcurrency(scopeKey);
  });

  $effect(() => {
    void screenProtectionStore.apply(desiredScreenProtection);
  });

  onMount(() => {
    const unregisterCommands = registerKeyboardCommands([
      {
        id: 'global.home',
        label: () => $t('keyboard.goHome'),
        shortcuts: [{ key: '1', primary: true }],
        scope: 'global',
        enabled: () => authStore.isLoggedIn && !appLockStore.locked,
        allowInEditable: true,
        handler: () => goto('/home/overview'),
      },
      {
        id: 'global.files',
        label: () => $t('keyboard.goFiles'),
        shortcuts: [{ key: '2', primary: true }],
        scope: 'global',
        enabled: () => authStore.isLoggedIn && !appLockStore.locked,
        allowInEditable: true,
        handler: () => goto('/home/files'),
      },
      {
        id: 'global.tasks',
        label: () => $t('keyboard.goTasks'),
        shortcuts: [{ key: '3', primary: true }],
        scope: 'global',
        enabled: () => authStore.isLoggedIn && !appLockStore.locked,
        allowInEditable: true,
        handler: () => goto('/home/tasks'),
      },
      {
        id: 'global.settings',
        label: () => $t('keyboard.goSettings'),
        shortcuts: [{ key: ',', primary: true }],
        scope: 'global',
        enabled: () => !appLockStore.locked,
        allowInEditable: true,
        handler: () => goto('/home/settings'),
      },
      {
        id: 'global.back',
        label: () => $t('keyboard.goBack'),
        shortcuts: [{ key: 'ArrowLeft', alt: true }],
        scope: 'global',
        enabled: () => !appLockStore.locked && parentRouteFor(page.url.pathname) !== null,
        handler: () => navigateUp(page.url.pathname),
      },
      {
        id: 'global.help',
        label: () => $t('keyboard.openHelp'),
        shortcuts: KEYBOARD_HELP_SHORTCUTS,
        scope: 'global',
        enabled: () => !appLockStore.locked,
        allowInEditable: true,
        allowInModal: true,
        handler: () => { keyboardHelpOpen = !keyboardHelpOpen; },
      },
      {
        id: 'global.lock',
        label: () => $t('keyboard.lockApp'),
        shortcuts: [{ key: 'l', primary: true }],
        scope: 'global',
        enabled: () => authStore.isLoggedIn && appLockStore.canLock && !appLockStore.locked,
        allowInEditable: true,
        allowInModal: true,
        handler: () => { appLockStore.lock(); },
      },
      {
        id: 'global.cycle-region',
        label: () => $t('keyboard.cycleRegion'),
        shortcuts: [{ key: 'F6' }, { key: 'F6', shift: true }],
        scope: 'global',
        enabled: () => !appLockStore.locked,
        allowInEditable: true,
        handler: (event) => { cycleKeyboardRegion(event); },
      },
    ]);
    const openHelp = () => { keyboardHelpOpen = true; };
    window.addEventListener('cfms:keyboard-shortcuts', openHelp);
    return () => {
      unregisterCommands();
      window.removeEventListener('cfms:keyboard-shortcuts', openHelp);
    };
  });

  onMount(() => {
    let removeBackButtonListener: (() => void) | null = null;
    let handlingBackButton = false;

    onBackButtonPress(() => {
      void (async () => {
        if (handlingBackButton) return;
        handlingBackButton = true;
        try {
          await navigateUp(page.url.pathname, {
            onBackgroundUnavailable: () => {
              notificationStore.warning($t('settings.behavior.rootBackBackgroundUnavailable'), 5000);
            },
          });
        } finally {
          handlingBackButton = false;
        }
      })();
    })
      .then((listener) => {
        removeBackButtonListener = () => {
          void listener.unregister();
        };
      })
      .catch(() => {
        /* Non-mobile platforms do not provide the Android back-button event. */
      });

    return () => removeBackButtonListener?.();
  });

  onMount(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (appLockStore.lockForBackground()) {
          void screenProtectionStore.apply(true);
        }
      } else {
        appLockStore.recordActivity();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  });

  // Periodic auth status polling (every 30s).
  $effect(() => {
    const interval = setInterval(async () => {
      try {
        const serverState = await getServerState();
        serverStateStore.apply(serverState);

        if (!serverState.connected) {
          if (authStore.isLoggedIn || authStore.isPending2FA) {
            const hasReconnectTarget = serverState.server_address !== null;
            if (!hasReconnectTarget) {
              authStore.clear();
              appLockStore.resetForSignedOut();
              void clearAuthSession().catch(() => {
                /* backend may already be disconnected/cleared */
              });
            }
          }
          return;
        }

        if (!authStore.postLoginPending) {
          authStore.apply(await getAuthStatus());
        }
      } catch {
        /* ignore */
      }
    }, 30_000);
    return () => clearInterval(interval);
  });

  function shouldAllowNativeContextMenu(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    if (target.closest('input, textarea, [contenteditable="true"], .allow-native-context-menu')) {
      return true;
    }
    if (
      typeof window !== 'undefined'
      && window.matchMedia('(pointer: coarse)').matches
      && !target.closest('button, a, select, [role="button"], [role="menu"], [role="menuitem"], .select-none, .no-select')
    ) {
      return true;
    }
    return false;
  }

  function preventDefaultContextMenu(event: MouseEvent) {
    if (shouldAllowNativeContextMenu(event.target)) return;
    event.preventDefault();
  }

  function recordUserActivity() {
    const now = Date.now();
    if (now - lastRecordedActivityAt < 1000) return;
    lastRecordedActivityAt = now;
    appLockStore.recordActivity();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    recordUserActivity();
    dispatchKeyboardCommand(event);
  }
</script>

<svelte:window
  oncontextmenu={preventDefaultContextMenu}
  onmousemove={recordUserActivity}
  onmousedown={recordUserActivity}
  onkeydown={handleWindowKeydown}
  ontouchstart={recordUserActivity}
  onwheel={recordUserActivity}
/>

<!--
  Root layout wrapper — the gradient background is set on <body> via app.css.
  The LockdownBanner is rendered here (not just in /home) so it is visible
  on the connect and login pages as well, matching the Python reference
  which places it in page.overlay.

  Each route area provides its own chrome (tab bar, AppBar, etc.).
-->
<div
  class="safe-area-shell flex h-full flex-col"
  class:lockdown-banner-active={showRootLockdownBanner}
  class:lockdown-banner-releasing={hasShownLockdownBanner && !showRootLockdownBanner}
>
  <a class="keyboard-skip-link" href="#app-main-content">{$t('keyboard.skipToContent')}</a>
  <LockdownBanner active={showRootLockdownBanner} />
  <!--
    Bounded flex slot for the routed content.  `min-h-0` is essential: it lets
    this flex child shrink to the available space so descendant scroll
    containers (e.g. the home layout's <main>) work instead of growing the
    whole document.  Per-page transitions live in the individual layouts
    (e.g. /home) so navigation doesn't re-mount the entire app shell.
  -->
  <div
    id="app-main-content"
    class="safe-area-top flex-1 min-h-0"
    data-keyboard-region={page.url.pathname.startsWith('/home') ? undefined : 'main'}
    tabindex="-1"
  >
    {@render children()}
  </div>
  <DialogHost />
  <SnackBarHost />
  <NewUpdatePrompt />
  <AppLockOverlay />
  <KeyboardShortcutHelp open={keyboardHelpOpen} onClose={() => (keyboardHelpOpen = false)} />
</div>

<style>
  .safe-area-shell {
    position: relative;
    /* Keep this in sync with the banner's one-line content box. The safe-area
       inset is transferred from the route content to the banner separately. */
    --lockdown-banner-content-height: 2.5rem;
  }

  .lockdown-banner-active .safe-area-top {
    padding-top: 0;
    animation: lockdown-content-push
      var(--motion-duration-medium2)
      var(--motion-easing-emphasized-decelerate);
  }

  .lockdown-banner-releasing .safe-area-top {
    animation: lockdown-content-release
      var(--motion-duration-medium1)
      var(--motion-easing-emphasized-accelerate);
  }

  @keyframes lockdown-content-push {
    from {
      /* The banner takes its final space in one layout pass. Moving the route
         layer back to its old position makes the visual push compositor-only. */
      transform: translate3d(0, calc(-1 * var(--lockdown-banner-content-height)), 0);
    }

    to {
      transform: translate3d(0, 0, 0);
    }
  }

  @keyframes lockdown-content-release {
    from {
      transform: translate3d(0, var(--lockdown-banner-content-height), 0);
    }

    to {
      transform: translate3d(0, 0, 0);
    }
  }

  .keyboard-skip-link {
    position: fixed;
    top: max(0.5rem, var(--safe-area-top, 0px));
    left: max(0.5rem, var(--safe-area-left, 0px));
    z-index: 9999;
    width: 1px;
    height: 1px;
    overflow: hidden;
    border-radius: 999px;
    padding: 0;
    clip-path: inset(50%);
    color: var(--color-md3-on-primary);
    background: var(--color-md3-primary);
    box-shadow: var(--explorer-shadow);
    font-size: 0.8rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .keyboard-skip-link:focus-visible {
    width: auto;
    height: auto;
    overflow: visible;
    padding: 0.55rem 0.9rem;
    clip-path: none;
  }

  /* Touch navigation does not need a keyboard-only skip control. Keeping it
     out of the mobile layout also guarantees it cannot overlap system chrome
     when a WebView reports an incomplete safe-area inset. */
  @media (hover: none) and (pointer: coarse) {
    .keyboard-skip-link { display: none; }
  }

</style>
