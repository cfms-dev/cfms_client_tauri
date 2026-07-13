<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    authStore,
    serverStateStore,
    downloadStore,
    uploadStore,
    notificationStore,
  } from '$lib/stores.svelte';
  import { appLockStore } from '$lib/app-lock.svelte';
  import { clearAuthSession, disconnect, getDocument, loadUserPreference, setLockdown } from '$lib/api';
  import { favoriteRecordsFromPreference, type FileRecord } from '$lib/file-preferences';
  import Icon from '$lib/components/Icon.svelte';
  import AvatarPreview from '$lib/components/AvatarPreview.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import UserAvatarPicker from '$lib/components/UserAvatarPicker.svelte';
  import type { WorkspaceNavItem } from '$lib/explorer/types';

  let { children }: { children: Snippet } = $props();

  let drawerOpen = $state(false);
  let accountMenuOpen = $state(false);
  let accountCloseTimer: number | null = null;
  let accountActionBusy = $state(false);
  let lockdownBusy = $state(false);
  let showAvatarPicker = $state(false);
  let favorites = $state<FileRecord[]>([]);
  let favoritesLoading = $state(false);
  let loadedFavoriteScope = '';

  const activeTaskCount = $derived(downloadStore.activeTasks.length + uploadStore.activeTasks.length);
  const accountDisplayName = $derived(
    authStore.displayName ?? authStore.username ?? $t('common.unknown'),
  );
  const isAdmin = $derived(
    authStore.permissions.some((permission) =>
      ['manage_system', 'view_audit_logs', 'list_users', 'list_groups'].includes(permission),
    ),
  );
  const canApplyLockdown = $derived(
    authStore.isLoggedIn
      && serverStateStore.connected
      && authStore.permissions.some((permission) =>
        permission === 'apply_lockdown' || permission === 'manage_system'
      ),
  );

  const primaryNavigation = $derived<WorkspaceNavItem[]>([
    { id: 'home', label: $t('nav.home'), href: '/home/overview', icon: 'home', exact: true },
    { id: 'files', label: $t('workspace.allFiles'), href: '/home/files', icon: 'folder', exact: true },
    { id: 'tasks', label: $t('workspace.transfers'), href: '/home/tasks', icon: 'tasks', badge: activeTaskCount, exact: true },
  ]);

  const bottomNavigation = $derived<WorkspaceNavItem[]>([
    ...(isAdmin
      ? [{ id: 'manage', label: $t('workspace.administration'), href: '/home/manage', icon: 'adminPanelSettings' as const }]
      : []),
    { id: 'settings', label: $t('workspace.settings'), href: '/home/settings', icon: 'settings' },
    { id: 'about', label: $t('workspace.about'), href: '/home/about', icon: 'info' },
  ]);

  const currentTitle = $derived.by(() => {
    const path = $page.url.pathname;
    if (path === '/home/overview') return $t('nav.home');
    if (path === '/home/files') return $t('workspace.allFiles');
    if (path === '/home/tasks') return $t('workspace.transfers');
    if (path === '/home/trash') return $t('workspace.recycleBin');
    if (path === '/home/manage') return $t('workspace.administration');
    if (path === '/home/more') return $t('workspace.account');
    if (path === '/home/about') return $t('workspace.about');
    if (path.startsWith('/home/settings')) return $t('workspace.settings');
    return $t('nav.home');
  });

  const favoriteFolders = $derived(favorites.filter((record) => record.type === 'directory'));

  $effect(() => {
    const scope = `${serverStateStore.remoteAddress ?? ''}:${authStore.username ?? ''}`;
    const path = $page.url.pathname;
    drawerOpen = false;
    accountMenuOpen = false;
    if (!authStore.isLoggedIn || !authStore.username || scope === loadedFavoriteScope) return;
    if (!path.startsWith('/home')) return;
    loadedFavoriteScope = scope;
    void refreshFavorites();
  });

  onMount(() => {
    const refresh = () => void refreshFavorites();
    window.addEventListener('cfms:favorites-changed', refresh);
    return () => window.removeEventListener('cfms:favorites-changed', refresh);
  });

  async function refreshFavorites() {
    if (favoritesLoading || !authStore.isLoggedIn) return;
    favoritesLoading = true;
    try {
      favorites = favoriteRecordsFromPreference(await loadUserPreference());
    } catch {
      favorites = [];
    } finally {
      favoritesLoading = false;
    }
  }

  function isActive(item: WorkspaceNavItem) {
    const path = $page.url.pathname;
    return item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
  }

  async function navigate(href: string) {
    drawerOpen = false;
    await goto(href);
  }

  async function openFavorite(record: FileRecord) {
    drawerOpen = false;
    if (record.type === 'directory') {
      const params = new URLSearchParams({ folder: record.id, name: record.name });
      await goto(`/home/files?${params.toString()}`);
      return;
    }
    try {
      await getDocument(record.id, record.name);
      notificationStore.success($t('home.downloadQueued', { values: { name: record.name } }));
    } catch (error) {
      notificationStore.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function toggleLockdown() {
    if (lockdownBusy) return;
    lockdownBusy = true;
    const nextStatus = !serverStateStore.lockdown;
    try {
      await setLockdown(nextStatus);
      serverStateStore.lockdown = nextStatus;
      notificationStore.success(nextStatus ? $t('lockdown.enabled') : $t('lockdown.disabled'));
    } catch (error) {
      notificationStore.error(error instanceof Error ? error.message : String(error));
    } finally {
      lockdownBusy = false;
    }
  }

  function lockApp() {
    closeAccountMenu();
    if (appLockStore.canLock) appLockStore.lock();
  }

  function openAvatarPicker(event: MouseEvent) {
    event.stopPropagation();
    closeAccountMenu();
    showAvatarPicker = true;
  }

  function openAccountMenu() {
    if (accountCloseTimer !== null) {
      window.clearTimeout(accountCloseTimer);
      accountCloseTimer = null;
    }
    accountMenuOpen = true;
  }

  function closeAccountMenu() {
    if (accountCloseTimer !== null) {
      window.clearTimeout(accountCloseTimer);
      accountCloseTimer = null;
    }
    accountMenuOpen = false;
  }

  function scheduleAccountMenuClose() {
    if (accountCloseTimer !== null) window.clearTimeout(accountCloseTimer);
    accountCloseTimer = window.setTimeout(() => {
      accountMenuOpen = false;
      accountCloseTimer = null;
    }, 180);
  }

  function handleAccountPointerEnter(event: PointerEvent) {
    if (event.pointerType === 'mouse') openAccountMenu();
  }

  function handleAccountPointerLeave(event: PointerEvent) {
    if (event.pointerType === 'mouse') scheduleAccountMenuClose();
  }

  function handleAccountFocusOut(event: FocusEvent) {
    if (!(event.currentTarget instanceof HTMLElement)) return;
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    closeAccountMenu();
  }

  async function handleLogout() {
    if (accountActionBusy) return;
    accountActionBusy = true;
    try {
      await clearAuthSession();
      authStore.clear();
      await goto('/login', { replaceState: true });
    } catch (error) {
      notificationStore.error(error instanceof Error ? error.message : String(error));
    } finally {
      accountActionBusy = false;
      accountMenuOpen = false;
    }
  }

  async function handleDisconnect() {
    if (accountActionBusy) return;
    accountActionBusy = true;
    try {
      await disconnect();
      await clearAuthSession();
      authStore.clear();
      serverStateStore.clear();
      await goto('/connect', { replaceState: true });
    } catch (error) {
      notificationStore.error(error instanceof Error ? error.message : String(error));
    } finally {
      accountActionBusy = false;
      accountMenuOpen = false;
    }
  }
</script>

<svelte:window
  onclick={closeAccountMenu}
  onkeydown={(event) => {
    if (event.key === 'Escape') {
      closeAccountMenu();
      drawerOpen = false;
    }
  }}
/>

<div class="explorer-shell">
  <header class="explorer-topbar">
    <button
      type="button"
      class="explorer-command-button explorer-mobile-menu"
      title={$t('workspace.toggleNavigation')}
      aria-label={$t('workspace.toggleNavigation')}
      aria-expanded={drawerOpen}
      onclick={(event) => { event.stopPropagation(); drawerOpen = !drawerOpen; }}
    >
      <Icon name="sidebarToggle" size="20px" />
    </button>

    <h1 class="explorer-route-title">{currentTitle}</h1>

    <div class="explorer-topbar-actions">
      {#if canApplyLockdown}
        <button
          type="button"
          class="explorer-command-button explorer-lockdown-button"
          data-active={serverStateStore.lockdown ? 'true' : undefined}
          disabled={lockdownBusy}
          aria-pressed={serverStateStore.lockdown}
          title={serverStateStore.lockdown ? $t('lockdown.disableAction') : $t('lockdown.enableAction')}
          onclick={toggleLockdown}
        >
          {#if lockdownBusy}
            <ProgressRing size={17} strokeWidth={2.5} label={$t('common.saving')} />
          {:else}
            <Icon name="supervisedUserCircleOff" size="18px" />
          {/if}
        </button>
      {/if}

      <div
        class="explorer-account-wrap"
        role="group"
        onpointerenter={handleAccountPointerEnter}
        onpointerleave={handleAccountPointerLeave}
        onfocusin={openAccountMenu}
        onfocusout={handleAccountFocusOut}
      >
        <button
          type="button"
          class="explorer-account-trigger"
          aria-label={$t('common.accountMenu')}
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          onclick={(event) => { event.stopPropagation(); openAccountMenu(); }}
        >
          <span
            class="explorer-connection-dot"
            class:connected={serverStateStore.connected}
            aria-hidden="true"
          ></span>
          <strong>{accountDisplayName}</strong>
          <Icon name="expandMore" size="16px" />
        </button>

        {#if accountMenuOpen}
          <div class="explorer-account-menu" role="menu" tabindex="-1">
            <div class="explorer-account-summary" role="presentation">
              <button
                type="button"
                class="explorer-account-avatar"
                role="menuitem"
                title={$t('avatar.change')}
                aria-label={$t('avatar.change')}
                onclick={openAvatarPicker}
              >
                <AvatarPreview username={authStore.username ?? ''} avatarPath={authStore.avatarPath} size={42} />
                <span class="explorer-account-avatar-edit" aria-hidden="true">
                  <Icon name="edit" size="11px" />
                </span>
              </button>
              <span class="explorer-account-identity">
                <strong>{accountDisplayName}</strong>
                <small>{authStore.username ?? $t('common.unknown')}</small>
              </span>
              {#if appLockStore.canLock}
                <button
                  class="explorer-account-lock"
                  role="menuitem"
                  title={$t('appLock.lockNow')}
                  aria-label={$t('appLock.lockNow')}
                  onclick={lockApp}
                >
                  <Icon name="lock" size="18px" />
                </button>
              {/if}
            </div>
            <span class="explorer-menu-separator"></span>
            <button role="menuitem" disabled={accountActionBusy} onclick={handleLogout}>
              <Icon name="logout" size="18px" /><span>{$t('lockdown.logout')}</span>
            </button>
            <button role="menuitem" disabled={accountActionBusy} onclick={handleDisconnect}>
              <Icon name="connect" size="18px" /><span>{$t('lockdown.disconnect')}</span>
            </button>
          </div>
        {/if}
      </div>
    </div>
  </header>

  <div class="explorer-workspace">
    {#if drawerOpen}
      <button class="explorer-drawer-scrim" aria-label={$t('common.close')} onclick={() => (drawerOpen = false)}></button>
    {/if}

    <aside class="explorer-navigation" class:explorer-navigation--open={drawerOpen} aria-label={$t('workspace.navigation')}>
      <nav class="explorer-navigation-main">
        {#each primaryNavigation as item (item.id)}
          <button class="explorer-nav-item" class:explorer-nav-item--active={isActive(item)} onclick={() => navigate(item.href)}>
            <Icon name={item.icon} size="19px" />
            <span>{item.label}</span>
            {#if item.badge}
              <span class="explorer-nav-badge">{item.badge > 99 ? '99+' : item.badge}</span>
            {/if}
          </button>
        {/each}

        <div class="explorer-nav-section">
          <p class="explorer-nav-section-title">{$t('workspace.pinned')}</p>
          {#if favoritesLoading && favoriteFolders.length === 0}
            <div class="explorer-nav-loading"><ProgressRing size={16} strokeWidth={2.2} label={$t('common.loading')} /></div>
          {:else if favoriteFolders.length === 0}
            <p class="explorer-nav-empty">{$t('workspace.noFavorites')}</p>
          {:else}
            {#each favoriteFolders as favorite (`${favorite.type}:${favorite.id}`)}
              <button class="explorer-nav-item explorer-nav-favorite" title={favorite.name} onclick={() => openFavorite(favorite)}>
                <Icon name="folder" size="18px" />
                <span>{favorite.name}</span>
              </button>
            {/each}
          {/if}
        </div>
      </nav>

      <nav class="explorer-navigation-bottom">
        {#each bottomNavigation as item (item.id)}
          <button class="explorer-nav-item" class:explorer-nav-item--active={isActive(item)} onclick={() => navigate(item.href)}>
            <Icon name={item.icon} size="19px" /><span>{item.label}</span>
          </button>
        {/each}

      </nav>
    </aside>

    <main class="explorer-content">
      {#key $page.url.pathname}
        <div class="explorer-route-view">
          {@render children()}
        </div>
      {/key}
    </main>
  </div>
</div>

{#if showAvatarPicker}
  <UserAvatarPicker onClose={() => (showAvatarPicker = false)} />
{/if}

<style>
  .explorer-shell {
    display: flex;
    height: 100%;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
  }

  .explorer-topbar {
    position: relative;
    z-index: 45;
    display: flex;
    min-height: 48px;
    align-items: center;
    gap: 0.65rem;
    border-bottom: 1px solid var(--explorer-border);
    padding: 0.35rem 0.7rem;
    background: color-mix(in srgb, var(--explorer-surface-raised) 88%, transparent);
    backdrop-filter: blur(24px) saturate(1.25);
  }

  .explorer-mobile-menu { display: none; width: 34px; padding: 0; }
  .explorer-route-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--explorer-text); font-size: 0.9rem; font-weight: 600; }
  .explorer-topbar-actions { margin-left: auto; display: flex; align-items: center; gap: 0.4rem; }
  .explorer-lockdown-button { width: 34px; padding-inline: 0; }
  .explorer-lockdown-button[data-active="true"] { color: var(--explorer-danger); background: color-mix(in srgb, var(--explorer-danger) 14%, transparent); }
  .explorer-account-wrap { position: relative; }
  .explorer-account-wrap::after { position: absolute; top: 100%; right: 0; left: 0; height: 0.45rem; content: ''; }
  .explorer-account-trigger { display: flex; max-width: 230px; align-items: center; gap: 0.55rem; border: 1px solid transparent; border-radius: 999px; padding: 0.3rem 0.5rem; color: var(--explorer-text); text-align: left; transition: background 120ms ease, border-color 120ms ease; }
  .explorer-account-trigger:hover { border-color: var(--explorer-border); background: var(--explorer-surface-hover); }
  .explorer-account-trigger > strong { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; font-weight: 600; }
  .explorer-connection-dot { width: 8px; height: 8px; flex: none; border-radius: 999px; background: var(--explorer-danger); box-shadow: 0 0 0 3px color-mix(in srgb, var(--explorer-danger) 15%, transparent); }
  .explorer-connection-dot.connected { background: var(--explorer-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--explorer-success) 15%, transparent); }
  .explorer-account-menu { position: absolute; top: calc(100% + 0.45rem); right: 0; z-index: 80; display: grid; min-width: 220px; overflow: hidden; border: 1px solid var(--explorer-border-strong); border-radius: var(--explorer-radius-medium); padding: 0.3rem; background: color-mix(in srgb, var(--explorer-surface-raised) 96%, transparent); box-shadow: var(--explorer-shadow); backdrop-filter: blur(24px); animation: menu-enter 120ms ease-out both; }
  .explorer-account-menu button { display: flex; align-items: center; gap: 0.65rem; border-radius: 5px; padding: 0.5rem 0.6rem; color: var(--explorer-text); font-size: 0.78rem; text-align: left; }
  .explorer-account-menu button:hover:not(:disabled) { background: var(--explorer-surface-hover); }
  .explorer-account-menu button:disabled { opacity: 0.45; }
  .explorer-account-summary { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 0.7rem; padding: 0.65rem; }
  .explorer-account-menu .explorer-account-avatar { position: relative; display: grid; width: 42px; height: 42px; place-items: center; overflow: visible; border-radius: 999px; padding: 0; transition: transform 140ms ease, box-shadow 140ms ease; }
  .explorer-account-menu .explorer-account-avatar:hover { transform: scale(1.04); box-shadow: 0 0 0 3px color-mix(in srgb, var(--explorer-accent) 22%, transparent); }
  .explorer-account-avatar-edit { position: absolute; right: -2px; bottom: -2px; display: grid; width: 17px; height: 17px; place-items: center; border: 2px solid var(--explorer-surface-raised); border-radius: 999px; color: var(--explorer-background); background: var(--explorer-accent); }
  .explorer-account-identity { display: grid; min-width: 0; }
  .explorer-account-identity strong, .explorer-account-identity small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .explorer-account-identity strong { font-size: 0.82rem; font-weight: 650; }
  .explorer-account-identity small { color: var(--explorer-text-muted); font-size: 0.7rem; }
  .explorer-account-menu .explorer-account-lock { width: 34px; height: 34px; justify-content: center; padding: 0; border-radius: 999px; }
  .explorer-menu-separator { height: 1px; margin: 0.25rem 0.35rem; background: var(--explorer-border); }
  .explorer-workspace { position: relative; display: flex; flex: 1; min-height: 0; }
  .explorer-navigation { z-index: 35; display: flex; width: 244px; min-width: 244px; flex-direction: column; border-right: 1px solid var(--explorer-border); padding: 0.55rem; background: var(--explorer-surface); }
  .explorer-navigation-main { min-height: 0; flex: 1; overflow-y: auto; }
  .explorer-navigation-bottom { display: grid; gap: 0.1rem; border-top: 1px solid var(--explorer-border); padding-top: 0.45rem; }
  .explorer-nav-item { position: relative; display: grid; width: 100%; min-height: 36px; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 0.45rem; border-radius: var(--explorer-radius-small); padding: 0.35rem 0.55rem; color: var(--explorer-text); font-size: 0.79rem; text-align: left; transition: background 100ms ease; }
  .explorer-nav-item:hover { background: var(--explorer-surface-hover); }
  .explorer-nav-item--active { background: var(--explorer-surface-selected); }
  .explorer-nav-item--active::before { position: absolute; top: 9px; bottom: 9px; left: 2px; width: 3px; border-radius: 3px; background: var(--explorer-accent); content: ''; }
  .explorer-nav-item span:nth-child(2) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .explorer-nav-badge { min-width: 19px; border-radius: 999px; padding: 0.08rem 0.35rem; color: var(--explorer-text); background: var(--explorer-accent-soft); font-size: 0.65rem; text-align: center; }
  .explorer-nav-section { margin-top: 0.65rem; border-top: 1px solid var(--explorer-border); padding-top: 0.65rem; }
  .explorer-nav-section-title { padding: 0 0.55rem 0.35rem; color: var(--explorer-text-muted); font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .explorer-nav-favorite { color: var(--explorer-text-muted); }
  .explorer-nav-favorite :global(.material-symbols-rounded) { color: #ffca4b; }
  .explorer-nav-empty { padding: 0.3rem 0.55rem; color: var(--explorer-text-muted); font-size: 0.7rem; line-height: 1.4; }
  .explorer-nav-loading { padding: 0.5rem; }
  .explorer-content { position: relative; min-width: 0; flex: 1; overflow: hidden; background: var(--explorer-background); }
  .explorer-route-view { height: 100%; min-height: 0; overflow-y: auto; animation: route-enter 160ms ease-out; }
  .explorer-drawer-scrim { display: none; }

  @keyframes route-enter { from { opacity: 0; } to { opacity: 1; } }
  @keyframes menu-enter { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

  @media (max-width: 820px) {
    .explorer-mobile-menu { display: inline-flex; }
    .explorer-navigation { position: absolute; top: 0; bottom: 0; left: 0; transform: translateX(-102%); box-shadow: var(--explorer-shadow); transition: transform 180ms cubic-bezier(0.1, 0.9, 0.2, 1); }
    .explorer-navigation--open { transform: translateX(0); }
    .explorer-drawer-scrim { position: absolute; inset: 0; z-index: 34; display: block; border: 0; background: rgba(0, 0, 0, 0.42); backdrop-filter: blur(2px); }
  }

  @media (max-width: 540px) {
    .explorer-topbar { min-height: 44px; padding-inline: 0.45rem; }
    .explorer-account-trigger > strong { display: none; }
    .explorer-account-trigger { padding-inline: 0.45rem; }
    .explorer-route-title { font-size: 0.82rem; }
  }
</style>
