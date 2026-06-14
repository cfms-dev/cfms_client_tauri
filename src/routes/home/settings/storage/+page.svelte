<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    loadUserPreference,
    saveUserPreference,
    type UserPreference,
  } from '$lib/api';
  import { createAutoSave } from '$lib/settings-autosave.svelte';
  import { notificationStore } from '$lib/stores.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';

  let preferences = $state<UserPreference | null>(null);
  let loading = $state(true);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  let useExternalStorage = $state(false);
  let externalStoragePath = $state('');
  const autoSave = createAutoSave({
    onError: (message) => {
      error = message;
    },
    onSuccess: () => {
      status = $t('settings.storage.saved');
    },
  });

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

  function applyStoragePreference(nextUseExternalStorage: boolean, nextExternalStoragePath: string) {
    if (!preferences) return;
    useExternalStorage = nextUseExternalStorage;
    externalStoragePath = nextExternalStoragePath;
    error = null;
    void autoSave.run(async () => {
      const next: UserPreference = {
        ...(preferences as UserPreference),
        use_external_storage: nextUseExternalStorage,
        external_storage_path: nextExternalStoragePath.trim(),
      };
      await saveUserPreference(next);
      preferences = next;
    });
  }

  function resetStoragePreference() {
    applyStoragePreference(false, '');
  }
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <SettingsPageHeader
    title={$t('settings.storage.title')}
    icon="storage"
    resetDisabled={loading || !preferences}
    onReset={resetStoragePreference}
  />

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
        checked={useExternalStorage}
        disabled={loading || !preferences}
        ariaLabel={$t('settings.storage.useExternal')}
        onChange={(enabled) => applyStoragePreference(enabled, externalStoragePath)}
      />
    </div>

    <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('settings.storage.externalPath')}
      <input
        class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
               px-3 py-2 text-md3-on-surface disabled:opacity-60"
        type="text"
        value={externalStoragePath}
        oninput={(event) => applyStoragePreference(useExternalStorage, event.currentTarget.value)}
        placeholder={$t('settings.storage.externalPathPlaceholder')}
        disabled={loading || !preferences || !useExternalStorage}
      />
    </label>
  </div>
</div>
