<script lang="ts">
  import type { IconName } from '$lib/icons';
  import type { FileRecord } from '$lib/file-preferences';
  import Icon from '$lib/components/Icon.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';
  import { flyScale, staggeredList } from '$lib/motion/transitions';

  interface Props {
    title: string;
    icon: IconName;
    iconClass?: string;
    records: FileRecord[];
    loading?: boolean;
    emptyLabel: string;
    loadingLabel: string;
    clearLabel: string;
    removeLabel: string;
    openingId: string | null;
    meta: (record: FileRecord) => string;
    unavailableLabel: string;
    isUnavailable?: (record: FileRecord) => boolean;
    onOpen: (record: FileRecord) => void | Promise<void>;
    onRemove: (record: FileRecord) => void | Promise<void>;
    onClear: () => void | Promise<void>;
  }

  let {
    title,
    icon,
    iconClass = 'text-cyan-200',
    records,
    loading = false,
    emptyLabel,
    loadingLabel,
    clearLabel,
    removeLabel,
    openingId,
    meta,
    unavailableLabel,
    isUnavailable = () => false,
    onOpen,
    onRemove,
    onClear,
  }: Props = $props();

  function recordKey(record: FileRecord) {
    return `${record.type}:${record.id}`;
  }
</script>

<section class="blueprint-panel min-w-0 overflow-hidden">
  <div class="flex items-center gap-2.5 px-4 pt-4">
    <div class="flex min-w-0 flex-1 items-center gap-2.5">
      <span class="blueprint-panel-icon {iconClass}">
        <Icon name={icon} size="20px" />
      </span>
      <h2 class="truncate text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-serif);">
        {title}
      </h2>
    </div>
    {#if records.length > 0}
      <IconButton icon="playlistRemove" label={clearLabel} tone="danger" size={19} onclick={onClear} />
    {/if}
  </div>

  {#if loading}
    <div class="flex items-center gap-2 px-4 py-8 text-sm text-md3-on-surface-variant">
      <ProgressRing size={18} strokeWidth={2.5} label={loadingLabel} />
      {loadingLabel}
    </div>
  {:else if records.length === 0}
    <p class="px-4 py-8 text-center text-sm text-md3-on-surface-variant">
      {emptyLabel}
    </p>
  {:else}
    <div class="blueprint-record-list grid gap-1.5 px-4 pb-3 pt-3">
      {#each records as item, index (recordKey(item))}
        {@const unavailable = isUnavailable(item)}
        <div
          class="blueprint-record-shell grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1"
          in:flyScale={staggeredList(index, { y: 8, duration: 260, step: 28 })}
        >
          <button
            type="button"
            class="blueprint-record-row grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2.5 text-left transition disabled:cursor-not-allowed"
            class:blueprint-record-row--unavailable={unavailable}
            disabled={openingId === recordKey(item) || unavailable}
            onclick={() => onOpen(item)}
          >
            <span class={item.type === 'directory' ? 'text-cyan-200' : 'text-md3-on-surface-variant'}>
              <Icon name={item.type === 'directory' ? 'folder' : 'filePresent'} size="22px" />
            </span>
            <span class="min-w-0">
              <span class="record-title block truncate text-sm font-medium text-md3-on-surface">{item.name}</span>
              <span class="mt-0.5 block truncate text-xs text-md3-on-surface-variant">
                {unavailable ? unavailableLabel : meta(item)}
              </span>
            </span>
            <span class="text-md3-on-surface-variant">
              {#if openingId === recordKey(item)}
                <ProgressRing size={16} strokeWidth={2.4} label={loadingLabel} />
              {:else}
                <Icon name={item.type === 'directory' ? 'folderOpen' : 'download'} size="18px" />
              {/if}
            </span>
          </button>
          <IconButton icon="close" label={removeLabel} size={18} onclick={() => onRemove(item)} />
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .blueprint-panel {
    position: relative;
  }

  .blueprint-record-list {
    max-height: min(42vh, 24rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .blueprint-panel-icon {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
  }

  .blueprint-record-row {
    position: relative;
    z-index: 1;
  }

  .blueprint-record-row:hover {
    opacity: 0.86;
  }

  .blueprint-record-row--unavailable {
    opacity: 0.48;
    filter: grayscale(1);
  }

  .blueprint-record-row--unavailable :global(.material-symbols-rounded) {
    color: var(--color-md3-outline);
  }

  .blueprint-record-row--unavailable .record-title {
    text-decoration: line-through;
  }
</style>
