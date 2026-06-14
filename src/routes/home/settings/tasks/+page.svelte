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

  let preferences = $state<UserPreference | null>(null);
  let loading = $state(true);
  let maxDownloads = $state(3);
  let maxUploads = $state(3);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  const autoSave = createAutoSave({
    onError: (message) => {
      error = message;
    },
    onSuccess: () => {
      status = $t('settings.tasks.saved');
    },
  });

  $effect(() => {
    if (!status) return;
    notificationStore.success(status, 5000);
    status = null;
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
      uploadStore.configureConcurrency(maxUploads);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function applyTaskPreference(nextMaxDownloads: number, nextMaxUploads: number) {
    if (!preferences) return;
    maxDownloads = normalizeConcurrency(nextMaxDownloads);
    maxUploads = normalizeConcurrency(nextMaxUploads);
    error = null;
    void autoSave.run(async () => {
      const next: UserPreference = {
        ...(preferences as UserPreference),
        task_concurrency: {
          max_downloads: normalizeConcurrency(nextMaxDownloads),
          max_uploads: normalizeConcurrency(nextMaxUploads),
        },
      };
      await saveUserPreference(next);
      preferences = next;
      uploadStore.configureConcurrency(next.task_concurrency.max_uploads);
    });
  }

  function resetTaskPreference() {
    applyTaskPreference(3, 3);
  }

  function normalizeConcurrency(value: number | null | undefined) {
    if (!Number.isFinite(value)) return 3;
    return Math.min(8, Math.max(1, Math.trunc(value ?? 3)));
  }
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <SettingsPageHeader
    title={$t('settings.tasks.title')}
    description={$t('settings.tasks.description')}
    icon="tasks"
    resetDisabled={loading || !preferences}
    onReset={resetTaskPreference}
  />

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-5">
    <section class="space-y-4">
      <div>
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
          value={maxDownloads}
          disabled={loading || !preferences}
          onchange={(event) => applyTaskPreference(Number(event.currentTarget.value), maxUploads)}
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
          value={maxUploads}
          disabled={loading || !preferences}
          onchange={(event) => applyTaskPreference(maxDownloads, Number(event.currentTarget.value))}
        >
          {#each concurrencyOptions as option}
            <option value={option}>
              {$t('settings.tasks.concurrentCount', { values: { count: option } })}
            </option>
          {/each}
        </select>
      </label>
    </section>
  </div>
</div>
