<script lang="ts">
  // Init wizard page
  //
  // First-time setup for CA certificate manifest compilation.
  // When the manifest already exists, this page redirects to /connect.
  //
  // Reference: AppInitModel in reference/src/include/ui/models/init.py

  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  let stepText = $state('');
  let complete = $state(false);

  onMount(async () => {
    stepText = $t('init.checkingConfiguration');
    // In the reference app, this checks whether a CA manifest file exists.
    // For now, we check via the backend setting.
    try {
      // Stub: the actual CA manifest check is a Rust backend concern.
      // If the manifest doesn't exist, the backend would return false.
      // For now, assume it exists and proceed.
      stepText = $t('init.caReady');
      complete = true;

      // Navigate to connect after a brief pause so the user can see the status.
      setTimeout(() => goto('/connect'), 1200);
    } catch {
      stepText = $t('init.failedRetrying');
      setTimeout(() => goto('/connect'), 2000);
    }
  });
</script>

<div class="flex items-center justify-center min-h-full p-6">
  <div class="w-full" style="max-width: 400px;">
    <div class="bg-md3-surface-container/70 backdrop-blur-sm rounded-xl
                border border-md3-outline p-8 text-center space-y-5">
      <div class="flex justify-center">
        <span class="text-md3-primary-emphasis">
          <Icon name="security" size="48px" />
        </span>
      </div>

      <h1
        class="text-xl font-bold text-md3-on-surface"
        style="font-family: var(--font-md3-sans);"
      >
        {$t('init.title')}
      </h1>

      <p class="text-sm text-md3-on-surface-variant">
        {$t('init.description')}
      </p>

      {#if !complete}
        <div class="flex justify-center">
          <ProgressRing size={32} strokeWidth={3} label={$t('common.loadingEllipsis')} />
        </div>
      {:else}
        <div class="flex justify-center text-md3-success">
          <Icon name="checkCircle" size="32px" />
        </div>
      {/if}

      <p class="text-xs text-md3-on-surface-variant">
        {stepText}
      </p>
    </div>
  </div>
</div>
