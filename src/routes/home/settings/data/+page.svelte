<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import { resetLocalData } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';
  import LocalDataResetDialog from '$lib/components/LocalDataResetDialog.svelte';
  import SettingsPageHeader from '$lib/components/SettingsPageHeader.svelte';
  import { notificationStore } from '$lib/stores.svelte';

  let dialogOpen = $state(false);
  let busy = $state(false);

  function closeDialog() {
    if (!busy) dialogOpen = false;
  }

  async function confirmReset(deleteDownloads: boolean) {
    if (busy) return;
    busy = true;
    try {
      await resetLocalData(deleteDownloads);
    } catch (error) {
      busy = false;
      notificationStore.error(error instanceof Error ? error.message : String(error));
    }
  }
</script>

<div class="p-6 space-y-4 max-w-lg mx-auto">
  <SettingsPageHeader
    title={$t('settings.localData.title')}
    description={$t('settings.localData.description')}
    icon="backup"
  />

  <div class="rounded-xl border border-md3-outline bg-md3-surface-container/70 p-5 backdrop-blur-sm">
    <section class="space-y-4">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
          {$t('settings.localData.cardTitle')}
        </h2>
        <p class="mt-1 text-xs leading-5 text-md3-on-surface-variant">
          {$t('settings.localData.cardDescription')}
        </p>
      </div>

      <button
        type="button"
        class="reset-app-button"
        onclick={() => { dialogOpen = true; }}
      >
        <Icon name="restartAlt" size="19px" />
        {$t('settings.localData.openAction')}
      </button>
    </section>
  </div>
</div>

<LocalDataResetDialog
  open={dialogOpen}
  {busy}
  onClose={closeDialog}
  onConfirm={confirmReset}
/>

<style>
  .reset-app-button {
    display: inline-flex;
    min-height: 2.5rem;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border-radius: 9999px;
    padding-inline: 1rem;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
    font: 600 0.875rem/1.25 var(--font-md3-sans);
    transition:
      background-color var(--motion-duration-short4) var(--motion-easing-standard),
      box-shadow var(--motion-duration-short4) var(--motion-easing-standard),
      transform var(--motion-duration-short4) var(--motion-easing-emphasized-decelerate);
  }

  .reset-app-button:hover {
    background: color-mix(
      in srgb,
      var(--color-md3-on-primary-container) 8%,
      var(--color-md3-primary-container)
    );
    box-shadow: 0 2px 6px color-mix(in srgb, var(--color-md3-on-surface) 16%, transparent);
    transform: translateY(-1px);
  }

  .reset-app-button:active {
    transform: translateY(0) scale(0.98);
  }
</style>
