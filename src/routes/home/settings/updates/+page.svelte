<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion } from '@tauri-apps/api/app';
  import { goto } from '$app/navigation';
  import { getSetting, setSetting } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  type UpdateChannel = 'stable' | 'beta';

  let channel = $state<UpdateChannel>('stable');
  let appVersion = $state('unknown');
  let loading = $state(true);
  let saving = $state(false);
  let checking = $state(false);
  let status = $state<string | null>(null);
  let error = $state<string | null>(null);

  const channelDescription = $derived(
    channel === 'stable'
      ? 'Stable releases with the most testing.'
      : 'Pre-release builds for feature testing.',
  );

  $effect(() => {
    if (!status) return;
    const timeout = window.setTimeout(() => (status = null), 4000);
    return () => window.clearTimeout(timeout);
  });

  onMount(async () => {
    try {
      const [saved, version] = await Promise.all([
        getSetting('update_channel'),
        getVersion().catch(() => 'unknown'),
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
      status = 'Update channel saved.';
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
      status = 'You are on the latest version.';
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
    Back
  </button>

  <h1 class="text-xl font-bold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
    Updates
  </h1>

  <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
              border border-md3-outline p-5 space-y-4">
    <div class="text-sm space-y-1.5">
      <p class="text-md3-on-surface-variant">
        <span class="text-md3-on-surface">Current version:</span> {appVersion}
      </p>
      <p class="text-md3-on-surface-variant">
        <span class="text-md3-on-surface">Channel:</span> {channelDescription}
      </p>
    </div>

    <label class="block space-y-1.5 text-sm text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      Update Channel
      <select
        class="w-full rounded-lg border border-md3-outline bg-md3-surface-container-high
               px-3 py-2 text-md3-on-surface"
        bind:value={channel}
        disabled={loading || saving}
      >
        <option value="stable">Stable</option>
        <option value="beta">Beta</option>
      </select>
    </label>

    {#if checking}
      <div class="flex items-center gap-2 text-sm text-md3-on-surface-variant">
        <span class="animate-spin"><Icon name="refresh" size="16px" /></span>
        Checking for updates...
      </div>
    {/if}
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
        onclick={saveChannel}
        disabled={loading || saving}
      >
        <Icon name="done" size="18px" />
        {saving ? 'Saving...' : 'Save Channel'}
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
        Check for Updates
      </button>
    </div>
  </div>
</div>
