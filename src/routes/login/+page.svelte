<script lang="ts">
  // CFMS Client — Login / Connect page
  //
  // Handles user authentication (PBKDF2 on the Rust side) and
  // WebSocket connection establishment.  No password material
  // touches the WebView beyond the input field value — it is
  // sent directly to the Rust backend via IPC.
  //
  // MD3: centred card layout with outlined text fields (12px radius)
  // and filled primary button (20px radius).

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
  <div class="w-full" style="max-width: 380px;">
    <!-- MD3 headline -->
    <h1
      class="text-2xl font-bold text-center mb-8 text-md3-on-surface"
      style="font-family: var(--font-md3-sans);"
    >
      CFMS Client
    </h1>

    {#if connected && authStore.isLoggedIn}
      <!-- Connected state — MD3 card -->
      <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                  border border-md3-outline p-6 space-y-4">
        <div class="flex items-center gap-2 text-md3-success">
          <span class="w-3 h-3 bg-md3-success rounded-full animate-pulse"></span>
          <span class="font-medium" style="font-family: var(--font-md3-sans);">Connected</span>
        </div>

        <div class="text-sm space-y-1.5">
          <p>
            <span class="text-md3-on-surface-variant">Server:</span>
            <span class="text-md3-on-surface ml-1">{authStore.serverAddress ?? "—"}</span>
          </p>
          <p>
            <span class="text-md3-on-surface-variant">User:</span>
            <span class="text-md3-on-surface ml-1">{authStore.nickname ?? authStore.username}</span>
          </p>
          <p>
            <span class="text-md3-on-surface-variant">Groups:</span>
            <span class="text-md3-on-surface ml-1">{authStore.groups.join(", ") || "none"}</span>
          </p>
          <p>
            <span class="text-md3-on-surface-variant">Permissions:</span>
            <span class="text-md3-on-surface ml-1">{authStore.permissions.length} granted</span>
          </p>
        </div>

        <!-- MD3 outlined danger button -->
        <button
          class="w-full py-2.5 px-4 rounded-full font-medium
                 border border-md3-error text-md3-error
                 hover:bg-md3-error-container transition-colors
                 disabled:opacity-50"
          style="font-family: var(--font-md3-sans);"
          onclick={handleDisconnect}
          disabled={busy}
        >
          {busy ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    {:else}
      <!-- Login form — MD3 card -->
      <form
        class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
               border border-md3-outline p-6 space-y-4"
        onsubmit={(e) => {
          e.preventDefault();
          handleConnect();
        }}
      >
        <!-- Server URL — MD3 outlined text field -->
        <div>
          <label
            for="serverUrl"
            class="block text-sm font-medium mb-1.5 text-md3-on-surface"
            style="font-family: var(--font-md3-sans);"
          >
            Server URL
          </label>
          <input
            id="serverUrl"
            type="text"
            class="w-full px-3.5 py-2.5 rounded-xl border border-md3-outline
                   bg-md3-field text-md3-on-surface text-sm
                   placeholder:text-md3-on-surface-variant
                   focus:ring-2 focus:ring-md3-primary focus:border-transparent
                   transition-colors"
            placeholder="wss://cfms.example.com/ws"
            bind:value={serverUrl}
            disabled={busy}
          />
        </div>

        <!-- Username -->
        <div>
          <label
            for="username"
            class="block text-sm font-medium mb-1.5 text-md3-on-surface"
            style="font-family: var(--font-md3-sans);"
          >
            Username
          </label>
          <input
            id="username"
            type="text"
            class="w-full px-3.5 py-2.5 rounded-xl border border-md3-outline
                   bg-md3-field text-md3-on-surface text-sm
                   placeholder:text-md3-on-surface-variant
                   focus:ring-2 focus:ring-md3-primary focus:border-transparent
                   transition-colors"
            placeholder="Enter your username"
            bind:value={username}
            disabled={busy}
            autocomplete="username"
          />
        </div>

        <!-- Password -->
        <div>
          <label
            for="password"
            class="block text-sm font-medium mb-1.5 text-md3-on-surface"
            style="font-family: var(--font-md3-sans);"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            class="w-full px-3.5 py-2.5 rounded-xl border border-md3-outline
                   bg-md3-field text-md3-on-surface text-sm
                   placeholder:text-md3-on-surface-variant
                   focus:ring-2 focus:ring-md3-primary focus:border-transparent
                   transition-colors"
            placeholder="Enter your password"
            bind:value={password}
            disabled={busy}
            autocomplete="current-password"
          />
        </div>

        <!-- TLS toggle -->
        <label class="flex items-center gap-2.5 text-sm cursor-pointer">
          <input
            type="checkbox"
            class="rounded border-md3-outline bg-md3-field
                   text-md3-primary focus:ring-md3-primary"
            bind:checked={disableSsl}
            disabled={busy}
          />
          <span class="text-md3-on-surface-variant">Skip TLS verification (insecure)</span>
        </label>

        <!-- Error — MD3 error container -->
        {#if error}
          <div class="bg-md3-error-container/60 border border-md3-error/30
                      text-md3-on-error-container text-sm rounded-xl p-3">
            {error}
          </div>
        {/if}

        <!-- Submit — MD3 filled primary button (20px radius) -->
        <button
          type="submit"
          class="w-full py-2.5 px-4 rounded-full font-medium
                 bg-md3-primary text-md3-on-primary
                 hover:brightness-110
                 disabled:opacity-50 transition-all"
          style="font-family: var(--font-md3-sans);"
          disabled={busy}
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </form>
    {/if}
  </div>
</div>
