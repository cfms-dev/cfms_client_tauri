<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { _ as t } from 'svelte-i18n';
  import {
    loadUserPreference,
    saveUserPreference,
    type UserPreference,
  } from '$lib/api';
  import { navigateUp } from '$lib/navigation';
  import { notificationStore, uploadStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';

  const concurrencyOptions = [1, 2, 3, 4, 5, 6, 8];

  let preferences = $state<UserPreference | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let maxDownloads = $state(3);
  let maxUploads = $state(3);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

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

  async function saveTaskPreference() {
    if (!preferences) return;
    saving = true;
    error = null;
    try {
      const next: UserPreference = {
        ...preferences,
        task_concurrency: {
          max_downloads: normalizeConcurrency(maxDownloads),
          max_uploads: normalizeConcurrency(maxUploads),
        },
      };
      await saveUserPreference(next);
      preferences = next;
      uploadStore.configureConcurrency(next.task_concurrency.max_uploads);
      status = $t('settings.tasks.saved');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  function normalizeConcurrency(value: number | null | undefined) {
    if (!Number.isFinite(value)) return 3;
    return Math.min(8, Math.max(1, Math.trunc(value ?? 3)));
  }
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => navigateUp(page.url.pathname)}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <div class="flex items-center gap-3">
    <span class="rounded-2xl bg-md3-primary-container p-3 text-md3-on-primary-container">
      <Icon name="tasks" size="28px" />
    </span>
    <div class="min-w-0">
      <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.tasks.title')}
      </h1>
      <p class="text-xs text-md3-on-surface-variant">
        {$t('settings.tasks.description')}
      </p>
    </div>
  </div>

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
          bind:value={maxDownloads}
          disabled={loading || saving}
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
          disabled={loading || saving}
        >
          {#each concurrencyOptions as option}
            <option value={option}>
              {$t('settings.tasks.concurrentCount', { values: { count: option } })}
            </option>
          {/each}
        </select>
      </label>
    </section>

    <div class="flex flex-wrap gap-2">
      <button
        class="px-4 py-2 rounded-full font-medium text-sm
               bg-md3-primary-container text-md3-on-primary-container
               hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
        style="font-family: var(--font-md3-sans);"
        onclick={saveTaskPreference}
        disabled={loading || saving || !preferences}
      >
        <Icon name="done" size="18px" />
        {saving ? $t('common.saving') : $t('settings.tasks.save')}
      </button>
    </div>
  </div>
</div>
