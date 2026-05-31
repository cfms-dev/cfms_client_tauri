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
  import { authStore, serviceStatusStore, disclaimerStore } from "$lib/stores.svelte";
  import { getServiceStatus, getAuthStatus } from "$lib/api";

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

    // 1. Lockdown always takes priority — force to lockdown page.
    if (authStore.lockdown && path !== LOCKDOWN_ROUTE) {
      goto(LOCKDOWN_ROUTE, { replaceState: true });
      return;
    }

    // 2. If lockdown is cleared and we're on the lockdown page, go to connect.
    if (!authStore.lockdown && path === LOCKDOWN_ROUTE) {
      goto("/connect", { replaceState: true });
      return;
    }

    // 3. If not connected and trying to access protected/connection routes,
    //    redirect to connect.
    if (!authStore.connected) {
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
    if (authStore.connected && !authStore.isLoggedIn) {
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
        const s = await getAuthStatus();
        authStore.apply(s);
      } catch { /* ignore */ }
    }, 30_000);
    return () => clearInterval(interval);
  });
</script>

<!--
  Minimal root wrapper — the gradient background is set on <body> via app.css.
  Each route area provides its own chrome (tab bar, AppBar, etc.).
  We just render the slot with a full-height container.
-->
<div class="min-h-screen">
  {@render children()}
</div>
