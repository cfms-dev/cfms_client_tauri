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
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { _ as t } from 'svelte-i18n';
  import {
    connect,
    disconnect,
    getAuthStatus,
    getConnectionSettings,
    getServerState,
  } from "$lib/api";
  import { loadAppVersion } from "$lib/app-info";
  import { appUpdateState } from "$lib/app-update-state.svelte";
  import {
    consumeLoginToConnectTransition,
    markConnectToLoginTransition,
    markConnectToUtilityTransition,
  } from "$lib/auth-transition";
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
  let appVersion = $state('');
  let rememberConnectionAddresses = $state(false);
  let recentConnectionAddresses = $state<string[]>([]);
  let recentAddressesOpen = $state(false);
  let serverAddressField: HTMLDivElement | null = null;
  let playLoginReturnTransition = $state(browser ? consumeLoginToConnectTransition() : false);
  let protocolError = $state<{
    serverVersion: number;
    clientVersion: number;
    needsUpdate: boolean;
  } | null>(null);

  const canShowRecentAddresses = $derived(
    rememberConnectionAddresses && recentConnectionAddresses.length > 0,
  );

  // On mount: close any stale connection.
  onMount(async () => {
    appVersion = await loadAppVersion();
    try {
      const settings = await getConnectionSettings();
      rememberConnectionAddresses = settings.remember_connection_addresses;
      recentConnectionAddresses = settings.recent_connection_addresses;
      if (rememberConnectionAddresses && recentConnectionAddresses[0]) {
        hostPort = recentConnectionAddresses[0];
      }
    } catch {
      /* ignore */
    }
    // Close any previous connection to start fresh.
    try {
      await disconnect();
    } catch {
      /* ignore */
    }
    authStore.clear();
    serverStateStore.clear();
  });

  onMount(() => {
    function closeRecentAddresses(event: PointerEvent) {
      if (!serverAddressField?.contains(event.target as Node)) {
        recentAddressesOpen = false;
      }
    }

    document.addEventListener('pointerdown', closeRecentAddresses);
    return () => document.removeEventListener('pointerdown', closeRecentAddresses);
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

      markConnectToLoginTransition();
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
    markConnectToUtilityTransition();
    await goto("/home/about");
  }

  async function goToSettings() {
    markConnectToUtilityTransition();
    await goto("/home/settings");
  }

  function toggleRecentAddresses() {
    if (!canShowRecentAddresses || busy) return;
    recentAddressesOpen = !recentAddressesOpen;
  }

  function chooseRecentAddress(address: string) {
    hostPort = address;
    recentAddressesOpen = false;
  }

  function handleServerAddressKeydown(event: KeyboardEvent) {
    if (!canShowRecentAddresses) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      recentAddressesOpen = true;
    } else if (event.key === 'Escape') {
      recentAddressesOpen = false;
    }
  }
</script>

