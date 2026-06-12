<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    loadUserPreference,
    saveUserPreference,
    type UserPreference,
  } from '$lib/api';
  import { notificationStore } from '$lib/stores.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import TopAppBar from '$lib/components/TopAppBar.svelte';

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

<TopAppBar title={$t('settings.storage.title')} backLabel={$t('common.back')} onBack={() => goto('/home/settings')} maxWidth="max-w-lg">
  {#snippet actions()}
    <IconButton icon="done" label={$t('settings.storage.save')} onclick={saveStoragePreference} disabled={loading || saving || !preferences} />
  {/snippet}
</TopAppBar>

<div class="p-6 space-y-4 max-w-lg mx-auto">

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <div>
      <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.storage.pathTitle')}
      </h2>
      <p class="text-sm text-md3-on-surface-variant mt-1 break-words">{storagePath}</p>
    </div>

    <div class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('settings.storage.useExternal')}
      <MdSwitch
        bind:checked={useExternalStorage}
        disabled={loading || saving}
        ariaLabel={$t('settings.storage.useExternal')}
      />
    </div>

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

  </div>
</div>
