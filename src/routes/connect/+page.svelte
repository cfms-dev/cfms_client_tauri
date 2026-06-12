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
  import { loadAppVersion } from "$lib/app-info";
  import {
    authStore,
    notificationStore,
    serverStateStore,
  } from "$lib/stores.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import IconButton from "$lib/components/IconButton.svelte";
  import MdTextField from "$lib/components/MdTextField.svelte";
  import MdSwitch from "$lib/components/MdSwitch.svelte";
  import ProgressRing from "$lib/components/ProgressRing.svelte";

  let hostPort = $state("localhost:5104");
  let disableSsl = $state(false);
  let busy = $state(false);
  let serverAddressError = $state<string | null>(null);
  let appVersion = $state('');
  let protocolError = $state<{
    serverVersion: number;
    clientVersion: number;
    needsUpdate: boolean;
  } | null>(null);

  // On mount: close any stale connection.
  onMount(async () => {
    appVersion = await loadAppVersion();
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

  async function goToSettings() {
    await goto("/home/settings");
  }
</script>

<div class="relative grid min-h-full grid-rows-[auto_1fr] overflow-hidden">
  <header class="relative z-20 flex min-h-20 items-center justify-center px-4 pt-3">
    <h1
      class="text-center text-2xl font-semibold text-md3-on-surface sm:text-3xl"
      style="font-family: var(--font-md3-serif);"
    >
      {$t('connect.title')}
    </h1>
    <div class="absolute right-4 top-4 flex items-center gap-1">
      <IconButton icon="settings" label={$t('settings.title')} onclick={goToSettings} />
      <IconButton icon="info" label={$t('more.about')} onclick={goToAbout} />
    </div>
  </header>

  <div class="flex min-h-0 items-center justify-center px-6 pb-10 pt-4">
  <div class="w-full animate-fade-scale-in" style="max-width: 570px;">
      <form
        class="connect-card space-y-6"
        onsubmit={(e) => {
          e.preventDefault();
          handleConnect();
        }}
      >
      <MdTextField
        id="serverUrl"
        label={$t('connect.serverAddress')}
        leadingText="wss://"
        placeholder="localhost:5104"
        bind:value={hostPort}
        disabled={busy}
        error={serverAddressError}
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
      />

      <div class="flex items-center gap-3 text-base" style="font-family: var(--font-md3-serif);">
        <MdSwitch
          bind:checked={disableSsl}
          disabled={busy}
          ariaLabel={$t('connect.disableSsl')}
        />
        <span class="text-md3-on-surface"
          >{$t('connect.disableSsl')}</span
        >
      </div>

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

      <button
        type="submit"
        class="mx-auto flex min-w-28 items-center justify-center gap-2 rounded-full
               bg-md3-primary px-8 py-2.5 font-medium text-md3-on-primary
               transition-all hover:brightness-110 active:scale-95
               disabled:opacity-50"
        style="font-family: var(--font-md3-serif);"
        disabled={busy}
      >
        {#if busy}
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.connecting')} />
          {$t('common.connecting')}
        {:else}
          {$t('connect.connect')}
        {/if}
      </button>
      </form>

      <p class="mt-5 text-center text-sm text-md3-on-surface-variant" style="font-family: var(--font-md3-serif);">
        {$t('about.version')} {appVersion || '...'}
      </p>
  </div>
  </div>
</div>

<style>
  .connect-card {
    position: relative;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-md3-outline) 78%, var(--color-md3-primary) 22%);
    border-radius: 8px;
    background:
      linear-gradient(145deg, rgba(31, 41, 55, 0.92), rgba(30, 41, 59, 0.86));
    box-shadow:
      0 24px 70px rgba(0, 0, 0, 0.28),
      0 0 0 1px rgba(255, 255, 255, 0.03) inset;
    padding: 1.85rem;
    backdrop-filter: blur(20px);
  }

  .connect-card::before {
    pointer-events: none;
    position: absolute;
    inset: 0;
    content: '';
    background:
      linear-gradient(115deg, rgba(79, 70, 229, 0.16), transparent 42%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 32%);
    opacity: 0.9;
  }

  .connect-card > :global(*) {
    position: relative;
  }
</style>
