<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { getDocument } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
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

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
  <section class="space-y-2">
    <p class="text-sm text-md3-on-surface-variant">{$t('home.welcomeBack')}</p>
    <h1 class="text-2xl font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('home.workspace')}
    </h1>
  </section>

  <div class="grid gap-5 lg:grid-cols-2">
    <section class="min-w-0 overflow-hidden rounded-lg border border-md3-outline bg-md3-surface-container/70 backdrop-blur-sm">
      <div class="flex items-center gap-2 border-b border-md3-outline/60 px-5 py-4">
        <span class="text-md3-primary-emphasis"><Icon name="history" size="20px" /></span>
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('home.recent')}
        </h2>
      </div>

      {#if recent.length === 0}
        <p class="px-5 py-10 text-center text-sm text-md3-on-surface-variant">
          {$t('home.noRecent')}
        </p>
      {:else}
        <div class="divide-y divide-md3-outline/45">
          {#each recent as item (item.type + item.id)}
            <button
              type="button"
              class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-md3-surface-container-high/45 disabled:cursor-wait disabled:opacity-70"
              disabled={openingId === `${item.type}:${item.id}`}
              onclick={() => openRecord(item)}
            >
              <span class={item.type === 'directory' ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}>
                <Icon name={item.type === 'directory' ? 'folder' : 'filePresent'} size="22px" />
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-md3-on-surface">{item.name}</span>
                <span class="mt-0.5 block truncate text-xs text-md3-on-surface-variant">
                  {formatVisitTime(item.visitedAt)}
                </span>
              </span>
              {#if openingId === `${item.type}:${item.id}`}
                <ProgressRing size={16} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
              {:else}
                <Icon name={item.type === 'directory' ? 'folderOpen' : 'download'} size="18px" />
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <section class="min-w-0 overflow-hidden rounded-lg border border-md3-outline bg-md3-surface-container/70 backdrop-blur-sm">
      <div class="flex items-center gap-2 border-b border-md3-outline/60 px-5 py-4">
        <span class="text-md3-warning"><Icon name="star" size="20px" /></span>
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('home.favorites')}
        </h2>
      </div>

      {#if loadingFavorites}
        <div class="flex items-center gap-2 px-5 py-10 text-sm text-md3-on-surface-variant">
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {$t('common.loadingEllipsis')}
        </div>
      {:else if favorites.length === 0}
        <p class="px-5 py-10 text-center text-sm text-md3-on-surface-variant">
          {$t('home.noFavorites')}
        </p>
      {:else}
        <div class="divide-y divide-md3-outline/45">
          {#each favorites as item (item.type + item.id)}
            <button
              type="button"
              class="grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-md3-surface-container-high/45 disabled:cursor-wait disabled:opacity-70"
              disabled={openingId === `${item.type}:${item.id}`}
              onclick={() => openRecord(item)}
            >
              <span class={item.type === 'directory' ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}>
                <Icon name={item.type === 'directory' ? 'folder' : 'filePresent'} size="22px" />
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-md3-on-surface">{item.name}</span>
                <span class="mt-0.5 block truncate text-xs text-md3-on-surface-variant">
                  {item.type === 'directory' ? $t('files.directory') : $t('files.document')}
                </span>
              </span>
              {#if openingId === `${item.type}:${item.id}`}
                <ProgressRing size={16} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
              {:else}
                <Icon name={item.type === 'directory' ? 'folderOpen' : 'download'} size="18px" />
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>
