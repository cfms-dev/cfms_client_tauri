<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import type { UserBlockTarget } from '$lib/api';
  import type { IconName } from '$lib/icons';

  type BlockType = 'read' | 'write' | 'move';
  type TargetType = UserBlockTarget['type'];

  const blockOptions: Array<{ id: BlockType; icon: IconName; labelKey: string }> = [
    { id: 'read', icon: 'visibility', labelKey: 'files.operation.read' },
    { id: 'write', icon: 'edit', labelKey: 'files.operation.write' },
    { id: 'move', icon: 'driveFileMove', labelKey: 'files.operation.move' },
  ];

  let {
    username,
    onSave,
    onClose,
  }: {
    username: string;
    onSave: (
      blockTypes: string[],
      target: UserBlockTarget,
      notAfter: number | null,
    ) => Promise<void>;
    onClose: () => void;
  } = $props();

  let selectedTypes = $state<Set<BlockType>>(new Set(['read', 'write', 'move']));
  let targetType = $state<TargetType>('all');
  let targetId = $state('');
  let expiryEnabled = $state(false);
  let expiryDate = $state(toDateInput(Date.now() + 24 * 60 * 60 * 1000));
  let expiryTime = $state(toTimeInput(Date.now() + 24 * 60 * 60 * 1000));
  let busy = $state(false);
  let error = $state<string | null>(null);

  function toDateInput(value: number) {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function toTimeInput(value: number) {
    const date = new Date(value);
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${hour}:${minute}`;
  }

  function toggleType(type: BlockType) {
    const next = new Set(selectedTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    selectedTypes = next;
    error = null;
  }

  function chooseTarget(type: TargetType) {
    targetType = type;
    targetId = '';
    error = null;
  }

  function getExpiryTimestamp(): number | null {
    if (!expiryEnabled) return null;

    const timestamp = new Date(`${expiryDate}T${expiryTime || '00:00'}:00`).getTime();
    if (Number.isNaN(timestamp) || timestamp <= Date.now()) {
      throw new Error($t('manage.invalidExpiry'));
    }

    return Math.floor(timestamp / 1000);
  }

  async function submit() {
    const blockTypes = [...selectedTypes];
    if (blockTypes.length === 0) {
      error = $t('manage.selectBlockType');
      return;
    }

    const target: UserBlockTarget = { type: targetType };
    if (targetType !== 'all') {
      const id = targetId.trim();
      if (!id) {
        error = $t('manage.selectTarget');
        return;
      }
      target.id = id;
    }

    busy = true;
    error = null;
    try {
      await onSave(blockTypes, target, getExpiryTimestamp());
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<ModalFrame
  title={$t('manage.blockUserTitle', { values: { username } })}
  maxWidth="max-w-2xl"
  closeLabel={$t('common.close')}
  onClose={onClose}
>
  <form
    class="space-y-5 p-5"
    onsubmit={(event) => {
      event.preventDefault();
      submit();
    }}
  >
    <section class="space-y-3">
      <div>
        <h4 class="text-sm font-semibold text-md3-on-surface">{$t('manage.blockTypes')}</h4>
        <p class="text-xs text-md3-on-surface-variant">{$t('manage.blockTypesHelp')}</p>
      </div>
      <div class="grid gap-2 sm:grid-cols-3">
        {#each blockOptions as option}
          <button
            type="button"
            class="flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 {selectedTypes.has(option.id)
              ? 'border-md3-primary bg-md3-primary-container text-md3-on-primary-container shadow-lg shadow-md3-primary/10'
              : 'border-md3-outline bg-md3-surface-container-high/40 text-md3-on-surface-variant hover:bg-md3-surface-container-high'}"
            disabled={busy}
            aria-pressed={selectedTypes.has(option.id)}
            onclick={() => toggleType(option.id)}
          >
            <Icon name={option.icon} size="18px" />
            {$t(option.labelKey)}
          </button>
        {/each}
      </div>
    </section>

    <section class="space-y-3">
      <div>
        <h4 class="text-sm font-semibold text-md3-on-surface">{$t('manage.target')}</h4>
        <p class="text-xs text-md3-on-surface-variant">{$t('manage.targetHelp')}</p>
      </div>
      <div class="grid gap-2 sm:grid-cols-3">
        {#each ['all', 'directory', 'document'] as type}
          <button
            type="button"
            class="rounded-lg border px-3 py-2.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 {targetType === type
              ? 'border-md3-primary bg-md3-primary-container text-md3-on-primary-container'
              : 'border-md3-outline bg-md3-surface-container-high/40 text-md3-on-surface-variant hover:bg-md3-surface-container-high'}"
            disabled={busy}
            aria-pressed={targetType === type}
            onclick={() => chooseTarget(type as TargetType)}
          >
            {type === 'all' ? $t('tasks.all') : type === 'directory' ? $t('files.directory') : $t('files.document')}
          </button>
        {/each}
      </div>

      {#if targetType !== 'all'}
        <label class="block">
          <span class="mb-1.5 block text-sm font-medium text-md3-on-surface">
            {targetType === 'directory' ? $t('manage.directoryId') : $t('manage.documentId')}
          </span>
          <input
            class="w-full rounded-lg border border-md3-outline bg-md3-field px-3 py-2.5 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
            placeholder={targetType === 'directory' ? $t('manage.directoryIdPlaceholder') : $t('manage.documentIdPlaceholder')}
            bind:value={targetId}
            disabled={busy}
          />
        </label>
      {/if}
    </section>

    <section class="space-y-3 rounded-lg border border-md3-outline/60 p-3">
      <div class="flex items-start gap-3">
        <MdSwitch
          bind:checked={expiryEnabled}
          disabled={busy}
          ariaLabel={$t('manage.setExpiry')}
        />
        <span>
          <span class="block text-sm font-semibold text-md3-on-surface">{$t('manage.setExpiry')}</span>
          <span class="text-xs text-md3-on-surface-variant">{$t('manage.setExpiryHelp')}</span>
        </span>
      </div>

      {#if expiryEnabled}
        <div class="grid gap-3 sm:grid-cols-2">
          <label>
            <span class="mb-1.5 block text-xs font-medium text-md3-on-surface-variant">{$t('manage.expiryDate')}</span>
            <input
              class="w-full rounded-lg border border-md3-outline bg-md3-field px-3 py-2.5 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
              type="date"
              bind:value={expiryDate}
              disabled={busy}
            />
          </label>
          <label>
            <span class="mb-1.5 block text-xs font-medium text-md3-on-surface-variant">{$t('manage.expiryTime')}</span>
            <input
              class="w-full rounded-lg border border-md3-outline bg-md3-field px-3 py-2.5 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
              type="time"
              bind:value={expiryTime}
              disabled={busy}
            />
          </label>
        </div>
      {/if}
    </section>

    {#if error}
      <div class="flex items-start gap-2 rounded-lg border border-md3-error/35 bg-md3-error-container/25 p-3 text-sm text-md3-on-error-container">
        <Icon name="errorFilled" size="16px" />
        <p class="min-w-0 break-words">{error}</p>
      </div>
    {/if}

    <div class="flex flex-wrap items-center justify-end gap-2 border-t border-md3-outline/60 pt-4">
      <button
        type="button"
        class="rounded-full bg-md3-surface-container-high px-4 py-2 text-sm font-medium text-md3-on-surface-variant transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
        onclick={onClose}
      >
        {$t('common.cancel')}
      </button>
      <button
        type="submit"
        class="inline-flex items-center gap-2 rounded-full bg-md3-error px-4 py-2 text-sm font-medium text-md3-on-error transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
      >
        {#if busy}
          <ProgressRing size={16} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
          {$t('common.saving')}
        {:else}
          <Icon name="block" size="16px" />
          {$t('manage.blockUser')}
        {/if}
      </button>
    </div>
  </form>
</ModalFrame>
