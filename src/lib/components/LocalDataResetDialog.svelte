<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import DialogActionButton from '$lib/components/DialogActionButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  let {
    open,
    busy = false,
    onClose,
    onConfirm,
  }: {
    open: boolean;
    busy?: boolean;
    onClose: () => void;
    onConfirm: (deleteDownloads: boolean) => void;
  } = $props();

  let deleteDownloads = $state(false);
  let wasOpen = false;

  $effect(() => {
    if (open && !wasOpen) deleteDownloads = false;
    wasOpen = open;
  });
</script>

{#if open}
  <ModalFrame
    title={$t('settings.localData.confirmTitle')}
    maxWidth="max-w-xl"
    closeLabel={$t('common.close')}
    dismissible={!busy}
    closeOnBackdrop={!busy}
    onClose={onClose}
  >
    <form class="space-y-5 p-5" onsubmit={(event) => { event.preventDefault(); onConfirm(deleteDownloads); }}>
      <div
        class="flex items-start gap-3 rounded-xl border border-md3-error/40 bg-md3-error-container/35 p-4"
        role="alert"
      >
        <span class="mt-0.5 shrink-0 text-md3-error"><Icon name="warningAmber" size="24px" /></span>
        <div class="space-y-1">
          <p class="text-sm font-semibold text-md3-on-error-container">{$t('settings.localData.irreversible')}</p>
          <p class="text-xs leading-5 text-md3-on-surface-variant">
            {$t('settings.localData.restartNotice')}
            <span class="mt-1 block">{$t('settings.localData.logicalDeletion')}</span>
          </p>
        </div>
      </div>

      <section class="space-y-2">
        <h3 class="flex items-center gap-2 text-sm font-semibold text-md3-on-surface">
          <Icon name="deleteSweep" size="19px" class="text-md3-error" />
          {$t('settings.localData.deletedTitle')}
        </h3>
        <ul class="grid gap-2 text-xs leading-5 text-md3-on-surface-variant sm:grid-cols-2">
          <li>{$t('settings.localData.deletedSettings')}</li>
          <li>{$t('settings.localData.deletedPreferences')}</li>
          <li>{$t('settings.localData.deletedTasks')}</li>
          <li>{$t('settings.localData.deletedCaches')}</li>
          <li>{$t('settings.localData.deletedExtensions')}</li>
          <li>{$t('settings.localData.deletedWebview')}</li>
        </ul>
      </section>

      <section class="space-y-2">
        <h3 class="flex items-center gap-2 text-sm font-semibold text-md3-on-surface">
          <Icon name="verifiedUser" size="19px" class="text-md3-primary-emphasis" />
          {$t('settings.localData.exclusionsTitle')}
        </h3>
        <p class="text-xs leading-5 text-md3-on-surface-variant">{$t('settings.localData.exclusions')}</p>
      </section>

      <label class="flex cursor-pointer items-start gap-3 px-1">
        <input
          type="checkbox"
          class="mt-0.5 size-4 shrink-0 accent-md3-primary"
          bind:checked={deleteDownloads}
          disabled={busy}
        />
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-md3-on-surface">{$t('settings.localData.deleteDownloads')}</span>
          <span class="mt-1 block text-xs leading-5 text-md3-on-surface-variant">{$t('settings.localData.deleteDownloadsHint')}</span>
        </span>
      </label>

      <div class="flex justify-end gap-2 border-t border-md3-outline pt-4">
        <DialogActionButton disabled={busy} onclick={onClose}>{$t('common.cancel')}</DialogActionButton>
        <DialogActionButton type="submit" variant="danger" disabled={busy}>
          {#if busy}
            <ProgressRing size={16} strokeWidth={2} label={$t('settings.localData.clearing')} />
          {:else}
            <Icon name="restartAlt" size="18px" />
          {/if}
          {$t(busy ? 'settings.localData.clearing' : 'settings.localData.confirmAction')}
        </DialogActionButton>
      </div>
    </form>
  </ModalFrame>
{/if}
