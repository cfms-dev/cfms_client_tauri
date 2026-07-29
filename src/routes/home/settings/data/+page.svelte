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
    icon="resetSettings"
  />

  <div class="rounded-xl border border-md3-outline bg-md3-surface-container/70 p-5 backdrop-blur-sm">
    <section class="space-y-4">
      <div class="flex items-start gap-3">
        <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-md3-primary-container text-md3-on-primary-container">
          <Icon name="resetSettings" size="23px" />
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
            {$t('settings.localData.cardTitle')}
          </h2>
          <p class="mt-1 text-xs leading-5 text-md3-on-surface-variant">
            {$t('settings.localData.cardDescription')}
          </p>
        </div>
      </div>

      <button
        type="button"
        class="inline-flex min-h-10 items-center gap-2 rounded-full bg-md3-secondary-container px-4
               text-sm font-semibold text-md3-on-secondary-container transition-all
               hover:brightness-110 active:scale-[0.98]"
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