<div class="connect-auth-shell" class:connect-auth-shell--login-return={playLoginReturnTransition}>
  <div class="absolute right-4 top-4 z-20 flex items-center gap-2">
    <button
      type="button"
      class="inline-flex h-9 w-9 items-center justify-center rounded-full text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high/70 hover:text-md3-on-surface"
      title={$t('settings.title')}
      aria-label={$t('settings.title')}
      onclick={goToSettings}
    >
      <Icon name="settings" size="18px" />
    </button>
    <button
      type="button"
      class="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high/70 hover:text-md3-on-surface"
      title={$t('more.about')}
      aria-label={$t('more.about')}
      onclick={goToAbout}
    >
      <Icon name="info" size="18px" />
      {#if appUpdateState.update}
        <span
          class="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-md3-error shadow-[0_0_0_3px_rgba(248,113,113,0.18)]"
          aria-label={$t('settings.updates.available')}
          title={$t('settings.updates.available')}
        ></span>
      {/if}
    </button>
  </div>

  <section class="connect-auth-panel">
  <div
    class="connect-form-stage"
    class:animate-fade-scale-in={!playLoginReturnTransition}
    class:connect-form-stage--login-return={playLoginReturnTransition}
  >
      <!-- App title -->
      <h1
        class="mb-2 text-center text-2xl font-bold text-md3-on-surface"
        style="font-family: var(--font-md3-serif);"
      >
        CFMS Client
      </h1>
      <p class="mb-8 text-center text-xs text-md3-on-surface-variant">
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
        <div class="relative" bind:this={serverAddressField}>
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
              class="min-w-0 flex-1 pl-1 py-2.5 bg-transparent
                     text-md3-on-surface text-sm
                     placeholder:text-md3-on-surface-variant
                     focus:outline-none transition-colors"
              class:pr-3.5={!canShowRecentAddresses}
              class:pr-2={canShowRecentAddresses}
              placeholder="localhost:5104"
              bind:value={hostPort}
              disabled={busy}
              onkeydown={handleServerAddressKeydown}
              onfocus={() => {
                if (canShowRecentAddresses) recentAddressesOpen = true;
              }}
            />
            {#if canShowRecentAddresses}
              <button
                type="button"
                class="flex h-10 w-10 shrink-0 items-center justify-center text-md3-on-surface-variant
                       transition-colors hover:bg-md3-surface-container-high/70 hover:text-md3-on-surface
                       disabled:opacity-50"
                aria-label={$t('connect.recentAddresses')}
                aria-expanded={recentAddressesOpen}
                aria-controls="recentServerAddressList"
                disabled={busy}
                onclick={toggleRecentAddresses}
              >
                <Icon name={recentAddressesOpen ? 'expandLess' : 'expandMore'} size="20px" />
              </button>
            {/if}
          </div>

          {#if canShowRecentAddresses && recentAddressesOpen}
            <div
              id="recentServerAddressList"
              class="absolute left-0 right-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-md3-outline
                     bg-md3-surface-container-high shadow-xl shadow-black/20 animate-fade-scale-in"
              role="listbox"
            >
              {#each recentConnectionAddresses as address}
                <button
                  type="button"
                  class="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-md3-on-surface
                         transition-colors hover:bg-md3-primary-container/45 focus:bg-md3-primary-container/45
                         focus:outline-none"
                  role="option"
                  aria-selected={hostPort === address}
                  onclick={() => chooseRecentAddress(address)}
                >
                  <Icon name="history" size="16px" />
                  <span class="min-w-0 flex-1 truncate font-mono">{address}</span>
                  {#if hostPort === address}
                    <Icon name="done" size="16px" />
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
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

      <p class="mt-4 text-center text-xs text-md3-on-surface-variant">
        {$t('about.version')} {appVersion || '...'}
      </p>
  </div>
  </section>

  <section class="connect-auth-visual" aria-hidden="true">
    <img
      src="/astronomy.jpg"
      alt=""
      class="connect-auth-visual-image"
    />
  </section>
</div>

<style>
  .connect-auth-shell {
    position: relative;
    display: flex;
    min-height: 100%;
    overflow: hidden;
  }

  .connect-auth-panel {
    position: relative;
    z-index: 1;
    display: flex;
    min-height: 100%;
    flex: 0 0 100%;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background:
      linear-gradient(
        135deg,
        var(--color-md3-bg-gradient-start) 0%,
        var(--color-md3-bg-gradient-mid-1) 28%,
        var(--color-md3-bg-gradient-mid-2) 58%,
        var(--color-md3-bg-gradient-end) 100%
      );
  }

  .connect-form-stage {
    width: 100%;
    max-width: 420px;
  }

  .connect-auth-visual {
    display: none;
    min-height: 100%;
    min-width: 0;
    flex: 0 0 0;
    overflow: hidden;
    background: #0e1217;
  }

  .connect-auth-visual-image {
    height: 100%;
    width: 100%;
    object-fit: cover;
  }

  @media (min-width: 1024px) {
    .connect-auth-visual {
      display: block;
    }

    .connect-auth-shell--login-return .connect-auth-panel {
      animation: connect-panel-expand var(--motion-duration-long4)
        var(--motion-easing-emphasized) both;
      will-change: flex-basis;
    }

    .connect-auth-shell--login-return .connect-auth-visual {
      animation: connect-visual-collapse var(--motion-duration-long4)
        var(--motion-easing-emphasized) both;
      will-change: flex-basis, opacity;
    }

    .connect-auth-shell--login-return .connect-auth-visual-image {
      animation: connect-visual-image-retreat var(--motion-duration-long4)
        var(--motion-easing-emphasized) both;
      will-change: transform;
    }
  }

  .connect-form-stage--login-return {
    animation: connect-form-crossfade var(--motion-duration-long4)
      var(--motion-easing-emphasized) both;
    will-change: opacity, transform, filter;
  }

  @keyframes connect-panel-expand {
    from {
      flex-basis: 520px;
    }
    to {
      flex-basis: 100%;
    }
  }

  @keyframes connect-visual-collapse {
    from {
      flex-basis: calc(100% - 520px);
      opacity: 1;
    }
    to {
      flex-basis: 0;
      opacity: 0.96;
    }
  }

  @keyframes connect-visual-image-retreat {
    from {
      transform: translate3d(0, 0, 0) scale(1);
    }
    to {
      transform: translate3d(18%, 0, 0) scale(1.04);
    }
  }

  @keyframes connect-form-crossfade {
    0% {
      opacity: 0;
      transform: translate3d(0, 4px, 0) scale(0.985);
      filter: blur(5px);
    }
    28% {
      opacity: 0;
      transform: translate3d(0, 4px, 0) scale(0.985);
      filter: blur(5px);
    }
    72% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
      filter: blur(0);
    }
    100% {
      opacity: 1;
      transform: translate3d(0, 0, 0) scale(1);
      filter: blur(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .connect-auth-shell--login-return .connect-auth-panel,
    .connect-auth-shell--login-return .connect-auth-visual,
    .connect-auth-shell--login-return .connect-auth-visual-image,
    .connect-form-stage--login-return {
      animation: none !important;
    }
  }
</style>
