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
      <div class="flex items-start gap-3 rounded-xl border border-md3-error/40 bg-md3-error-container/35 p-4">
        <span class="mt-0.5 shrink-0 text-md3-error"><Icon name="warningAmber" size="24px" /></span>
        <div class="space-y-1">
          <p class="text-sm font-semibold text-md3-on-error-container">{$t('settings.localData.irreversible')}</p>
          <p class="text-xs leading-5 text-md3-on-surface-variant">{$t('settings.localData.restartNotice')}</p>
        </div>
      </div>

      <section class="space-y-2">
        <h3 class="text-sm font-semibold text-md3-on-surface">{$t('settings.localData.deletedTitle')}</h3>
        <ul class="grid gap-2 text-xs leading-5 text-md3-on-surface-variant sm:grid-cols-2">
          <li>{$t('settings.localData.deletedSettings')}</li>
          <li>{$t('settings.localData.deletedPreferences')}</li>
          <li>{$t('settings.localData.deletedTasks')}</li>
          <li>{$t('settings.localData.deletedCaches')}</li>
          <li>{$t('settings.localData.deletedExtensions')}</li>
          <li>{$t('settings.localData.deletedWebview')}</li>
        </ul>
      </section>

      <label class="flex cursor-pointer items-start gap-3 rounded-xl border border-md3-outline bg-md3-surface-container-high/60 p-4">
        <input
          type="checkbox"
          class="mt-0.5 size-4 accent-md3-primary"
          bind:checked={deleteDownloads}
          disabled={busy}
        />
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-md3-on-surface">{$t('settings.localData.deleteDownloads')}</span>
          <span class="mt-1 block text-xs leading-5 text-md3-on-surface-variant">{$t('settings.localData.deleteDownloadsHint')}</span>
        </span>
      </label>

      <p class="text-xs leading-5 text-md3-on-surface-variant">{$t('settings.localData.exclusions')}</p>

      <div class="flex justify-end gap-2 border-t border-md3-outline pt-4">
        <DialogActionButton disabled={busy} onclick={onClose}>{$t('common.cancel')}</DialogActionButton>
        <DialogActionButton type="submit" variant="danger" disabled={busy}>
          {#if busy}
            <ProgressRing size={16} strokeWidth={2} label={$t('settings.localData.clearing')} />
          {:else}
            <Icon name="deleteForever" size="18px" />
          {/if}
          {$t(busy ? 'settings.localData.clearing' : 'settings.localData.confirmAction')}
        </DialogActionButton>
      </div>
    </form>
  </ModalFrame>
{/if}
