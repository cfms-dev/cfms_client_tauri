<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { getDirectoryInfo, getDocument, loadUserPreference } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import HomeRecordPanel from '$lib/components/HomeRecordPanel.svelte';
  import {
    clearFavoriteRecords,
    clearRecentVisits,
    loadFavoriteRecords,
    loadRecentVisits,
    rememberVisit,
    removeRecentVisit,
    setFavoriteRecord,
    shouldRecordRecentVisits,
    type FilePreferenceScope,
    type FileRecord,
    type RecentFileRecord,
  } from '$lib/file-preferences';
  import {
    authStore,
    eventLog,
    fileShortcutValidationStore,
    notificationStore,
    serverStateStore,
  } from '$lib/stores.svelte';

  let recent = $state<RecentFileRecord[]>([]);
  let favorites = $state<FileRecord[]>([]);
  let loadingFavorites = $state(true);
  let openingId = $state<string | null>(null);
  let recordRecentVisits = $state(true);

  onMount(async () => {
    const scope = currentFilePreferenceScope();
    try {
      const preferences = await loadUserPreference();
      recordRecentVisits = shouldRecordRecentVisits(preferences);
      recent = await loadRecentVisits(scope);
      favorites = await loadFavoriteRecords(scope);
    } catch {
      recent = [];
      favorites = [];
      recordRecentVisits = true;
    } finally {
      loadingFavorites = false;
    }
  });

  async function openRecord(record: FileRecord) {
    openingId = `${record.type}:${record.id}`;
    try {
      const scope = currentFilePreferenceScope();

      if (record.type === 'directory') {
        await getDirectoryInfo(record.id);
        recent = await rememberVisit(scope, record);
        const params = new URLSearchParams({
          folder: record.id,
          name: record.name,
        });
        await goto(`/home/files?${params.toString()}`);
      } else {
        await getDocument(record.id, record.name);
        recent = await rememberVisit(scope, record);
        notificationStore.success($t('home.downloadQueued', { values: { name: record.name } }));
      }
    } catch (err) {
      if (isUnavailableError(err)) {
        fileShortcutValidationStore.markUnavailable(record.type, record.id);
        eventLog.push('warning', `Shortcut is no longer accessible: ${record.type}:${record.id}`);
      } else {
        notificationStore.error(err instanceof Error ? err.message : String(err));
      }
    } finally {
      openingId = null;
    }
  }

  async function removeRecent(record: FileRecord) {
    recent = await removeRecentVisit(currentFilePreferenceScope(), record);
  }

  async function removeFavorite(record: FileRecord) {
    await setFavoriteRecord(currentFilePreferenceScope(), record, false);
    favorites = favorites.filter((item) => item.type !== record.type || item.id !== record.id);
  }

  async function clearRecent() {
    recent = await clearRecentVisits(currentFilePreferenceScope());
  }

  async function clearFavorites() {
    await clearFavoriteRecords(currentFilePreferenceScope());
    favorites = [];
  }

  function isShortcutUnavailable(record: FileRecord) {
    return fileShortcutValidationStore.isUnavailable(record.type, record.id);
  }

  function isUnavailableError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return /Server returned\s+(403|404|410)\b/i.test(message)
      || /not found|no longer exists|does not exist|access denied/i.test(message);
  }

  function formatVisitTime(timestamp: number) {
    return new Date(timestamp).toLocaleString();
  }

  function currentFilePreferenceScope(): FilePreferenceScope {
    return {
      serverAddress: serverStateStore.remoteAddress,
      username: authStore.username,
    };
  }
</script>

<div class="blueprint-home mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-5">
  <section class="blueprint-hero overflow-hidden">
    <div class="relative z-10 grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6">
      <div class="min-w-0">
        <h1 class="text-[clamp(1.75rem,7vw,3.25rem)] font-semibold leading-tight text-md3-on-surface" style="font-family: var(--font-md3-serif);">
          {$t('home.workspace')}
        </h1>
        <p class="mt-3 max-w-xl text-sm text-md3-on-surface-variant sm:text-base">
          {$t('home.welcomeBack')}
          {#if authStore.nickname ?? authStore.username}
            , {authStore.nickname ?? authStore.username}
          {/if}
        </p>
      </div>

      <div class="grid min-w-[12rem] content-end gap-1 text-sm">
        <div class="blueprint-status-chip">
          <Icon name={serverStateStore.connected ? 'checkCircle' : 'errorFilled'} size="18px" />
          <span>{serverStateStore.connected ? $t('common.connected') : $t('common.disconnected')}</span>
        </div>
        <div class="blueprint-status-chip blueprint-status-chip-muted">
          <Icon name="history" size="18px" />
          <span>{recent.length} {$t('home.recent')}</span>
        </div>
        <div class="blueprint-status-chip blueprint-status-chip-muted">
          <Icon name="star" size="18px" />
          <span>{favorites.length} {$t('home.favorites')}</span>
        </div>
      </div>
    </div>
  </section>

  <div class="grid gap-4 lg:grid-cols-2">
    <HomeRecordPanel
      title={$t('home.recent')}
      icon="history"
      records={recent}
      emptyLabel={recordRecentVisits ? $t('home.noRecent') : $t('home.recentRecordingDisabled')}
      loadingLabel={$t('common.loadingEllipsis')}
      clearLabel={$t('home.clearRecent')}
      removeLabel={$t('home.removeShortcut')}
      unavailableLabel={$t('home.unavailable')}
      {openingId}
      meta={(item) => item.visitedAt ? formatVisitTime(item.visitedAt) : ''}
      isUnavailable={isShortcutUnavailable}
      onOpen={openRecord}
      onRemove={removeRecent}
      onClear={clearRecent}
    />

    <HomeRecordPanel
      title={$t('home.favorites')}
      icon="star"
      iconClass="text-md3-warning"
      records={favorites}
      loading={loadingFavorites}
      emptyLabel={$t('home.noFavorites')}
      loadingLabel={$t('common.loadingEllipsis')}
      clearLabel={$t('home.clearFavorites')}
      removeLabel={$t('home.removeShortcut')}
      unavailableLabel={$t('home.unavailable')}
      {openingId}
      meta={(item) => item.type === 'directory' ? $t('files.directory') : $t('files.document')}
      isUnavailable={isShortcutUnavailable}
      onOpen={openRecord}
      onRemove={removeFavorite}
      onClear={clearFavorites}
    />
  </div>
</div>

<style>
  .blueprint-home {
    isolation: isolate;
    position: relative;
  }

  .blueprint-hero {
    position: relative;
  }

  .blueprint-status-chip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.2rem;
    padding: 0.42rem 0.75rem;
    color: var(--color-md3-on-surface);
  }

  .blueprint-status-chip-muted {
    color: var(--color-md3-on-surface-variant);
  }
</style>
