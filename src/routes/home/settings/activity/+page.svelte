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
  let recordRecentVisits = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);
  const autoSave = createAutoSave({
    onError: (message) => {
      error = message;
    },
    onSuccess: () => {
      status = recordRecentVisits
        ? $t('settings.activity.saved')
        : $t('settings.activity.savedAndCleared');
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
      recordRecentVisits = preferences.record_recent_visits === true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  function applyActivityPreference(enabled: boolean) {
    if (!preferences) return;
    recordRecentVisits = enabled;
    error = null;
    void autoSave.run(async () => {
      const next: UserPreference = {
        ...(preferences as UserPreference),
        record_recent_visits: enabled,
        recent_visits: enabled ? (preferences as UserPreference).recent_visits.slice(0, 10) : [],
      };
      await saveUserPreference(next);
      preferences = next;
    });
  }

  function resetActivityPreference() {
    applyActivityPreference(false);
  }
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <SettingsPageHeader
    title={$t('settings.activity.title')}
    icon="history"
    resetDisabled={loading || !preferences}
    onReset={resetActivityPreference}
  />

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <section class="space-y-3">
      <div>
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.activity.recentVisits')}
        </h2>
        <p class="text-xs text-md3-on-surface-variant mt-1">
          {$t('settings.activity.recentVisitsHint')}
        </p>
      </div>

      <div class="flex items-center justify-between gap-3 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
        {$t('settings.activity.recordRecentVisits')}
        <MdSwitch
          checked={recordRecentVisits}
          disabled={loading || !preferences}
          ariaLabel={$t('settings.activity.recordRecentVisits')}
          onChange={applyActivityPreference}
        />
      </div>

      {#if !recordRecentVisits}
        <p class="text-xs text-md3-on-surface-variant">
          {$t('settings.activity.clearOnSaveHint')}
        </p>
      {/if}
    </section>
  </div>
</div>
