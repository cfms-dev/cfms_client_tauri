<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    loadUserPreference,
    saveUserPreference,
    type UserPreference,
  } from '$lib/api';
  import { createAutoSave } from '$lib/settings-autosave.svelte';
  import { notificationStore, uploadStore } from '$lib/stores.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';

  const concurrencyOptions = [1, 2, 3, 4, 5, 6, 8];
  const defaultDownloadChunkSize = 64 * 1024;
  const downloadChunkSizeOptions = [
    16 * 1024,
    32 * 1024,
    defaultDownloadChunkSize,
    128 * 1024,
    256 * 1024,
    512 * 1024,
    1024 * 1024,
    2 * 1024 * 1024,
  ];

  let preferences = $state<UserPreference | null>(null);
  let loading = $state(true);
  let maxDownloads = $state(3);
  let maxUploads = $state(3);
  let maxDownloadChunkSize = $state(defaultDownloadChunkSize);
  let error = $state<string | null>(null);
  const autoSave = createAutoSave({
    onError: (message) => {
      error = message;
    },
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(async () => {
    try {
      preferences = await loadUserPreference();
      maxDownloads = normalizeConcurrency(preferences.task_concurrency?.max_downloads);
      maxUploads = normalizeConcurrency(preferences.task_concurrency?.max_uploads);
      maxDownloadChunkSize = normalizeDownloadChunkSize(
        preferences.transfer?.max_download_chunk_size,
      );
      uploadStore.configureConcurrency(maxUploads);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function applyTaskPreference(
    nextMaxDownloads: number,
    nextMaxUploads: number,
    nextMaxDownloadChunkSize: number,
  ) {
    if (!preferences) return;
    maxDownloads = normalizeConcurrency(nextMaxDownloads);
    maxUploads = normalizeConcurrency(nextMaxUploads);
    maxDownloadChunkSize = normalizeDownloadChunkSize(nextMaxDownloadChunkSize);
    error = null;
    void autoSave.run(async () => {
      const next: UserPreference = {
        ...(preferences as UserPreference),
        task_concurrency: {
          max_downloads: normalizeConcurrency(nextMaxDownloads),
          max_uploads: normalizeConcurrency(nextMaxUploads),
        },
        transfer: {
          max_download_chunk_size: normalizeDownloadChunkSize(nextMaxDownloadChunkSize),
        },
      };
      await saveUserPreference(next);
      preferences = next;
      uploadStore.configureConcurrency(next.task_concurrency.max_uploads);
    });
  }

  function resetTaskPreference() {
    applyTaskPreference(3, 3, defaultDownloadChunkSize);
  }

  function normalizeConcurrency(value: number | null | undefined) {
    if (!Number.isFinite(value)) return 3;
    return Math.min(8, Math.max(1, Math.trunc(value ?? 3)));
  }

  function normalizeDownloadChunkSize(value: number | null | undefined) {
    return downloadChunkSizeOptions.includes(value ?? 0)
      ? Number(value)
      : defaultDownloadChunkSize;
  }

  function formatChunkSize(bytes: number) {
    return bytes >= 1024 * 1024
      ? `${bytes / (1024 * 1024)} MiB`
      : `${bytes / 1024} KiB`;
  }
</script>

<div class="workspace-page settings-page-shell">
  <SettingsPageHeader
    title={$t('settings.tasks.title')}
    description={$t('settings.tasks.description')}
    icon="tasks"
    resetDisabled={loading || !preferences}
    onReset={resetTaskPreference}
  />

  <div class="settings-section-list">
    <section class="settings-section space-y-4">
      <div class="settings-section-heading">
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.tasks.concurrencyTitle')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.tasks.concurrencyHint')}
        </p>
      </div>

      <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.tasks.maxDownloads')}
        <select
          class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                 px-3 py-2 text-md3-on-surface disabled:opacity-60"
          bind:value={maxDownloads}
          disabled={loading || !preferences}
          onchange={(event) => applyTaskPreference(
            Number(event.currentTarget.value),
            maxUploads,
            maxDownloadChunkSize,
          )}
        >
          {#each concurrencyOptions as option}
            <option value={option}>
              {$t('settings.tasks.concurrentCount', { values: { count: option } })}
            </option>
          {/each}
        </select>
      </label>

      <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.tasks.maxUploads')}
        <select
          class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                 px-3 py-2 text-md3-on-surface disabled:opacity-60"
          bind:value={maxUploads}
          disabled={loading || !preferences}
          onchange={(event) => applyTaskPreference(
            maxDownloads,
            Number(event.currentTarget.value),
            maxDownloadChunkSize,
          )}
        >
          {#each concurrencyOptions as option}
            <option value={option}>
              {$t('settings.tasks.concurrentCount', { values: { count: option } })}
            </option>
          {/each}
        </select>
      </label>
    </section>

    <section class="settings-section space-y-4">
      <div class="settings-section-heading">
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.tasks.downloadReliabilityTitle')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.tasks.downloadReliabilityHint')}
        </p>
      </div>

      <div class="space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        <label for="download-chunk-size">
          {$t('settings.tasks.maxDownloadChunkSize')}
        </label>
        <select
          id="download-chunk-size"
          class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
                 px-3 py-2 text-md3-on-surface disabled:opacity-60"
          bind:value={maxDownloadChunkSize}
          disabled={loading || !preferences}
          aria-describedby="download-chunk-size-hint"
          onchange={(event) => applyTaskPreference(
            maxDownloads,
            maxUploads,
            Number(event.currentTarget.value),
          )}
        >
          {#each downloadChunkSizeOptions as option}
            <option value={option}>
              {formatChunkSize(option)}{option === defaultDownloadChunkSize
                ? ` — ${$t('settings.tasks.recommended')}`
                : ''}
            </option>
          {/each}
        </select>
        <span id="download-chunk-size-hint" class="block text-xs leading-relaxed text-md3-on-surface-variant">
          {$t('settings.tasks.maxDownloadChunkSizeHint')}
        </span>
      </div>
    </section>
  </div>
</div>
