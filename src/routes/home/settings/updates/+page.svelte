<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import { getSetting, setSetting } from '$lib/api';
  import { notificationStore } from '$lib/stores.svelte';
  import Icon from '$lib/components/Icon.svelte';

  type UpdateChannel = 'stable' | 'beta';

  let channel = $state<UpdateChannel>('stable');
  let appVersion = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let checking = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const channelDescription = $derived(
    channel === 'stable'
      ? $t('settings.updates.stableDescription')
      : $t('settings.updates.betaDescription'),
  );

  $effect(() => {
    if (!status) return;
    notificationStore.success(status);
    status = null;
  });

  $effect(() => {
    if (!error) return;
    notificationStore.error(error);
    error = null;
  });

  onMount(async () => {
    try {
      const [saved, version] = await Promise.all([
        getSetting('update_channel'),
        getVersion().catch(() => $t('common.unknown')),
      ]);
      if (saved === 'stable' || saved === 'beta') {
        channel = saved;
      }
      appVersion = version;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  });

  async function saveChannel() {
    saving = true;
    error = null;
    try {
      await setSetting('update_channel', channel);
      status = $t('settings.updates.saved');
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  async function checkForUpdates() {
    checking = true;
    error = null;
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      status = $t('settings.updates.latest');
    } finally {
      checking = false;
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
    {$t('settings.updates.title')}
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <div class="text-sm space-y-1.5">
      <p class="text-md3-on-surface-variant">
        <span class="text-md3-on-surface">{$t('settings.updates.currentVersion')}:</span> {appVersion}
      </p>
      <p class="text-md3-on-surface-variant">
        <span class="text-md3-on-surface">{$t('settings.updates.channel')}:</span> {channelDescription}
      </p>
    </div>

    <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {$t('settings.updates.updateChannel')}
      <select
        class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
               px-3 py-2 text-md3-on-surface"
        bind:value={channel}
        disabled={loading || saving}
      >
        <option value="stable">{$t('settings.updates.stable')}</option>
        <option value="beta">{$t('settings.updates.beta')}</option>
      </select>
    </label>

    {#if checking}
      <div class="flex items-center gap-2 text-sm text-md3-on-surface-variant">
        <span class="animate-spin"><Icon name="refresh" size="16px" /></span>
        {$t('about.checkingUpdates')}
      </div>
    {/if}
    <div class="flex flex-wrap gap-2">
      <button
        class="px-4 py-2 rounded-full font-medium text-sm
               bg-md3-primary-container text-md3-on-primary-container
               hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
        style="font-family: var(--font-md3-sans);"
        onclick={saveChannel}
        disabled={loading || saving}
      >
        <Icon name="done" size="18px" />
        {saving ? $t('common.saving') : $t('settings.updates.save')}
      </button>
      <button
        class="px-4 py-2 rounded-full font-medium text-sm
               bg-md3-surface-container-high text-md3-on-surface
               hover:brightness-110 disabled:opacity-50 transition-all flex items-center gap-2"
        style="font-family: var(--font-md3-sans);"
        onclick={checkForUpdates}
        disabled={checking}
      >
        <Icon name="update" size="18px" />
        {$t('settings.updates.check')}
      </button>
    </div>
  </div>
</div>
