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
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { _ as t } from "svelte-i18n";
  import { onBackButtonPress } from "@tauri-apps/api/app";
  import { initEventListeners } from "$lib/events";
  import { initI18n } from "$lib/i18n";
  import { initNavigationHistory, navigateUp } from "$lib/navigation";
  import { appUpdateState } from "$lib/app-update-state.svelte";
  import { screenProtectionStore } from "$lib/screen-protection.svelte";
  import {
    authStore,
    serverStateStore,
    serviceStatusStore,
    disclaimerStore,
    uploadStore,
    notificationStore,
  } from "$lib/stores.svelte";
  import { appLockStore } from "$lib/app-lock.svelte";
  import { clearAuthSession, getServiceStatus, getAuthStatus, getServerState } from "$lib/api";
  import AppLockOverlay from "$lib/components/AppLockOverlay.svelte";
  import LockdownBanner from "$lib/components/LockdownBanner.svelte";
  import DialogHost from "$lib/components/DialogHost.svelte";
  import NewUpdatePrompt from "$lib/components/NewUpdatePrompt.svelte";
  import SnackBarHost from "$lib/components/SnackBarHost.svelte";

  let { children }: { children: Snippet } = $props();
  let lastRecordedActivityAt = 0;
  initNavigationHistory();

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
    serverStateStore.lockdown && !page.url.pathname.startsWith(HOME_PREFIX),
  );
  const forcedScreenProtection = $derived(
    appLockStore.locked
      || appLockStore.pinSetupActive
      || (page.url.pathname === "/login" && serverStateStore.connected && !authStore.isLoggedIn),
  );
  const desiredScreenProtection = $derived(
    forcedScreenProtection || (authStore.isLoggedIn && screenProtectionStore.userEnabled),
  );

  // ---------------------------------------------------------------------------
  // Auth guard — runs reactively whenever the URL or auth state changes.
  // ---------------------------------------------------------------------------
  $effect(() => {
    const path = page.url.pathname;

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
</script>

<svelte:window
  oncontextmenu={preventDefaultContextMenu}
  onmousemove={recordUserActivity}
  onmousedown={recordUserActivity}
  onkeydown={recordUserActivity}
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
<div class="safe-area-shell flex h-full flex-col">
  <LockdownBanner active={showRootLockdownBanner} />
  <!--
    Bounded flex slot for the routed content.  `min-h-0` is essential: it lets
    this flex child shrink to the available space so descendant scroll
    containers (e.g. the home layout's <main>) work instead of growing the
    whole document.  Per-page transitions live in the individual layouts
    (e.g. /home) so navigation doesn't re-mount the entire app shell.
  -->
  <div class="safe-area-top flex-1 min-h-0">
    {@render children()}
  </div>
  <DialogHost />
  <SnackBarHost />
  <NewUpdatePrompt />
  <AppLockOverlay />
</div>
