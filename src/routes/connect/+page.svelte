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
  const initialLoginReturnTransition = browser ? consumeLoginToConnectTransition() : false;
  let playLoginReturnTransition = $state(initialLoginReturnTransition);
  let playDesktopLoginReturnTransition = $state(
    browser && initialLoginReturnTransition
      ? window.matchMedia('(min-width: 1024px)').matches
      : false,
  );
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

  // Keep the navigation transition one-shot. Without clearing this flag,
  // crossing the desktop breakpoint later would activate its media rule again.
  onMount(() => {
    if (!playLoginReturnTransition) return;
    const transitionTimer = window.setTimeout(() => {
      playLoginReturnTransition = false;
      playDesktopLoginReturnTransition = false;
    }, 700);
    return () => window.clearTimeout(transitionTimer);
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

<div class="connect-auth-shell" class:connect-auth-shell--login-return={playDesktopLoginReturnTransition}>
  <section class="connect-auth-panel">
    <div class="connect-actions">
    <button
      type="button"
      class="connect-icon-button"
      title={$t('settings.title')}
      aria-label={$t('settings.title')}
      onclick={goToSettings}
    >
      <Icon name="settings" size="22px" />
    </button>
    <button
      type="button"
      class="connect-icon-button connect-icon-button--status"
      title={$t('more.about')}
      aria-label={$t('more.about')}
      onclick={goToAbout}
    >
      <Icon name="info" size="22px" />
      {#if appUpdateState.update}
        <span
          class="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-md3-error shadow-[0_0_0_3px_rgba(248,113,113,0.18)]"
          aria-label={$t('settings.updates.available')}
          title={$t('settings.updates.available')}
        ></span>
      {/if}
    </button>
    </div>

    <h1 class="connect-page-title">{$t('connect.title')}</h1>

    <div
      class="connect-form-stage"
      class:animate-fade-scale-in={!playLoginReturnTransition}
      class:connect-form-stage--login-return={playLoginReturnTransition}
    >
      <!-- Connect form — MD3 card -->
      <form
        class="connect-card"
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
        class="connect-submit"
        disabled={busy}
      >
        {#if busy}
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.connecting')} />
          {$t('common.connecting')}
        {:else}
          <Icon name="connect" size="19px" />
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
    <img src="/astronomy.jpg" alt="" class="connect-auth-visual-image" />
  </section>
</div>

<style>
  .connect-form-stage--login-return {
    animation: connect-form-crossfade var(--motion-duration-long4)
      var(--motion-easing-emphasized) both;
    will-change: opacity, transform, filter;
  }

  @media (min-width: 1024px) {
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

  /* Connect workspace layout: header and content are positioned by grid flow,
     so the composition scales without relying on viewport-specific offsets. */
  .connect-auth-shell {
    display: flex;
    height: 100%;
    min-height: 100%;
    overflow: hidden;
  }

  .connect-page-title {
    z-index: 1;
    grid-row: 1;
    grid-column: 2;
    align-self: start;
    justify-self: center;
    margin: 0;
    padding-top: clamp(1.25rem, 3vh, 1.75rem);
    color: var(--color-md3-on-surface);
    font-family: var(--font-md3-serif);
    font-size: clamp(1.25rem, calc(0.75rem + 2.5vw), 1.75rem);
    font-weight: 500;
    line-height: 1.25;
    text-align: center;
    white-space: nowrap;
  }

  .connect-actions {
    z-index: 2;
    display: flex;
    grid-row: 1;
    grid-column: 3;
    align-self: start;
    justify-self: end;
    gap: 0.25rem;
    padding-top: clamp(0.75rem, 2vh, 1.25rem);
  }

  .connect-icon-button {
    position: relative;
    display: inline-flex;
    width: 2.75rem;
    height: 2.75rem;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--color-md3-on-surface-variant);
    cursor: pointer;
    transition:
      color var(--motion-duration-short4) var(--motion-easing-standard),
      background var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .connect-icon-button:hover {
    background: color-mix(in srgb, var(--color-md3-surface-container-high) 70%, transparent);
    color: var(--color-md3-on-surface);
  }

  .connect-icon-button:active {
    transform: scale(0.94);
  }

  .connect-icon-button:focus-visible,
  .connect-submit:focus-visible {
    outline: 2px solid var(--color-md3-primary-emphasis);
    outline-offset: 2px;
  }

  .connect-auth-panel {
    position: relative;
    z-index: 1;
    box-sizing: border-box;
    display: grid;
    grid-template-rows: clamp(4.5rem, 10vh, 6rem) minmax(0, 1fr);
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    min-width: 0;
    min-height: 100%;
    flex: 0 0 100%;
    padding: 0 clamp(0.75rem, 2vw, 1.5rem) clamp(1rem, 3vh, 2rem);
    overflow: auto;
    background: linear-gradient(
      135deg,
      var(--color-md3-bg-gradient-start) 0%,
      var(--color-md3-bg-gradient-mid-1) 28%,
      var(--color-md3-bg-gradient-mid-2) 58%,
      var(--color-md3-bg-gradient-end) 100%
    );
  }

  .connect-form-stage {
    box-sizing: border-box;
    grid-row: 2;
    grid-column: 1 / -1;
    align-self: center;
    justify-self: center;
    width: min(100%, 380px);
    min-width: 0;
    padding: clamp(1rem, 4vh, 2.5rem) 0 clamp(1.5rem, 8vh, 5rem);
  }

  .connect-card {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.95rem;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 1.25rem;
    border: 0;
    border-radius: var(--radius-md3-form);
    background: var(--color-md3-surface-container);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.16),
      0 12px 36px rgb(0 0 0 / 0.1);
  }

  .connect-card > div:first-child {
    position: relative;
    min-width: 0;
  }

  .connect-card > div:first-child > .relative,
  .connect-card > div:first-child > .relative > div:first-child {
    min-width: 0;
    max-width: 100%;
  }

  .connect-card > div:first-child > label {
    position: absolute;
    z-index: 2;
    top: -0.55rem;
    left: 0.75rem;
    margin: 0;
    padding: 0 0.35rem;
    background: var(--color-md3-surface-container);
    color: var(--color-md3-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.15rem;
    transition: color var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .connect-card > div:first-child:focus-within > label {
    color: var(--color-md3-primary-emphasis);
  }

  .connect-card > div:first-child > .relative > div:first-child {
    min-height: 3rem;
    border-radius: 0.5rem;
    background: transparent;
  }

  .connect-card > div:first-child > .relative > div:first-child:focus-within {
    border-color: var(--color-md3-primary);
    box-shadow: 0 0 0 1px var(--color-md3-primary);
  }

  .connect-card input {
    font-family: var(--font-md3-serif);
    font-size: 1rem;
  }

  .connect-card input:disabled {
    cursor: not-allowed;
  }

  .connect-submit {
    display: inline-flex;
    min-width: 6.75rem;
    min-height: 2.5rem;
    align-items: center;
    justify-content: center;
    justify-self: center;
    gap: 0.5rem;
    padding: 0.5rem 1.25rem;
    border: 0;
    border-radius: var(--radius-md3-button);
    background: var(--color-md3-primary);
    color: var(--color-md3-on-primary);
    font-family: var(--font-md3-serif);
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      background var(--motion-duration-short4) var(--motion-easing-standard),
      opacity var(--motion-duration-short4) var(--motion-easing-standard);
  }

  .connect-submit:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-md3-primary) 90%, white);
  }

  .connect-submit:active:not(:disabled) {
    opacity: 0.72;
  }

  .connect-submit:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .connect-auth-visual {
    display: none;
    min-width: 0;
    min-height: 100%;
    flex: 0 0 0;
    overflow: hidden;
    background: #0e1217;
  }

  .connect-auth-visual-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  @media (min-width: 1024px) {
    .connect-auth-visual {
      display: block;
    }
  }

  @media (max-width: 460px) {
    .connect-auth-shell {
      overflow-x: hidden;
    }

    .connect-auth-panel {
      grid-template-rows: 4.25rem minmax(0, 1fr);
      padding-right: 0.75rem;
      padding-left: 0.75rem;
    }

    .connect-page-title {
      padding-top: 1.15rem;
    }

    .connect-actions {
      gap: 0;
      padding-top: 0.7rem;
    }

    .connect-icon-button {
      width: 2.5rem;
      height: 2.5rem;
    }

    .connect-form-stage {
      padding-top: 0.75rem;
      padding-bottom: 1.5rem;
    }

    .connect-card {
      padding: 1rem;
    }
  }

  @media (max-height: 580px) {
    .connect-auth-shell {
      overflow-y: auto;
    }

    .connect-auth-panel {
      grid-template-rows: 4rem auto;
    }

    .connect-page-title {
      padding-top: 1rem;
    }

    .connect-actions {
      padding-top: 0.6rem;
    }

    .connect-form-stage {
      align-self: start;
      padding-top: 1rem;
      padding-bottom: 1rem;
    }
  }
</style>
