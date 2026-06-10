<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    loadUserPreference,
    saveUserPreference,
    type UserPreference,
  } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  let preferences = $state<UserPreference | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  let useExternalStorage = $state(false);
  let externalStoragePath = $state('');

  const storagePath = $derived(
    useExternalStorage && externalStoragePath.trim()
      ? externalStoragePath.trim()
      : $t('settings.storage.defaultPath'),
  );

  $effect(() => {
    if (!status) return;
    const timeout = window.setTimeout(() => (status = null), 5000);
    return () => window.clearTimeout(timeout);
  });

  onMount(async () => {
    try {
      preferences = await loadUserPreference();
      useExternalStorage = preferences.use_external_storage;
      externalStoragePath = preferences.external_storage_path;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  async function saveStoragePreference() {
    if (!preferences) return;
    saving = true;
    error = null;
    try {
      const next: UserPreference = {
        ...preferences,
        use_external_storage: useExternalStorage,
        external_storage_path: externalStoragePath.trim(),
      };
      await saveUserPreference(next);
      preferences = next;
      status = $t('settings.storage.saved');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <button
    class="flex items-center gap-1.5 text-sm text-md3-on-surface-variant
           hover:text-md3-on-surface transition-colors"
    style="font-family: var(--font-md3-sans);"
    onclick={() => goto('/home/settings')}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    {$t('settings.storage.title')}
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <div>
      <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.storage.pathTitle')}
      </h2>
      <p class="text-sm text-md3-on-surface-variant mt-1 break-words">{storagePath}</p>
    </div>

    <label class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('settings.storage.useExternal')}
      <input
        class="accent-md3-primary"
        type="checkbox"
        bind:checked={useExternalStorage}
        disabled={loading || saving}
      />
    </label>

    <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('settings.storage.externalPath')}
      <input
        class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
               px-3 py-2 text-md3-on-surface disabled:opacity-60"
        type="text"
        bind:value={externalStoragePath}
        placeholder={$t('settings.storage.externalPathPlaceholder')}
        disabled={loading || saving || !useExternalStorage}
      />
    </label>

    {#if status}
      <p class="text-sm text-md3-success flex items-center gap-1.5">
        <Icon name="checkCircle" size="16px" />
        {status}
      </p>
    {/if}
    {#if error}
      <p class="text-sm text-md3-error flex items-center gap-1.5">
        <Icon name="errorFilled" size="16px" />
        {error}
      </p>
    {/if}

    <div class="flex flex-wrap gap-2">
      <button
        class="px-4 py-2 rounded-full font-medium text-sm
               bg-md3-primary-container text-md3-on-primary-container
               hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
        style="font-family: var(--font-md3-sans);"
        onclick={saveStoragePreference}
        disabled={loading || saving || !preferences}
      >
        <Icon name="done" size="18px" />
        {saving ? $t('common.saving') : $t('settings.storage.save')}
      </button>
    </div>
  </div>
</div>
