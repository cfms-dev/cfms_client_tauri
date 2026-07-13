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

  import { onMount, tick } from "svelte";
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
  import { openKeyboardShortcutHelp } from "$lib/keyboard";

  let hostPort = $state("localhost:5104");
  let disableSsl = $state(false);
  let busy = $state(false);
  let serverAddressError = $state<string | null>(null);
  let appVersion = $state('');
  let rememberConnectionAddresses = $state(false);
  let recentAddressActiveIndex = $state(-1);
  let recentConnectionAddresses = $state<string[]>([]);
  let recentAddressesOpen = $state(false);
  let serverAddressField: HTMLDivElement | null = null;
  let serverAddressInput: HTMLInputElement | null = null;
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
    await focusServerAddressInput();
    // Close any previous connection to start fresh.
    try {
      await disconnect();
    } catch {
      /* ignore */
    }
    authStore.clear();
    serverStateStore.clear();
  });

  async function focusServerAddressInput() {
    await tick();
    if (busy) return;
    serverAddressInput?.focus({ preventScroll: true });
    serverAddressInput?.select();
  }

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

  /** Navigate to the about/update page without marking a toolbar-originated visit. */
  async function goToAbout() {
    await goto("/home/about");
  }

  async function openUtilityFromToolbar(path: '/home/about' | '/home/settings') {
    markConnectToUtilityTransition();
    await goto(path);
  }

  function toggleRecentAddresses() {
    if (!canShowRecentAddresses || busy) return;
    recentAddressesOpen = !recentAddressesOpen;
    if (recentAddressesOpen) {
      recentAddressActiveIndex = Math.max(0, recentConnectionAddresses.indexOf(hostPort));
      serverAddressInput?.focus({ preventScroll: true });
    }
  }

  function chooseRecentAddress(address: string) {
    hostPort = address;
    recentAddressesOpen = false;
    recentAddressActiveIndex = recentConnectionAddresses.indexOf(address);
    serverAddressInput?.focus({ preventScroll: true });
  }

  function handleServerAddressKeydown(event: KeyboardEvent) {
    if (!canShowRecentAddresses) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      recentAddressesOpen = true;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const start = recentAddressActiveIndex < 0
        ? Math.max(0, recentConnectionAddresses.indexOf(hostPort))
        : recentAddressActiveIndex;
      recentAddressActiveIndex = (start + delta + recentConnectionAddresses.length) % recentConnectionAddresses.length;
    } else if (event.key === 'Home' && recentAddressesOpen) {
      event.preventDefault();
      recentAddressActiveIndex = 0;
    } else if (event.key === 'End' && recentAddressesOpen) {
      event.preventDefault();
      recentAddressActiveIndex = recentConnectionAddresses.length - 1;
    } else if (event.key === 'Enter' && recentAddressesOpen && recentAddressActiveIndex >= 0) {
      event.preventDefault();
      chooseRecentAddress(recentConnectionAddresses[recentAddressActiveIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      recentAddressesOpen = false;
    }
  }
</script>

<div class="connect-auth-shell workspace-palette" class:connect-auth-shell--login-return={playLoginReturnTransition}>
  <div class="absolute right-4 top-4 z-20 flex items-center gap-2">
    <button
      type="button"
      class="inline-flex h-9 w-9 items-center justify-center rounded-full text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high/70 hover:text-md3-on-surface"
      title={$t('keyboard.openHelp')}
      aria-label={$t('keyboard.openHelp')}
      aria-keyshortcuts="Control+/ Meta+/"
      onclick={openKeyboardShortcutHelp}
    >
      <Icon name="keyboard" size="18px" />
    </button>
    <button
      type="button"
      class="inline-flex h-9 w-9 items-center justify-center rounded-full text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high/70 hover:text-md3-on-surface"
      title={$t('settings.title')}
      aria-label={$t('settings.title')}
      onclick={() => openUtilityFromToolbar('/home/settings')}
    >
      <Icon name="settings" size="18px" />
    </button>
    <button
      type="button"
      class="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high/70 hover:text-md3-on-surface"
      title={$t('more.about')}
      aria-label={$t('more.about')}
      onclick={() => openUtilityFromToolbar('/home/about')}
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
        class="connect-form-card backdrop-blur-sm rounded-xl
             border border-md3-outline p-6 space-y-4"
        onsubmit={(e) => {
          e.preventDefault();
          handleConnect();
        }}
      >
      <!-- Server URL — MD3 outlined text field -->
      <div>
        <div class="relative" bind:this={serverAddressField}>
          <div
            class="server-address-field"
            class:server-address-field--error={Boolean(serverAddressError)}
          >
            <label class="server-address-label" for="serverUrl">
              {$t('connect.serverAddress')}
            </label>
            <div class="server-address-input-row">
              <span
                class="server-address-prefix select-none shrink-0"
              >
                wss://
              </span>
              <input
                id="serverUrl"
                type="text"
                data-focus-ring="delegated"
                class="server-address-input min-w-0 flex-1 bg-transparent
                       text-md3-on-surface text-sm
                       placeholder:text-md3-on-surface-variant
                       focus:outline-none transition-colors"
                class:pr-3.5={!canShowRecentAddresses}
                class:pr-2={canShowRecentAddresses}
                placeholder="localhost:5104"
                bind:value={hostPort}
                bind:this={serverAddressInput}
                disabled={busy}
                onkeydown={handleServerAddressKeydown}
                onfocus={() => {
                  if (canShowRecentAddresses) {
                    recentAddressesOpen = true;
                    recentAddressActiveIndex = Math.max(0, recentConnectionAddresses.indexOf(hostPort));
                  }
                }}
                role="combobox"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={recentAddressesOpen}
                aria-controls="recentServerAddressList"
                aria-activedescendant={recentAddressesOpen && recentAddressActiveIndex >= 0
                  ? `recent-server-address-${recentAddressActiveIndex}`
                  : undefined}
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
                  id={`recent-server-address-${recentConnectionAddresses.indexOf(address)}`}
                  type="button"
                  class="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-md3-on-surface
                         transition-colors hover:bg-md3-primary-container/45 focus:bg-md3-primary-container/45
                         focus:outline-none {recentAddressActiveIndex === recentConnectionAddresses.indexOf(address) ? 'bg-md3-primary-container/45' : ''}"
                  role="option"
                  aria-selected={hostPort === address}
                  tabindex="-1"
                  onmouseenter={() => (recentAddressActiveIndex = recentConnectionAddresses.indexOf(address))}
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

      <!-- Compact primary action, matching the workspace command language. -->
      <div class="connect-submit-row">
        <button
          type="submit"
          class="connect-submit-button"
          disabled={busy}
        >
          {#if busy}
            <ProgressRing size={17} strokeWidth={2.5} label={$t('common.connecting')} />
            {$t('common.connecting')}
          {:else}
            <Icon name="connect" size="18px" />
            {$t('connect.connect')}
          {/if}
        </button>
      </div>
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
    background: var(--explorer-background);
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
      radial-gradient(
        circle at 12% 10%,
        color-mix(in srgb, var(--explorer-accent) 8%, transparent),
        transparent 38%
      ),
      var(--explorer-background);
  }

  .connect-form-stage {
    width: 100%;
    max-width: 420px;
  }

  .connect-form-card {
    background: var(--explorer-surface);
  }

  .connect-submit-row {
    display: flex;
    justify-content: flex-end;
    padding-top: 0.125rem;
  }

  .connect-submit-button {
    display: inline-flex;
    min-height: 40px;
    min-width: 116px;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-medium);
    padding: 0.5rem 1.125rem;
    color: var(--explorer-accent);
    background: transparent;
    font-family: var(--font-md3-sans);
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      box-shadow 120ms ease,
      transform 120ms ease;
  }

  .connect-submit-button:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--explorer-accent) 52%, var(--explorer-border));
    background: color-mix(in srgb, var(--explorer-accent) 18%, var(--explorer-surface-raised));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 8%, transparent),
      0 4px 12px color-mix(in srgb, var(--explorer-accent) 10%, transparent);
    transform: translateY(-1px);
  }

  .connect-submit-button:active:not(:disabled) {
    box-shadow: none;
    transform: scale(0.98);
  }

  .connect-submit-button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  .server-address-field {
    position: relative;
    min-width: 0;
    margin: 0;
    border: 1px solid var(--explorer-border);
    border-radius: 12px;
    padding: 0;
    background: var(--explorer-surface-raised);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .server-address-field:focus-within {
    border-color: var(--explorer-accent);
    box-shadow: inset 0 0 0 1px var(--explorer-accent);
  }

  .server-address-field--error {
    border-color: var(--explorer-danger);
  }

  .server-address-field--error:focus-within {
    border-color: var(--explorer-danger);
    box-shadow: inset 0 0 0 1px var(--explorer-danger);
  }

  .server-address-label {
    position: absolute;
    top: 0;
    left: 0.75rem;
    z-index: 1;
    transform: translateY(-50%);
    padding: 0 0.35rem;
    color: var(--explorer-text-muted);
    background: var(--explorer-surface);
    font-family: var(--font-md3-sans);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.25;
    transition: color 120ms ease;
  }

  .server-address-field:focus-within .server-address-label {
    color: var(--explorer-accent);
  }

  .server-address-field--error .server-address-label,
  .server-address-field--error:focus-within .server-address-label {
    color: var(--explorer-danger);
  }

  .server-address-input-row {
    display: flex;
    min-height: 42px;
    align-items: center;
    overflow: hidden;
    border-radius: inherit;
  }

  .server-address-prefix {
    padding-left: 0.875rem;
    color: var(--explorer-text-muted);
    font-family: var(--font-md3-sans);
    font-size: 0.875rem;
  }

  .server-address-input {
    height: 42px;
    padding-left: 0.25rem;
    font-family: var(--font-md3-sans);
  }

  .connect-auth-visual {
    display: none;
    min-height: 100%;
    min-width: 0;
    flex: 0 0 0;
    overflow: hidden;
    background: var(--explorer-background);
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
