<script lang="ts">
  import { onMount } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    loadUserPreference,
    saveUserPreference,
    type UserPreference,
  } from '$lib/api';
  import { createAutoSave } from '$lib/features/settings/settings-autosave.svelte.ts';
  import { pickDirectory } from '$lib/shared/platform/directory-picker';
  import { notificationStore } from "$lib/shared/notifications/notifications.svelte.ts";
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MdSwitch from '$lib/shared/ui/MdSwitch.svelte';
  import SettingsPageHeader from '$lib/shared/ui/SettingsPageHeader.svelte';
  import FluentTextInput from '$lib/shared/ui/FluentTextInput.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';

  let preferences = $state<UserPreference | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let useExternalStorage = $state(false);
  let externalStoragePath = $state('');
  let selectingPath = $state(false);
  const autoSave = createAutoSave({
    onError: (message) => {
      error = message;
    },
  });

  const storagePath = $derived(
    useExternalStorage && externalStoragePath.trim()
      ? externalStoragePath.trim()
      : $t('settings.storage.defaultPath'),
  );

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

<div class="workspace-page settings-page-shell">
  <SettingsPageHeader
    title={$t('settings.storage.title')}
    icon="storage"
    resetDisabled={loading || !preferences}
    onReset={resetStoragePreference}
  />

  <section class="settings-section-list settings-section space-y-4">
    <div class="settings-section-heading">
      <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.storage.pathTitle')}
      </h2>
      <p class="text-sm text-md3-on-surface-variant mt-1 break-words">{storagePath}</p>
    </div>

    <div class="settings-row text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('settings.storage.useExternal')}
      <MdSwitch
        checked={useExternalStorage}
        disabled={loading || !preferences}
        ariaLabel={$t('settings.storage.useExternal')}
        onChange={(enabled) => applyStoragePreference(enabled, externalStoragePath)}
      />
    </div>

    <div class="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center">
      <FluentTextInput
        id="external-storage-path"
        label={$t('settings.storage.externalPath')}
        value={externalStoragePath}
        oninput={(value) => applyStoragePreference(useExternalStorage, value)}
        placeholder={$t('settings.storage.externalPathPlaceholder')}
        disabled={loading || !preferences || !useExternalStorage}
      />
      <FluentButton data-fluent-owner="routes-home-settings-storage-page"
        class="shrink-0"
        appearance="outline"
        disabled={loading || !preferences || selectingPath}
        onclick={chooseExternalStoragePath}
      >
        <Icon name="folderOpen" size="18px" />
        {$t('settings.storage.selectFolder')}
      </FluentButton>
    </div>
  </section>
</div>
