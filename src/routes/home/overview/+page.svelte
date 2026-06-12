<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { getDocument } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import HomeRecordPanel from '$lib/components/HomeRecordPanel.svelte';
  import {
    getRecentVisits,
    loadFavoriteRecords,
    rememberVisit,
    type FilePreferenceScope,
    type FileRecord,
    type RecentFileRecord,
  } from '$lib/file-preferences';
  import { authStore, notificationStore, serverStateStore } from '$lib/stores.svelte';

  let recent = $state<RecentFileRecord[]>([]);
  let favorites = $state<FileRecord[]>([]);
  let loadingFavorites = $state(true);
  let openingId = $state<string | null>(null);

  onMount(async () => {
    const scope = currentFilePreferenceScope();
    recent = getRecentVisits(scope);
    try {
      favorites = await loadFavoriteRecords(scope);
    } catch {
      favorites = [];
    } finally {
      loadingFavorites = false;
    }
  });

  async function openRecord(record: FileRecord) {
    openingId = `${record.type}:${record.id}`;
    try {
      const scope = currentFilePreferenceScope();
      rememberVisit(scope, record);
      recent = getRecentVisits(scope);

      if (record.type === 'directory') {
        const params = new URLSearchParams({
          folder: record.id,
          name: record.name,
        });
        await goto(`/home/files?${params.toString()}`);
      } else {
        await getDocument(record.id, record.name);
        notificationStore.success($t('home.downloadQueued', { values: { name: record.name } }));
      }
    } catch (err) {
      notificationStore.error(err instanceof Error ? err.message : String(err));
    } finally {
      openingId = null;
    }
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

<div class="blueprint-home mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
  <section class="blueprint-hero overflow-hidden">
    <div class="relative z-10 grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-7">
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

      <div class="grid min-w-[12rem] content-end gap-2 text-sm">
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

  <div class="grid gap-5 lg:grid-cols-2">
    <HomeRecordPanel
      title={$t('home.recent')}
      icon="history"
      records={recent}
      emptyLabel={$t('home.noRecent')}
      loadingLabel={$t('common.loadingEllipsis')}
      {openingId}
      meta={(item) => item.visitedAt ? formatVisitTime(item.visitedAt) : ''}
      onOpen={openRecord}
    />

    <HomeRecordPanel
      title={$t('home.favorites')}
      icon="star"
      iconClass="text-md3-warning"
      records={favorites}
      loading={loadingFavorites}
      emptyLabel={$t('home.noFavorites')}
      loadingLabel={$t('common.loadingEllipsis')}
      {openingId}
      meta={(item) => item.type === 'directory' ? $t('files.directory') : $t('files.document')}
      onOpen={openRecord}
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
    min-height: 2.5rem;
    padding: 0.55rem 0.85rem;
    color: var(--color-md3-on-surface);
  }

  .blueprint-status-chip-muted {
    color: var(--color-md3-on-surface-variant);
  }
</style>
