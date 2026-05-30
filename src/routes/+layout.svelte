<script lang="ts">
  // CFMS Client — App shell layout
  //
  // Provides the sidebar navigation, top bar with connection status,
  // lockdown banner, and content slot for child routes.

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

<div class="flex h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
  <!-- Sidebar -->
  <aside
    class="flex flex-col w-56 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800
           shrink-0 transition-transform duration-200"
    class:max-sm:hidden={!sidebarOpen}
  >
    <!-- App title -->
    <div class="flex items-center gap-2 px-4 py-4 border-b border-gray-200 dark:border-gray-800">
      <span class="text-lg font-bold text-blue-600 dark:text-blue-400">CFMS</span>
      <span class="text-xs text-gray-500 dark:text-gray-400">Client</span>
    </div>

    <!-- Nav items -->
    <nav class="flex-1 py-2 space-y-0.5">
      {#each navItems as item}
        <a
          href={item.href}
          class="flex items-center gap-3 px-4 py-2 text-sm rounded-lg mx-1
                 hover:bg-gray-100 dark:hover:bg-gray-800
                 transition-colors no-select"
          class:bg-blue-50={currentPath === item.href}
          class:dark:bg-blue-950={currentPath === item.href}
          class:text-blue-700={currentPath === item.href}
          class:dark:text-blue-300={currentPath === item.href}
          onclick={() => (currentPath = item.href)}
        >
          <span class="text-base">{item.icon}</span>
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>

    <!-- Connection status footer -->
    <div class="px-3 py-3 border-t border-gray-200 dark:border-gray-800 space-y-1.5">
      {#each serviceStatusStore.services as svc}
        <ServiceStatus name={svc.name} running={svc.running} />
      {/each}

      <div class="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
        {#if authStore.connected}
          <p class="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
            <span class="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
            Connected
            {#if authStore.serverAddress}
              <span class="text-gray-400 truncate block">{authStore.serverAddress}</span>
            {/if}
          </p>
        {:else}
          <p class="text-xs text-gray-400 flex items-center gap-1">
            <span class="w-1.5 h-1.5 bg-gray-400 rounded-full"></span>
            Offline
          </p>
        {/if}
      </div>
    </div>
  </aside>

  <!-- Main content area -->
  <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
    <!-- Lockdown banner (site-wide) -->
    <LockdownBanner active={authStore.lockdown} />

    <!-- Top bar -->
    <header class="flex items-center h-12 px-4 bg-white dark:bg-gray-900
                    border-b border-gray-200 dark:border-gray-800 shrink-0">
      <button
        class="mr-3 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
        onclick={() => (sidebarOpen = !sidebarOpen)}
        aria-label="Toggle sidebar"
      >
        ☰
      </button>

      {#if authStore.isLoggedIn}
        <span class="text-sm text-gray-600 dark:text-gray-400">
          {authStore.nickname ?? authStore.username}
        </span>
      {/if}

      <div class="ml-auto flex items-center gap-3">
        {#if authStore.isLoggedIn}
          <span class="text-xs text-gray-400">
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
