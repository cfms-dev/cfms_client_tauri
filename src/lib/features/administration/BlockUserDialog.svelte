<script lang="ts">
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { _ as t } from 'svelte-i18n';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import MdSwitch from '$lib/shared/ui/MdSwitch.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import type { UserBlockTarget } from '$lib/api';
  import type { IconName } from '$lib/shared/ui/icons';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';

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
      reason: string | null,
    ) => Promise<void>;
    onClose: () => void;
  } = $props();

  let selectedTypes = $state<Set<BlockType>>(new Set(['read', 'write', 'move']));
  let targetType = $state<TargetType>('all');
  let targetId = $state('');
  let expiryEnabled = $state(false);
  let expiryDate = $state(toDateInput(Date.now() + 24 * 60 * 60 * 1000));
  let expiryTime = $state(toTimeInput(Date.now() + 24 * 60 * 60 * 1000));
  let reason = $state('');
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
      await onSave(blockTypes, target, getExpiryTimestamp(), reason || null);
    } catch (err) {
      error = formatUserFacingError(err);
    } finally {
      busy = false;
    }
  }
  const outlinedId = $props.id();
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
          <FluentButton data-fluent-owner="lib-components-block-user-dialog"
            type="button"
            disabled={busy}
            aria-pressed={selectedTypes.has(option.id)}
            onclick={() => toggleType(option.id)}
            appearance="outline"
            class={"flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 " + (selectedTypes.has(option.id)
              ? 'border-md3-primary bg-md3-primary-container text-md3-on-primary-container shadow-lg shadow-md3-primary/10'
              : 'border-md3-outline bg-md3-surface-container-high/40 text-md3-on-surface-variant hover:bg-md3-surface-container-high')}
          >
            <Icon name={option.icon} size="18px" />
            {$t(option.labelKey)}
          </FluentButton>
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
          <FluentButton data-fluent-owner="lib-components-block-user-dialog"
            type="button"
            disabled={busy}
            aria-pressed={targetType === type}
            onclick={() => chooseTarget(type as TargetType)}
            appearance="outline"
            class={"rounded-lg border px-3 py-2.5 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 " + (targetType === type
              ? 'border-md3-primary bg-md3-primary-container text-md3-on-primary-container'
              : 'border-md3-outline bg-md3-surface-container-high/40 text-md3-on-surface-variant hover:bg-md3-surface-container-high')}
          >
            {type === 'all' ? $t('tasks.all') : type === 'directory' ? $t('files.directory') : $t('files.document')}
          </FluentButton>
        {/each}
      </div>

      {#if targetType !== 'all'}
        <div class="block">
          <MdOutlinedField inputId={`${outlinedId}-1`} label={targetType === 'directory' ? $t('manage.directoryId') : $t('manage.documentId')} disabled={busy}>
            <input id={`${outlinedId}-1`} data-focus-ring="delegated"
              class="cfms-native-field w-full px-3 text-sm text-md3-on-surface transition"
              placeholder={targetType === 'directory' ? $t('manage.directoryIdPlaceholder') : $t('manage.documentIdPlaceholder')}
              bind:value={targetId}
              disabled={busy}
            />
          </MdOutlinedField>
        </div>
      {/if}
    </section>

    <div class="grid gap-2 text-sm text-md3-on-surface">
      <MdOutlinedField inputId={`${outlinedId}-2`} label={$t('manage.blockReasonLabel')} disabled={busy}>
        <textarea id={`${outlinedId}-2`} data-focus-ring="delegated"
          bind:value={reason}
          maxlength="1024"
          rows="3"
          placeholder={$t('manage.blockReasonPlaceholder')}
          disabled={busy}
          class="cfms-native-field w-full resize-y px-3 py-2.5 text-sm text-md3-on-surface transition disabled:opacity-50"
        ></textarea>
      </MdOutlinedField>
      <span class="text-xs text-md3-on-surface-variant">
        {$t('manage.blockReasonHelp', { values: { count: 1024 - reason.length } })}
      </span>
    </div>

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
          <div>
            <MdOutlinedField inputId={`${outlinedId}-3`} label={$t('manage.expiryDate')} disabled={busy}>
              <input id={`${outlinedId}-3`} data-focus-ring="delegated"
                class="cfms-native-field w-full px-3 text-sm text-md3-on-surface transition"
                type="date"
                bind:value={expiryDate}
                disabled={busy}
              />
            </MdOutlinedField>
          </div>
          <div>
            <MdOutlinedField inputId={`${outlinedId}-4`} label={$t('manage.expiryTime')} disabled={busy}>
              <input id={`${outlinedId}-4`} data-focus-ring="delegated"
                class="cfms-native-field w-full px-3 text-sm text-md3-on-surface transition"
                type="time"
                bind:value={expiryTime}
                disabled={busy}
              />
            </MdOutlinedField>
          </div>
        </div>
      {/if}
    </section>

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
        variant="danger"
        disabled={busy}
      >
        {#if busy}
          <ProgressRing size={16} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
          {$t('common.saving')}
        {:else}
          <Icon name="block" size="16px" />
          {$t('manage.blockUser')}
        {/if}
      </DialogActionButton>
    </div>
  </form>
</ModalFrame>
