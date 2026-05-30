<script lang="ts">
  // CFMS Client — Login / Connect page
  //
  // Handles user authentication (PBKDF2 on the Rust side) and
  // WebSocket connection establishment.  No password material
  // touches the WebView beyond the input field value — it is
  // sent directly to the Rust backend via IPC.

  import { authStore } from "$lib/stores.svelte";
  import { login, connect, disconnect, logout, getAuthStatus } from "$lib/api";
  import { goto } from "$app/navigation";

  // Form fields
  let serverUrl = $state("wss://cfms.example.com/ws");
  let username = $state("");
  let password = $state("");
  let disableSsl = $state(false);

  // UI state
  let busy = $state(false);
  let error = $state<string | null>(null);
  let connected = $state(false);

  // Check initial auth status.
  $effect(() => {
    connected = authStore.connected;
  });

  async function handleConnect() {
    if (!serverUrl || !username || !password) {
      error = "All fields are required.";
      return;
    }

    busy = true;
    error = null;
    try {
      // Step 1: Log in (PBKDF2 key derivation + auth handshake).
      const authStatus = await login(username, password);
      authStore.apply(authStatus);

      // Step 2: Establish WSS connection.
      await connect(serverUrl, disableSsl);

      // Refresh auth status to reflect connection.
      const updated = await getAuthStatus();
      authStore.apply(updated);
      connected = true;

      // Clear password from JS memory (best effort).
      password = "";

      goto("/");
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  async function handleDisconnect() {
    busy = true;
    error = null;
    try {
      await disconnect();
      await logout();
      authStore.clear();
      connected = false;
      goto("/login");
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex items-center justify-center min-h-full p-6">
  <div class="w-full max-w-md">
    <h1 class="text-2xl font-bold text-center mb-8">CFMS Client</h1>

    {#if connected && authStore.isLoggedIn}
      <!-- Connected state -->
      <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <div class="flex items-center gap-2 text-green-600 dark:text-green-400">
          <span class="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
          <span class="font-medium">Connected</span>
        </div>

        <div class="text-sm space-y-1">
          <p><span class="text-gray-500">Server:</span> {authStore.serverAddress ?? "—"}</p>
          <p><span class="text-gray-500">User:</span> {authStore.nickname ?? authStore.username}</p>
          <p><span class="text-gray-500">Groups:</span> {authStore.groups.join(", ") || "none"}</p>
          <p><span class="text-gray-500">Permissions:</span> {authStore.permissions.length} granted</p>
        </div>

        <button
          class="w-full py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg
                 font-medium transition-colors disabled:opacity-50"
          onclick={handleDisconnect}
          disabled={busy}
        >
          {busy ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    {:else}
      <!-- Login form -->
      <form
        class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 space-y-4"
        onsubmit={(e) => {
          e.preventDefault();
          handleConnect();
        }}
      >
        <!-- Server URL -->
        <div>
          <label for="serverUrl" class="block text-sm font-medium mb-1">
            Server URL
          </label>
          <input
            id="serverUrl"
            type="text"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600
                   bg-gray-50 dark:bg-gray-900 text-sm
                   focus:ring-2 focus:ring-blue-500 focus:border-transparent
                   placeholder-gray-400"
            placeholder="wss://cfms.example.com/ws"
            bind:value={serverUrl}
            disabled={busy}
          />
        </div>

        <!-- Username -->
        <div>
          <label for="username" class="block text-sm font-medium mb-1">
            Username
          </label>
          <input
            id="username"
            type="text"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600
                   bg-gray-50 dark:bg-gray-900 text-sm
                   focus:ring-2 focus:ring-blue-500 focus:border-transparent
                   placeholder-gray-400"
            placeholder="Enter your username"
            bind:value={username}
            disabled={busy}
            autocomplete="username"
          />
        </div>

        <!-- Password -->
        <div>
          <label for="password" class="block text-sm font-medium mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600
                   bg-gray-50 dark:bg-gray-900 text-sm
                   focus:ring-2 focus:ring-blue-500 focus:border-transparent
                   placeholder-gray-400"
            placeholder="Enter your password"
            bind:value={password}
            disabled={busy}
            autocomplete="current-password"
          />
        </div>

        <!-- TLS toggle -->
        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            class="rounded border-gray-300 dark:border-gray-600
                   text-blue-600 focus:ring-blue-500"
            bind:checked={disableSsl}
            disabled={busy}
          />
          <span class="text-gray-600 dark:text-gray-400">Skip TLS verification (insecure)</span>
        </label>

        <!-- Error -->
        {#if error}
          <div class="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800
                      text-red-700 dark:text-red-300 text-sm rounded-lg p-3">
            {error}
          </div>
        {/if}

        <!-- Submit -->
        <button
          type="submit"
          class="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg
                 font-medium transition-colors disabled:opacity-50"
          disabled={busy}
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </form>
    {/if}
  </div>
</div>
