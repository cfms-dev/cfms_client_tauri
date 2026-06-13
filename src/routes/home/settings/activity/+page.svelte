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
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';

  let preferences = $state<UserPreference | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let recordRecentVisits = $state(true);
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
      recordRecentVisits = preferences.record_recent_visits !== false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  async function saveActivityPreference() {
    if (!preferences) return;
    saving = true;
    error = null;
    try {
      const next: UserPreference = {
        ...preferences,
        record_recent_visits: recordRecentVisits,
        recent_visits: recordRecentVisits ? preferences.recent_visits.slice(0, 10) : [],
      };
      await saveUserPreference(next);
      preferences = next;
      status = recordRecentVisits
        ? $t('settings.activity.saved')
        : $t('settings.activity.savedAndCleared');
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
    onclick={() => navigateUp(page.url.pathname)}
  >
    <Icon name="arrowBack" size="18px" />
    {$t('common.back')}
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    {$t('settings.activity.title')}
  </h1>

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
          bind:checked={recordRecentVisits}
          disabled={loading || saving}
          ariaLabel={$t('settings.activity.recordRecentVisits')}
        />
      </div>

      {#if !recordRecentVisits}
        <p class="text-xs text-md3-on-surface-variant">
          {$t('settings.activity.clearOnSaveHint')}
        </p>
      {/if}
    </section>

    <div class="flex flex-wrap gap-2">
      <button
        class="px-4 py-2 rounded-full font-medium text-sm
               bg-md3-primary-container text-md3-on-primary-container
               hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
        style="font-family: var(--font-md3-sans);"
        onclick={saveActivityPreference}
        disabled={loading || saving || !preferences}
      >
        <Icon name="done" size="18px" />
        {saving ? $t('common.saving') : $t('settings.activity.save')}
      </button>
    </div>
  </div>
</div>
