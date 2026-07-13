<script lang="ts">
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import DialogActionButton from '$lib/components/DialogActionButton.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  let {
    onSave,
    onClose,
  }: {
    onSave: (groupName: string, displayName: string) => Promise<void>;
    onClose: () => void;
  } = $props();

  let groupName = $state('');
  let displayName = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let groupNameInput = $state<HTMLInputElement | null>(null);

  $effect(() => {
    void tick().then(() => groupNameInput?.focus());
  });

  async function submit() {
    const cleanGroupName = groupName.trim();
    const cleanDisplayName = displayName.trim() || cleanGroupName;

    if (!cleanGroupName) {
      error = $t('manage.groupNameRequired');
      return;
    }

    busy = true;
    error = null;
    try {
      await onSave(cleanGroupName, cleanDisplayName);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<ModalFrame
  title={$t('manage.createGroupTitle')}
  maxWidth="max-w-lg"
  closeLabel={$t('common.close')}
  onClose={() => {
    if (!busy) onClose();
  }}
>
  <form
    class="space-y-5 p-5"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <div class="flex items-start gap-3 rounded-lg border border-md3-outline/60 bg-md3-surface-container-high/40 p-3">
      <span class="rounded-lg bg-md3-primary-container/70 p-2 text-md3-primary-emphasis">
        <Icon name="groups" size="20px" />
      </span>
      <p class="text-sm text-md3-on-surface-variant">{$t('manage.createGroupDescription')}</p>
    </div>

    <label class="block">
      <span class="mb-1.5 block text-sm font-medium text-md3-on-surface">{$t('manage.groupNamePrompt')}</span>
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
          <Icon name="groups" size="18px" />
        </span>
        <input
          bind:this={groupNameInput}
          bind:value={groupName}
          class="w-full rounded-lg border border-md3-outline bg-md3-field py-2.5 pl-10 pr-3 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
          autocomplete="off"
          disabled={busy}
        />
      </div>
    </label>

    <label class="block">
      <span class="mb-1.5 block text-sm font-medium text-md3-on-surface">{$t('manage.displayNamePrompt')}</span>
      <div class="relative">
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
          <Icon name="edit" size="18px" />
        </span>
        <input
          bind:value={displayName}
          class="w-full rounded-lg border border-md3-outline bg-md3-field py-2.5 pl-10 pr-3 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
          autocomplete="off"
          disabled={busy}
          placeholder={groupName || $t('manage.displayNamePrompt')}
        />
      </div>
    </label>

    {#if error}
      <div class="flex items-start gap-2 rounded-lg border border-md3-error/35 bg-md3-error-container/25 p-3 text-sm text-md3-on-error-container">
        <Icon name="errorFilled" size="16px" />
        <p class="min-w-0 break-words">{error}</p>
      </div>
    {/if}

    <div class="flex flex-wrap items-center justify-end gap-2 border-t border-md3-outline/60 pt-4">
      <DialogActionButton disabled={busy} onclick={onClose}>
        {$t('common.cancel')}
      </DialogActionButton>
      <DialogActionButton
        type="submit"
        variant="primary"
        disabled={busy || !groupName.trim()}
      >
        {#if busy}
          <ProgressRing size={16} strokeWidth={2.4} label={$t('common.saving')} />
          {$t('common.saving')}
        {:else}
          <Icon name="done" size="16px" />
          {$t('common.add')}
        {/if}
      </DialogActionButton>
    </div>
  </form>
</ModalFrame>
