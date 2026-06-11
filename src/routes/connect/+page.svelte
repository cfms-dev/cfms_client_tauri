<script lang="ts">
  // Connect to Server page
  //
  // First screen the user sees after startup.  Enter a WSS server address
  // and establish a WebSocket connection before proceeding to login.
  //
  // After connecting, a `server_info` handshake validates protocol
  // compatibility and surfaces the server's display name and lockdown status.
  //
  // Reference: ConnectToServerModel in reference/src/include/ui/models/connect.py
  //            ConnectFormController in reference/src/include/controllers/connect.py

  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { _ as t } from 'svelte-i18n';
  import { connect, disconnect, getAuthStatus, getServerState } from "$lib/api";
  import {
    authStore,
    notificationStore,
    serverStateStore,
  } from "$lib/stores.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import MdSwitch from "$lib/components/MdSwitch.svelte";
  import ProgressRing from "$lib/components/ProgressRing.svelte";

  let hostPort = $state("localhost:5104");
  let disableSsl = $state(false);
  let busy = $state(false);
  let serverAddressError = $state<string | null>(null);
  let protocolError = $state<{
    serverVersion: number;
    clientVersion: number;
    needsUpdate: boolean;
  } | null>(null);

  // On mount: close any stale connection.
  onMount(async () => {
    // Close any previous connection to start fresh.
    try {
      await disconnect();
    } catch {
      /* ignore */
    }
    authStore.clear();
    serverStateStore.clear();
  });

  function validateUrl(): boolean {
    serverAddressError = null;
    if (!hostPort.trim()) {
      serverAddressError = $t('connect.serverAddressRequired');
      return false;
    }
    if (!hostPort.includes(":") && !hostPort.includes(".")) {
      serverAddressError = $t('connect.serverAddressInvalid');
      return false;
    }
    return true;
  }

  /** Parse a protocol-mismatch error string of the form
   *  `"<kind>:<server_ver>:<client_ver>"`. */
  function parseProtocolError(
    e: string,
  ): { serverVersion: number; clientVersion: number; needsUpdate: boolean } | null {
    if (e.startsWith("server_update_required:")) {
      const parts = e.split(":");
      return {
        serverVersion: Number(parts[1]),
        clientVersion: Number(parts[2]),
        needsUpdate: true,
      };
    }
    if (e.startsWith("server_too_old:")) {
      const parts = e.split(":");
      return {
        serverVersion: Number(parts[1]),
        clientVersion: Number(parts[2]),
        needsUpdate: false,
      };
    }
    return null;
  }

  async function handleConnect() {
    if (!validateUrl()) return;
    busy = true;
    serverAddressError = null;
    protocolError = null;
    try {
      const serverUrl = `wss://${hostPort}`;
      const serverInfo = await connect(serverUrl, disableSsl);

      // Store server metadata from the post-connect handshake.
      serverStateStore.applyServerInfo(serverInfo);
      serverStateStore.remoteAddress = serverUrl;

      // Refresh full auth/server state (handles any race conditions).
      authStore.apply(await getAuthStatus());
      serverStateStore.apply(await getServerState());

      goto("/login");
    } catch (e) {
      const msg = String(e);
      const parsed = parseProtocolError(msg);
      if (parsed) {
        protocolError = parsed;
      } else {
        notificationStore.error(msg);
      }
    } finally {
      busy = false;
    }
  }

  /** Navigate to the about/update page when the server is newer. */
  async function goToAbout() {
    await goto("/home/about");
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
      {$t('connect.tagline')}
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
          {$t('connect.serverAddress')}
        </label>
        <div
          class="flex items-center rounded-xl border {serverAddressError ? 'border-md3-error' : 'border-md3-outline'}
                    bg-md3-field focus-within:ring-2 focus-within:ring-md3-primary
                    focus-within:border-transparent transition-colors overflow-hidden"
        >
          <span
            class="pl-3.5 py-2.5 text-sm text-md3-on-surface-variant
                       select-none font-mono shrink-0"
            style="font-family: var(--font-md3-sans);"
          >
            wss://
          </span>
          <input
            id="serverUrl"
            type="text"
            class="flex-1 pl-1 pr-3.5 py-2.5 bg-transparent
                   text-md3-on-surface text-sm
                   placeholder:text-md3-on-surface-variant
                   focus:outline-none transition-colors"
            placeholder="localhost:5104"
            bind:value={hostPort}
            disabled={busy}
          />
        </div>
        {#if serverAddressError}
          <p class="mt-1 ml-1 text-xs text-md3-error">{serverAddressError}</p>
        {/if}
      </div>

      <!-- TLS toggle -->
      <div class="flex items-center gap-2.5 text-sm">
        <MdSwitch
          bind:checked={disableSsl}
          disabled={busy}
          ariaLabel={$t('connect.disableSsl')}
        />
        <span class="text-md3-on-surface-variant"
          >{$t('connect.disableSsl')}</span
        >
      </div>

      <!-- Protocol version mismatch -->
      {#if protocolError}
        <div
          class="bg-md3-tertiary-container/60 border border-md3-tertiary/30
                    text-md3-on-tertiary-container text-sm rounded-xl p-4 space-y-3"
        >
          <div class="flex items-start gap-2">
            <span class="shrink-0 mt-0.5"
              ><Icon name="warning" size="16px" /></span
            >
            <div>
              <p class="font-medium">
                {protocolError.needsUpdate
                  ? $t('connect.clientUpdateRequired')
                  : $t('connect.serverVersionUnsupported')}
              </p>
              <p class="mt-1 text-md3-on-surface-variant">
                {protocolError.needsUpdate
                  ? $t('connect.clientUpdateMessage', { values: { serverVersion: protocolError.serverVersion, clientVersion: protocolError.clientVersion } })
                  : $t('connect.serverUnsupportedMessage', { values: { serverVersion: protocolError.serverVersion, clientVersion: protocolError.clientVersion } })}
              </p>
            </div>
          </div>
          {#if protocolError.needsUpdate}
            <button
              type="button"
              class="w-full py-2 rounded-full font-medium
                     bg-md3-tertiary text-md3-on-tertiary
                     hover:brightness-110 transition-all text-sm"
              style="font-family: var(--font-md3-sans);"
              onclick={goToAbout}
            >
              {$t('connect.checkUpdates')}
            </button>
          {/if}
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
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.connecting')} />
          {$t('common.connecting')}
        {:else}
          <Icon name="connect" size="20px" />
          {$t('connect.connect')}
        {/if}
      </button>
    </form>
  </div>
</div>
