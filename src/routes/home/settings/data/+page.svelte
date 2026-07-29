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

<div class="p-6 space-y-5 max-w-2xl mx-auto">
  <SettingsPageHeader
    title={$t('settings.localData.title')}
    description={$t('settings.localData.description')}
    icon="deleteSweep"
  />

  <section class="overflow-hidden rounded-xl border border-md3-error/35 bg-md3-surface-container/75 backdrop-blur-sm">
    <div class="flex items-start gap-4 p-5">
      <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-md3-error-container text-md3-on-error-container">
        <Icon name="deleteForever" size="25px" />
      </span>
      <div class="min-w-0 flex-1">
        <h2 class="text-base font-semibold text-md3-on-surface">{$t('settings.localData.cardTitle')}</h2>
        <p class="mt-1 text-sm leading-6 text-md3-on-surface-variant">{$t('settings.localData.cardDescription')}</p>
      </div>
    </div>
    <div class="flex justify-end border-t border-md3-outline bg-md3-surface-container-high/35 px-5 py-4">
      <button
        type="button"
        class="inline-flex min-h-10 items-center gap-2 rounded-full bg-md3-error px-5 text-sm font-semibold text-md3-on-error transition hover:brightness-110 active:scale-[0.98]"
        onclick={() => { dialogOpen = true; }}
      >
        <Icon name="deleteForever" size="19px" />
        {$t('settings.localData.openAction')}
      </button>
    </div>
  </section>

  <div class="flex items-start gap-3 rounded-xl border border-md3-outline bg-md3-surface-container-high/45 p-4">
    <Icon name="info" size="20px" class="mt-0.5 shrink-0 text-md3-primary-emphasis" />
    <p class="text-xs leading-5 text-md3-on-surface-variant">{$t('settings.localData.logicalDeletion')}</p>
  </div>
</div>

<LocalDataResetDialog
  open={dialogOpen}
  {busy}
  onClose={closeDialog}
  onConfirm={confirmReset}
/>
