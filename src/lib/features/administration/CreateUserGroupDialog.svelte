<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';

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
      error = formatUserFacingError(err);
    } finally {
      busy = false;
    }
  }
  const outlinedId = $props.id();
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
    <div class="flex items-start gap-3 rounded-lg border border-md3-outline/60 bg-md3-surface-container-high p-3">
      <span class="rounded-lg bg-md3-primary-container/70 p-2 text-md3-primary-emphasis">
        <Icon name="groups" size="20px" />
      </span>
      <p class="text-sm text-md3-on-surface-variant">{$t('manage.createGroupDescription')}</p>
    </div>

    <div class="block">
      <MdOutlinedField inputId={`${outlinedId}-1`} label={$t('manage.groupNamePrompt')} disabled={busy}>
        <div data-outlined-content class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name="groups" size="18px" />
          </span>
          <input id={`${outlinedId}-1`} data-focus-ring="delegated"
            bind:this={groupNameInput}
            bind:value={groupName}
            class="cfms-native-field w-full pl-10 pr-3 text-sm text-md3-on-surface transition"
            autocomplete="off"
            disabled={busy}
          />
        </div>
      </MdOutlinedField>
    </div>

    <div class="block">
      <MdOutlinedField inputId={`${outlinedId}-2`} label={$t('manage.displayNamePrompt')} disabled={busy}>
        <div data-outlined-content class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name="edit" size="18px" />
          </span>
          <input id={`${outlinedId}-2`} data-focus-ring="delegated"
            bind:value={displayName}
            class="cfms-native-field w-full pl-10 pr-3 text-sm text-md3-on-surface transition"
            autocomplete="off"
            disabled={busy}
            placeholder={groupName || $t('manage.displayNamePrompt')}
          />
        </div>
      </MdOutlinedField>
    </div>

    {#if error}
      <div class="flex items-start gap-2 rounded-lg border border-md3-error/35 bg-md3-error-container/25 p-3 text-sm text-md3-on-error-container">
        <span class="cfms-icon-text__icon"><Icon name="errorFilled" size="16px" /></span>
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
