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
        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">
          CFMS
        </p>
        <h1 class="mt-2 text-[clamp(1.75rem,7vw,3.25rem)] font-semibold leading-tight text-md3-on-surface" style="font-family: var(--font-md3-sans);">
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
  }

  .blueprint-hero {
    position: relative;
    border-radius: 24px;
    background:
      linear-gradient(135deg, rgba(8, 47, 73, 0.58), rgba(15, 23, 42, 0.72) 54%, rgba(30, 27, 75, 0.48)),
      rgba(15, 23, 42, 0.72);
  }

  .blueprint-hero::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(125, 211, 252, 0.08) 1px, transparent 1px),
      linear-gradient(90deg, rgba(125, 211, 252, 0.08) 1px, transparent 1px),
      linear-gradient(rgba(148, 163, 184, 0.06) 2px, transparent 2px),
      linear-gradient(90deg, rgba(148, 163, 184, 0.06) 2px, transparent 2px);
    background-size: 26px 26px, 26px 26px, 104px 104px, 104px 104px;
    mask-image: linear-gradient(120deg, black 12%, transparent 88%);
  }

  .blueprint-status-chip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.5rem;
    border-radius: 9999px;
    padding: 0.55rem 0.85rem;
    color: var(--color-md3-on-surface);
    background: rgba(6, 78, 59, 0.42);
  }

  .blueprint-status-chip-muted {
    background: rgba(15, 23, 42, 0.46);
    color: var(--color-md3-on-surface-variant);
  }
</style>
