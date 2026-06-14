<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';

  let {
    onDelete,
    onCancel,
  }: {
    onDelete: () => void;
    onCancel: () => void;
  } = $props();
</script>

<ModalFrame
  title={$t('dialog.corruptedPreference.title')}
  maxWidth="max-w-md"
  closeLabel={$t('common.close')}
  onClose={onCancel}
>
  <div class="space-y-5 p-5">
    <div class="flex flex-col items-center gap-3 text-center">
      <div
        class="grid h-16 w-16 place-items-center rounded-2xl bg-md3-warning-container text-md3-warning"
        aria-hidden="true"
      >
        <Icon name="warningAmber" size="40px" />
      </div>
      <p class="text-sm leading-6 text-md3-on-surface">
        {$t('dialog.corruptedPreference.body')}
      </p>
      <p class="text-sm leading-6 text-md3-on-surface-variant">
        {$t('dialog.corruptedPreference.hint')}
      </p>
    </div>

    <div class="flex justify-end gap-2">
      <button
        type="button"
        class="rounded-full px-4 py-2 text-sm font-medium text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high"
        onclick={onCancel}
      >
        {$t('dialog.corruptedPreference.cancel')}
      </button>
      <button
        type="button"
        class="flex items-center gap-2 rounded-full bg-md3-primary px-4 py-2 text-sm font-medium text-md3-on-primary transition-all hover:brightness-110"
        onclick={onDelete}
      >
        <Icon name="delete" size="16px" />
        {$t('dialog.corruptedPreference.delete')}
      </button>
    </div>
  </div>
</ModalFrame>
