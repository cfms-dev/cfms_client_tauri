<script lang="ts">
  // CFMS Client — App shell layout
  //
  // Provides the sidebar navigation, top bar with connection status,
  // lockdown banner, and content slot for child routes.
  //
  // Material Design 3 styling per reference/src/main.py theme config.

  import "../app.css";
  import type { Snippet } from "svelte";
  import { onMount } from "svelte";

  let { children }: { children: Snippet } = $props();
  import { initEventListeners } from "$lib/events";
  import { authStore, serviceStatusStore } from "$lib/stores.svelte";
  import { getServiceStatus, getAuthStatus } from "$lib/api";
  import LockdownBanner from "$lib/components/LockdownBanner.svelte";
  import ServiceStatus from "$lib/components/ServiceStatus.svelte";

  let sidebarOpen = $state(true);
  let currentPath = $state("/");

  // Navigation items
  const navItems = [
    { href: "/", label: "Dashboard", icon: "◧" },
    { href: "/explorer", label: "Explorer", icon: "◫" },
    { href: "/downloads", label: "Downloads", icon: "⇩" },
    { href: "/admin", label: "Admin", icon: "⚙" },
    { href: "/login", label: "Login", icon: "🔑" },
  ];

  // Initialize event listeners and poll service status on mount.
  onMount(async () => {
    await initEventListeners();
    try {
      const status = await getServiceStatus();
      serviceStatusStore.setAll(status);
    } catch {
      // Backend may not be ready yet — retry shortly.
      setTimeout(async () => {
        try {
          const status = await getServiceStatus();
          serviceStatusStore.setAll(status);
        } catch { /* ignore */ }
      }, 2000);
    }
  });

  // Poll auth status periodically (every 30s).
  $effect(() => {
    const interval = setInterval(async () => {
      try {
        const s = await getAuthStatus();
        authStore.apply(s);
      } catch { /* ignore */ }
    }, 30000);
    return () => clearInterval(interval);
  });
</script>

<!--
  MD3 layout shell.
  The background gradient is set on <body> via app.css — this wrapper
  is transparent so the gradient shows through.  Surface containers
  (sidebar, header, cards) use semi-transparent MD3 surface colours.
-->
<div class="flex h-screen text-md3-on-surface">
  <!-- Sidebar — MD3 surface container -->
  <aside
    class="flex flex-col w-56 bg-md3-surface/90 backdrop-blur-sm
           border-r border-md3-outline
           shrink-0 transition-transform duration-200"
    class:max-sm:hidden={!sidebarOpen}
  >
    <!-- App title — MD3 primary accent -->
    <div class="flex items-center gap-2 px-4 py-4 border-b border-md3-outline">
      <span class="text-lg font-bold text-md3-primary" style="font-family: var(--font-md3-sans);">
        CFMS
      </span>
      <span class="text-xs text-md3-on-surface-variant">Client</span>
    </div>

    <!-- Nav items — MD3 navigation rail style -->
    <nav class="flex-1 py-2 space-y-0.5">
      {#each navItems as item}
        <a
          href={item.href}
          class="flex items-center gap-3 px-4 py-2.5 text-sm rounded-xl mx-1.5
                 text-md3-on-surface-variant
                 hover:bg-md3-surface-container-high/50
                 transition-colors no-select"
          class:bg-md3-primary-container={currentPath === item.href}
          class:text-md3-on-primary-container={currentPath === item.href}
          class:font-medium={currentPath === item.href}
          onclick={() => (currentPath = item.href)}
        >
          <span class="text-base">{item.icon}</span>
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>

    <!-- Connection status footer -->
    <div class="px-3 py-3 border-t border-md3-outline space-y-1.5">
      {#each serviceStatusStore.services as svc}
        <ServiceStatus name={svc.name} running={svc.running} />
      {/each}

      <div class="mt-2 pt-2 border-t border-md3-outline-variant/40">
        {#if authStore.connected}
          <p class="text-xs text-md3-success flex items-center gap-1.5">
            <span class="w-2 h-2 bg-md3-success rounded-full"></span>
            Connected
            {#if authStore.serverAddress}
              <span class="text-md3-on-surface-variant truncate block text-[10px]">
                {authStore.serverAddress}
              </span>
            {/if}
          </p>
        {:else}
          <p class="text-xs text-md3-on-surface-variant flex items-center gap-1.5">
            <span class="w-2 h-2 bg-md3-on-surface-variant rounded-full"></span>
            Offline
          </p>
        {/if}
      </div>
    </div>
  </aside>

  <!-- Main content area — transparent, gradient shows through -->
  <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
    <!-- Lockdown banner (site-wide) -->
    <LockdownBanner active={authStore.lockdown} />

    <!-- Top bar — MD3 surface -->
    <header class="flex items-center h-12 px-4 bg-md3-surface/80 backdrop-blur-sm
                    border-b border-md3-outline shrink-0">
      <button
        class="mr-3 p-1.5 rounded-lg hover:bg-md3-surface-container-high/50
               text-md3-on-surface-variant transition-colors"
        onclick={() => (sidebarOpen = !sidebarOpen)}
        aria-label="Toggle sidebar"
      >
        ☰
      </button>

      {#if authStore.isLoggedIn}
        <span class="text-sm text-md3-on-surface-variant" style="font-family: var(--font-md3-sans);">
          {authStore.nickname ?? authStore.username}
        </span>
      {/if}

      <div class="ml-auto flex items-center gap-3">
        {#if authStore.isLoggedIn}
          <span class="text-xs text-md3-on-surface-variant">
            {authStore.permissions.length} permissions · {authStore.groups.length} groups
          </span>
        {/if}
      </div>
    </header>

    <!-- Page content -->
    <main class="flex-1 overflow-y-auto page-enter">
      {@render children()}
    </main>
  </div>
</div>
