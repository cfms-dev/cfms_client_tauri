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
  import { cubicInOut } from "svelte/easing";
  import { fade } from "svelte/transition";
  import { browser } from "$app/environment";
  import { goto } from "$app/navigation";
  import { _ as t } from 'svelte-i18n';
  import {
    cancelConnect,
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
  import MdOutlinedField from "$lib/components/MdOutlinedField.svelte";
  import MdSwitch from "$lib/components/MdSwitch.svelte";
  import ProgressRing from "$lib/components/ProgressRing.svelte";
  import { openKeyboardShortcutHelp } from "$lib/keyboard";
  import { isServerAddressValid, parseServerAddress } from "$lib/server-address";

  let hostPort = $state("localhost:5104");
  let disableSsl = $state(false);
  let busy = $state(false);
  let cancelRequested = $state(false);
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
  const hasValidServerAddress = $derived(isServerAddressValid(hostPort));

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
    if (!isServerAddressValid(hostPort)) {
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
    if (busy) return;
    if (!validateUrl()) return;
    const parsedAddress = parseServerAddress(hostPort);
    if (!parsedAddress) return;

    busy = true;
    serverAddressError = null;
    protocolError = null;
    try {
      hostPort = parsedAddress.address;
      const serverUrl = `wss://${parsedAddress.address}`;
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
      if (msg === 'connection_cancelled') return;
      const parsed = parseProtocolError(msg);
      if (parsed) {
        protocolError = parsed;
      } else {
        notificationStore.error(msg);
      }
    } finally {
      busy = false;
      cancelRequested = false;
    }
  }

  async function handleCancelConnect() {
    if (!busy || cancelRequested) return;
    cancelRequested = true;
    try {
      const cancelled = await cancelConnect();
      if (!cancelled) cancelRequested = false;
    } catch (e) {
      cancelRequested = false;
      notificationStore.error(String(e));
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
  <header class="connect-route-header">
    <h1 class="auth-route-title">{$t('connect.title')}</h1>

    <div class="auth-route-toolbar">
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
  </header>

  <section class="connect-auth-panel">
  <div
    class="connect-form-stage"
    class:animate-fade-scale-in={!playLoginReturnTransition}
    class:connect-form-stage--login-return={playLoginReturnTransition}
  >
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
          <MdOutlinedField
            inputId="serverUrl"
            label={$t('connect.serverAddress')}
            error={Boolean(serverAddressError)}
          >
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
          </MdOutlinedField>

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

      <!-- Circular primary action inspired by the classic mobile QQ login control. -->
      <div class="connect-submit-row">
        <button
          type={busy ? 'button' : 'submit'}
          class="connect-submit-button"
          class:connect-submit-button--active={hasValidServerAddress}
          class:connect-submit-button--busy={busy}
          class:connect-submit-button--cancelling={cancelRequested}
          disabled={cancelRequested || (!busy && !hasValidServerAddress)}
          aria-label={busy ? $t('common.cancel') : $t('connect.connect')}
          aria-busy={busy}
          title={busy ? $t('common.cancel') : $t('connect.connect')}
          onclick={busy ? handleCancelConnect : undefined}
        >
          <span class="connect-submit-effects" aria-hidden="true"></span>
          {#if busy}
            <span
              class="connect-submit-busy-layer"
              aria-hidden="true"
              out:fade={{ duration: 360, easing: cubicInOut }}
            >
              <span class="connect-submit-busy-fill"></span>
            </span>
          {/if}
          {#if busy}
            <span class="connect-submit-progress">
              <ProgressRing tone="inherit" size={44} strokeWidth={2.5} label={$t('common.connecting')} />
              <span class="connect-submit-cancel-icon" aria-hidden="true">
                <Icon name="close" size="22px" />
              </span>
            </span>
          {:else}
            <span class="connect-submit-content connect-submit-arrow">
              <Icon name="arrowBack" size="24px" />
            </span>
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

  .connect-route-header {
    --connect-route-toolbar-width: 7.75rem;

    position: absolute;
    z-index: 20;
    inset-block-start: 1rem;
    inset-inline: 1rem;
    display: grid;
    grid-template-columns:
      minmax(var(--connect-route-toolbar-width), 1fr)
      minmax(0, auto)
      minmax(var(--connect-route-toolbar-width), 1fr);
    align-items: center;
  }

  .connect-route-header .auth-route-title,
  .connect-route-header .auth-route-toolbar {
    position: static;
    transform: none;
  }

  .connect-route-header .auth-route-title {
    grid-column: 2;
    min-inline-size: 0;
    max-inline-size: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connect-route-header .auth-route-toolbar {
    grid-column: 3;
    justify-self: end;
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
    justify-content: center;
    padding-block: 0.875rem 0.25rem;
  }

  .connect-submit-button {
    --connect-button-blue: #367fdc;
    --connect-button-blue-deep: #286bc9;
    --connect-button-aqua: #38bfc3;
    --connect-button-busy-purple: #7c4dff;
    --connect-button-busy-purple-deep: #5e35b1;
    --connect-button-busy-magenta: #c05cff;

    position: relative;
    isolation: isolate;
    display: inline-flex;
    inline-size: 60px;
    block-size: 60px;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 0;
    border-radius: 50%;
    padding: 0;
    color: var(--explorer-text-muted);
    background: var(--explorer-surface-raised);
    box-shadow: 0 4px 12px rgb(0 0 0 / 12%);
    transition:
      background-color 220ms var(--motion-easing-standard),
      color 180ms var(--motion-easing-standard),
      box-shadow 260ms var(--motion-easing-standard),
      transform 180ms var(--motion-easing-emphasized-decelerate);
  }

  .connect-submit-effects {
    position: absolute;
    z-index: 0;
    inset: 0;
    display: none;
    overflow: hidden;
    border-radius: 50%;
    pointer-events: none;
  }

  .connect-submit-button--active {
    color: white;
    background: var(--connect-button-blue);
    box-shadow: 0 9px 22px rgb(40 107 201 / 22%);
  }

  .connect-submit-content {
    position: relative;
    z-index: 1;
    display: inline-flex;
    color: inherit;
  }

  .connect-submit-arrow {
    transform: rotate(180deg);
    transition: transform 220ms var(--motion-easing-emphasized-decelerate);
  }

  .connect-submit-progress {
    position: absolute;
    z-index: 3;
    inset: 0;
    display: grid;
    place-items: center;
    color: white;
    pointer-events: none;
    animation: connect-button-progress-enter 320ms 100ms
      var(--motion-easing-emphasized-decelerate) both;
  }

  .connect-submit-cancel-icon {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  .connect-submit-progress :global(.md-progress-ring) {
    opacity: 0.78;
    filter: drop-shadow(0 1px 2px rgb(43 20 85 / 16%));
  }

  .connect-submit-progress :global(.md-progress-ring__track) {
    display: none;
  }

  .connect-submit-busy-layer {
    position: absolute;
    z-index: 2;
    inset: 0;
    pointer-events: none;
  }

  .connect-submit-busy-fill {
    position: absolute;
    inset-inline-start: calc(72% - 9px);
    inset-block-start: calc(50% - 9px);
    inline-size: 18px;
    block-size: 18px;
    border-radius: 50%;
    background:
      radial-gradient(
        circle at 32% 28%,
        var(--connect-button-busy-magenta) 0 18%,
        transparent 52%
      ),
      radial-gradient(
        circle at 70% 72%,
        var(--connect-button-busy-purple-deep) 0 24%,
        transparent 62%
      ),
      var(--connect-button-busy-purple);
    pointer-events: none;
    animation: connect-button-busy-spread 560ms
      var(--motion-easing-emphasized-decelerate) both;
    will-change: transform, border-radius;
  }

  .connect-submit-button--active:hover:not(:disabled) {
    box-shadow: 0 12px 26px rgb(40 107 201 / 28%);
    transform: translateY(-1px) scale(1.018);
  }

  .connect-submit-button--active:hover:not(:disabled) .connect-submit-arrow {
    transform: translateX(2px) rotate(180deg);
  }

  .connect-submit-button:active:not(:disabled) {
    transform: scale(0.94);
  }

  .connect-submit-button:disabled {
    cursor: not-allowed;
  }

  .connect-submit-button:disabled:not(.connect-submit-button--active) {
    opacity: 0.68;
  }

  .connect-submit-button.connect-submit-button--busy {
    cursor: pointer;
  }

  .connect-submit-button.connect-submit-button--cancelling {
    cursor: wait;
  }

  .connect-submit-button--active.connect-submit-button--busy {
    box-shadow: 0 9px 22px rgb(94 53 177 / 28%);
  }

  /* Only enable the composited fluid layers when the current WebView can
     parse every rendering primitive they rely on. The nested clipping layer
     avoids old compositor bugs where a filtered pseudo-element escapes a
     rounded overflow clip and paints as a square. */
  @supports (color: color-mix(in srgb, white, black))
    and (background: conic-gradient(from 0deg, red, blue))
    and (filter: blur(1px))
    and (clip-path: circle(50% at 50% 50%))
    and (mix-blend-mode: soft-light) {
    .connect-submit-button {
      --connect-button-blue: color-mix(in srgb, var(--color-md3-primary) 62%, #2f80ed);
      --connect-button-blue-deep: color-mix(in srgb, var(--color-md3-primary) 48%, #2872d8);
      --connect-button-aqua: color-mix(in srgb, var(--color-md3-primary) 52%, #38cfc5);
      --connect-button-busy-purple: color-mix(in srgb, var(--color-md3-primary) 16%, #7c4dff);
      --connect-button-busy-purple-deep: color-mix(in srgb, var(--color-md3-primary) 14%, #5e35b1);
      --connect-button-busy-magenta: color-mix(in srgb, var(--color-md3-primary) 12%, #c05cff);

      color: color-mix(in srgb, var(--explorer-text-muted) 74%, transparent);
      background: color-mix(in srgb, var(--explorer-surface-raised) 90%, white 10%);
      box-shadow: 0 4px 12px color-mix(in srgb, black 12%, transparent);
    }

    .connect-submit-effects {
      clip-path: circle(50% at 50% 50%);
      contain: paint;
    }

    .connect-submit-effects::before {
      position: absolute;
      z-index: 0;
      inset: -32%;
      border-radius: 50%;
      background:
        radial-gradient(
          ellipse at 27% 34%,
          color-mix(in srgb, var(--connect-button-aqua) 76%, var(--connect-button-blue)) 0 14%,
          transparent 42%
        ),
        radial-gradient(
          ellipse at 73% 68%,
          color-mix(in srgb, var(--connect-button-blue-deep) 78%, var(--connect-button-blue)) 0 18%,
          transparent 46%
        ),
        conic-gradient(
          from 24deg at 48% 52%,
          var(--connect-button-blue-deep),
          var(--connect-button-blue) 24%,
          color-mix(in srgb, var(--connect-button-aqua) 68%, var(--connect-button-blue)) 42%,
          var(--connect-button-blue) 61%,
          var(--connect-button-blue-deep) 82%,
          var(--connect-button-blue-deep)
        );
      content: '';
      filter: blur(5px) saturate(1.08);
      opacity: 0;
      transform: translate3d(-2%, 1%, 0) rotate(0deg) scale(1.04, 0.98);
      transition: opacity 320ms var(--motion-easing-standard);
      will-change: transform;
    }

    .connect-submit-effects::after {
      position: absolute;
      z-index: 0;
      inset: -22%;
      border-radius: 43% 57% 61% 39% / 55% 42% 58% 45%;
      background:
        radial-gradient(
          ellipse at 34% 31%,
          color-mix(in srgb, white 18%, var(--connect-button-aqua)) 0 12%,
          transparent 38%
        ),
        radial-gradient(
          ellipse at 68% 72%,
          color-mix(in srgb, var(--connect-button-blue-deep) 62%, transparent) 0 16%,
          transparent 44%
        );
      content: '';
      filter: blur(6px);
      mix-blend-mode: soft-light;
      opacity: 0;
      transform: translate3d(2%, -2%, 0) rotate(0deg) scale(1.02);
      transition: opacity 420ms var(--motion-easing-standard);
      will-change: transform, border-radius;
    }

    .connect-submit-button--active {
      color: white;
      background: var(--connect-button-blue);
      box-shadow: 0 9px 22px color-mix(in srgb, var(--connect-button-blue-deep) 22%, transparent);
    }

    .connect-submit-button--active .connect-submit-effects {
      display: block;
    }

    .connect-submit-button--active .connect-submit-effects::before {
      opacity: 0.94;
      animation: connect-button-fluid-base 8.6s ease-in-out infinite;
    }

    .connect-submit-button--active .connect-submit-effects::after {
      opacity: 0.72;
      animation: connect-button-fluid-highlight 6.3s ease-in-out infinite;
    }

    .connect-submit-button--active:hover:not(:disabled) {
      box-shadow: 0 12px 26px color-mix(in srgb, var(--connect-button-blue-deep) 28%, transparent);
    }
  }

  @keyframes connect-button-busy-spread {
    0% {
      border-radius: 52% 48% 46% 54% / 44% 54% 46% 56%;
      transform: scale(0.08);
    }

    58% {
      border-radius: 47% 53% 55% 45% / 54% 46% 52% 48%;
      transform: scale(6.55, 5.9);
    }

    78% {
      border-radius: 51% 49% 48% 52% / 49% 52% 48% 51%;
      transform: scale(6.15, 6.45);
    }

    100% {
      border-radius: 50%;
      transform: scale(6.35);
    }
  }

  @keyframes connect-button-progress-enter {
    from {
      opacity: 0;
      transform: scale(0.84);
    }

    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes connect-button-fluid-base {
    0% {
      transform: translate3d(-2%, 1%, 0) rotate(0deg) scale(1.04, 0.98);
    }

    23% {
      transform: translate3d(3%, -3%, 0) rotate(78deg) scale(1.12, 1.02);
    }

    49% {
      transform: translate3d(2%, 3%, 0) rotate(176deg) scale(1.01, 1.11);
    }

    74% {
      transform: translate3d(-3%, 2%, 0) rotate(269deg) scale(1.09, 1);
    }

    100% {
      transform: translate3d(-2%, 1%, 0) rotate(360deg) scale(1.04, 0.98);
    }
  }

  @keyframes connect-button-fluid-highlight {
    0% {
      border-radius: 43% 57% 61% 39% / 55% 42% 58% 45%;
      transform: translate3d(2%, -2%, 0) rotate(0deg) scale(1.02);
    }

    31% {
      border-radius: 58% 42% 38% 62% / 44% 61% 39% 56%;
      transform: translate3d(-4%, 2%, 0) rotate(-104deg) scale(1.1, 0.96);
    }

    67% {
      border-radius: 39% 61% 54% 46% / 62% 38% 57% 43%;
      transform: translate3d(3%, 4%, 0) rotate(-238deg) scale(0.97, 1.12);
    }

    100% {
      border-radius: 43% 57% 61% 39% / 55% 42% 58% 45%;
      transform: translate3d(2%, -2%, 0) rotate(-360deg) scale(1.02);
    }
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

  @media (max-width: 599px) {
    .connect-route-header {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0.5rem;
    }

    .connect-route-header .auth-route-title {
      grid-column: 1;
      justify-content: flex-start;
      text-align: start;
    }

    .connect-route-header .auth-route-toolbar {
      grid-column: 2;
    }
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
      flex-basis: var(--auth-panel-basis);
    }
    to {
      flex-basis: 100%;
    }
  }

  @keyframes connect-visual-collapse {
    from {
      flex-basis: calc(100% - var(--auth-panel-basis));
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

</style>
