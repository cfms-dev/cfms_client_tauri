<script lang="ts">
  // Connect to Server page
  //
  // First screen the user sees after startup.  Enter a WSS server address
  // and establish a WebSocket connection before proceeding to login.
  //
  // Reference: ConnectToServerModel in reference/src/include/ui/models/connect.py

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { connect, disconnect, getAuthStatus } from '$lib/api';
  import { authStore, disclaimerStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let serverUrl = $state('wss://localhost:5104');
  let disableSsl = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  // On mount: close any stale connection, check disclaimer.
  onMount(async () => {
    // Close any previous connection to start fresh.
    try { await disconnect(); } catch { /* ignore */ }
    authStore.clear();

    // Check disclaimer acceptance.
    await disclaimerStore.init();
    if (disclaimerStore.checked && !disclaimerStore.accepted) {
      goto('/connect/disclaimer');
    }
  });

  function validateUrl(): boolean {
    if (!serverUrl.trim()) {
      error = 'Server address is required.';
      return false;
    }
    if (!serverUrl.startsWith('wss://') && !serverUrl.startsWith('ws://')) {
      error = 'Server address must start with wss:// or ws://';
      return false;
    }
    const hostPart = serverUrl.replace(/^wss?:\/\//, '');
    if (!hostPart.includes(':') && !hostPart.includes('.')) {
      error = 'Server address must include a host and port (e.g. wss://example.com:5104)';
      return false;
    }
    return true;
  }

  async function handleConnect() {
    if (!validateUrl()) return;
    busy = true;
    error = null;
    try {
      await connect(serverUrl, disableSsl);
      // Refresh auth to pick up server_info / connected state.
      const status = await getAuthStatus();
      authStore.apply(status);
      goto('/login');
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex items-center justify-center min-h-full p-6">
  <div class="w-full" style="max-width: 420px;">
    <!-- App title -->
    <h1
      class="text-2xl font-bold text-center mb-2 text-md3-on-surface"
      style="font-family: var(--font-md3-sans);"
    >
      CFMS Client
    </h1>
    <p class="text-xs text-center text-md3-on-surface-variant mb-8">
      Connect to a CFMS server to get started
    </p>

    <!-- Connect form — MD3 card -->
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
          Server Address
        </label>
        <input
          id="serverUrl"
          type="text"
          class="w-full px-3.5 py-2.5 rounded-xl border border-md3-outline
                 bg-md3-field text-md3-on-surface text-sm
                 placeholder:text-md3-on-surface-variant
                 focus:ring-2 focus:ring-md3-primary focus:border-transparent
                 transition-colors"
          placeholder="wss://localhost:5104"
          bind:value={serverUrl}
          disabled={busy}
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
        <span class="text-md3-on-surface-variant">Disable SSL verification (Insecure)</span>
      </label>

      <!-- Error — MD3 error container -->
      {#if error}
        <div class="bg-md3-error-container/60 border border-md3-error/30
                    text-md3-on-error-container text-sm rounded-xl p-3">
          {error}
        </div>
      {/if}

      <!-- Connect button — MD3 filled primary -->
      <button
        type="submit"
        class="w-full py-2.5 px-4 rounded-full font-medium
               bg-md3-primary text-md3-on-primary
               hover:brightness-110
               disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        style="font-family: var(--font-md3-sans);"
        disabled={busy}
      >
        {#if busy}
          <span class="animate-spin"><Icon name="refresh" size="18px" /></span>
          Connecting…
        {:else}
          <Icon name="connect" size="20px" />
          Connect
        {/if}
      </button>
    </form>
  </div>
</div>
