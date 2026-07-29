<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { _ as t } from 'svelte-i18n';
  import {
    getLocalDataResetStatus,
    quitApplication,
    retryLocalDataReset,
    type LocalDataResetFailure,
  } from '$lib/api';
  import DialogActionButton from '$lib/components/DialogActionButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  let failures = $state<LocalDataResetFailure[]>([]);
  let loading = $state(true);
  let retrying = $state(false);
  let error = $state<string | null>(null);

  onMount(async () => {
    try {
      const status = await getLocalDataResetStatus();
      if (!status.pending) {
        await goto('/connect', { replaceState: true });
        return;
      }
      failures = status.failures;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      loading = false;
    }
  });

  async function retry() {
    if (retrying) return;
    retrying = true;
    error = null;
    try {
      const status = await retryLocalDataReset();
      failures = status.failures;
      if (status.pending) retrying = false;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
      retrying = false;
    }
  }
</script>

<div class="flex min-h-full items-center justify-center p-6">
  <main class="w-full max-w-xl overflow-hidden rounded-2xl border border-md3-error/40 bg-md3-surface-container/90 shadow-2xl backdrop-blur-xl">
    <div class="space-y-4 p-6 sm:p-8">
      <span class="grid size-14 place-items-center rounded-2xl bg-md3-error-container text-md3-on-error-container">
        <Icon name="warningAmber" size="32px" />
      </span>
      <div>
        <h1 class="text-xl font-bold text-md3-on-surface">{$t('settings.localData.recoveryTitle')}</h1>
        <p class="mt-2 text-sm leading-6 text-md3-on-surface-variant">{$t('settings.localData.recoveryDescription')}</p>
      </div>

      {#if loading}
        <div class="flex justify-center py-6"><ProgressRing size={30} label={$t('common.loading')} /></div>
      {:else}
        {#if failures.length > 0}
          <section class="overflow-hidden rounded-xl border border-md3-outline bg-md3-surface-container-high/60">
            <h2 class="border-b border-md3-outline px-4 py-3 text-xs font-semibold uppercase tracking-wide text-md3-on-surface-variant">
              {$t('settings.localData.recoveryFailures')}
            </h2>
            <ul class="divide-y divide-md3-outline">
              {#each failures as failure}
                <li class="px-4 py-3">
                  <p class="text-sm font-semibold text-md3-on-surface">{failure.target}</p>
                  <p class="mt-1 break-words text-xs leading-5 text-md3-on-surface-variant">{failure.message}</p>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if error}
          <p class="rounded-xl bg-md3-error-container px-4 py-3 text-sm text-md3-on-error-container">
            {$t('settings.localData.statusUnavailable')} {error}
          </p>
        {/if}
      {/if}
    </div>

    <div class="flex flex-col-reverse gap-2 border-t border-md3-outline bg-md3-surface-container-high/45 px-6 py-4 sm:flex-row sm:justify-end">
      <DialogActionButton disabled={retrying} onclick={() => void quitApplication()}>
        {$t('settings.localData.exitAction')}
      </DialogActionButton>
      <DialogActionButton variant="danger" disabled={loading || retrying} onclick={retry}>
        {#if retrying}<ProgressRing size={16} strokeWidth={2} label={$t('settings.localData.retrying')} />{/if}
        {$t(retrying ? 'settings.localData.retrying' : 'settings.localData.retryAction')}
      </DialogActionButton>
    </div>
  </main>
</div>
