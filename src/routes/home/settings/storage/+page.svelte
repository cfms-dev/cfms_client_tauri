<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    loadUserPreference,
    saveUserPreference,
    type UserPreference,
  } from '$lib/api';
  import { createAutoSave } from '$lib/settings-autosave.svelte';
  import { pickDirectory } from '$lib/directory-picker';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';

  let preferences = $state<UserPreference | null>(null);
  let loading = $state(true);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  let useExternalStorage = $state(false);
  let externalStoragePath = $state('');
  let selectingPath = $state(false);
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

  async function chooseExternalStoragePath() {
    if (!preferences || selectingPath) return;
    selectingPath = true;
    try {
      const selected = await pickDirectory({
        title: $t('settings.storage.selectExternalPath'),
        defaultPath: externalStoragePath.trim() || undefined,
      });
      if (selected) {
        applyStoragePreference(true, selected.path);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      selectingPath = false;
    }
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
      <div class="flex min-w-0 flex-col gap-2 sm:flex-row">
        <input
          class="min-w-0 flex-1 rounded-lg border border-md3-outline bg-md3-surface-container-high
                 px-3 py-2 text-md3-on-surface disabled:opacity-60"
          type="text"
          value={externalStoragePath}
          oninput={(event) => applyStoragePreference(useExternalStorage, event.currentTarget.value)}
          placeholder={$t('settings.storage.externalPathPlaceholder')}
          disabled={loading || !preferences || !useExternalStorage}
        />
        <button
          type="button"
          class="inline-flex items-center justify-center gap-1.5 rounded-lg bg-md3-primary-container px-3 py-2
                 text-sm font-semibold text-md3-on-primary-container transition-colors
                 hover:bg-md3-primary-container/80 disabled:opacity-60"
          disabled={loading || !preferences || selectingPath}
          onclick={chooseExternalStoragePath}
        >
          <Icon name="folderOpen" size="18px" />
          {$t('settings.storage.selectFolder')}
        </button>
      </div>
    </label>
  </div>
</div>
