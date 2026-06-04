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
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { initEventListeners } from "$lib/events";
  import { authStore, serverStateStore, serviceStatusStore, disclaimerStore } from "$lib/stores.svelte";
  import { getServiceStatus, getAuthStatus, getServerState } from "$lib/api";
  import LockdownBanner from "$lib/components/LockdownBanner.svelte";

  let { children }: { children: Snippet } = $props();

  // Routes that don't require any connection/auth.
  const PUBLIC_ROUTES = ["/connect", "/connect/disclaimer", "/init"];
  // Routes that require WebSocket connection but not login.
  const CONNECTION_ROUTES = ["/login"];
  // Lockdown override route.
  const LOCKDOWN_ROUTE = "/lockdown";
  // Auth-protected route prefix.
  const HOME_PREFIX = "/home";

  // ---------------------------------------------------------------------------
  // Auth guard — runs reactively whenever the URL or auth state changes.
  // ---------------------------------------------------------------------------
  $effect(() => {
    const path = $page.url.pathname;

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

    // 2. If lockdown is cleared and we're on the lockdown page, go back
    //    to connect (the user may need to re-authenticate).
    if (!serverStateStore.lockdown && path === LOCKDOWN_ROUTE) {
      goto("/connect", { replaceState: true });
      return;
    }

    // 3. If not connected and trying to access protected/connection routes,
    //    redirect to connect.
    if (!serverStateStore.connected) {
      if (
        !PUBLIC_ROUTES.includes(path) &&
        path !== LOCKDOWN_ROUTE
      ) {
        goto("/connect", { replaceState: true });
        return;
      }
    }

    // 4. If connected but not logged in, and trying to access home routes,
    //    redirect to login.
    if (serverStateStore.connected && !authStore.isLoggedIn) {
      if (path.startsWith(HOME_PREFIX)) {
        goto("/login", { replaceState: true });
        return;
      }
    }

    // 5. If fully authenticated and on connect or login, go to home.
    if (authStore.isLoggedIn) {
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
    // Initialize disclaimer check.
    disclaimerStore.init();

    // Start listening for backend events.
    await initEventListeners();

    // Fetch initial service status.
    try {
      const status = await getServiceStatus();
      serviceStatusStore.setAll(status);
    } catch {
      setTimeout(async () => {
        try {
          const status = await getServiceStatus();
          serviceStatusStore.setAll(status);
        } catch { /* ignore */ }
      }, 2000);
    }
  });

  // Periodic auth status polling (every 30s).
  $effect(() => {
    const interval = setInterval(async () => {
      try {
        authStore.apply(await getAuthStatus());
        serverStateStore.apply(await getServerState());
      } catch { /* ignore */ }
    }, 30_000);
    return () => clearInterval(interval);
  });
</script>

<!--
  Root layout wrapper — the gradient background is set on <body> via app.css.
  The LockdownBanner is rendered here (not just in /home) so it is visible
  on the connect and login pages as well, matching the Python reference
  which places it in page.overlay.

  Each route area provides its own chrome (tab bar, AppBar, etc.).
-->
<div class="h-full flex flex-col">
  <LockdownBanner active={serverStateStore.lockdown} />
  <div class="flex-1">
    {@render children()}
  </div>
</div>
