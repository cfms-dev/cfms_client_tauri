<script lang="ts">
  import type { IconName } from '$lib/icons';
  import type { FileRecord } from '$lib/file-preferences';
  import Icon from '$lib/components/Icon.svelte';
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
    openingId: string | null;
    meta: (record: FileRecord) => string;
    onOpen: (record: FileRecord) => void | Promise<void>;
  }

  let {
    title,
    icon,
    iconClass = 'text-cyan-200',
    records,
    loading = false,
    emptyLabel,
    loadingLabel,
    openingId,
    meta,
    onOpen,
  }: Props = $props();

  function recordKey(record: FileRecord) {
    return `${record.type}:${record.id}`;
  }
</script>

<section class="blueprint-panel min-w-0 overflow-hidden">
  <div class="flex items-center gap-3 px-5 pt-5">
    <span class="blueprint-panel-icon {iconClass}">
      <Icon name={icon} size="20px" />
    </span>
    <h2 class="text-sm font-semibold text-md3-on-surface" style="font-family: var(--font-md3-sans);">
      {title}
    </h2>
  </div>

  {#if loading}
    <div class="flex items-center gap-2 px-5 py-10 text-sm text-md3-on-surface-variant">
      <ProgressRing size={18} strokeWidth={2.5} label={loadingLabel} />
      {loadingLabel}
    </div>
  {:else if records.length === 0}
    <p class="px-5 py-10 text-center text-sm text-md3-on-surface-variant">
      {emptyLabel}
    </p>
  {:else}
    <div class="grid gap-2 p-3">
      {#each records as item, index (recordKey(item))}
        <button
          type="button"
          class="blueprint-record-row grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3.5 py-3 text-left transition disabled:cursor-wait disabled:opacity-70"
          disabled={openingId === recordKey(item)}
          onclick={() => onOpen(item)}
          in:flyScale={staggeredList(index, { y: 8, duration: 260, step: 28 })}
        >
          <span class={item.type === 'directory' ? 'text-cyan-200' : 'text-md3-on-surface-variant'}>
            <Icon name={item.type === 'directory' ? 'folder' : 'filePresent'} size="22px" />
          </span>
          <span class="min-w-0">
            <span class="block truncate text-sm font-medium text-md3-on-surface">{item.name}</span>
            <span class="mt-0.5 block truncate text-xs text-md3-on-surface-variant">
              {meta(item)}
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
      {/each}
    </div>
  {/if}
</section>

<style>
  .blueprint-panel {
    position: relative;
    border-radius: 20px;
    background:
      linear-gradient(135deg, rgba(15, 23, 42, 0.7), rgba(8, 47, 73, 0.34)),
      rgba(15, 23, 42, 0.62);
  }

  .blueprint-panel::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    background-image:
      linear-gradient(rgba(125, 211, 252, 0.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(125, 211, 252, 0.06) 1px, transparent 1px);
    background-size: 28px 28px;
    mask-image: linear-gradient(180deg, black, transparent 82%);
  }

  .blueprint-panel-icon {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 9999px;
    background: rgba(8, 47, 73, 0.48);
  }

  .blueprint-record-row {
    position: relative;
    z-index: 1;
    border-radius: 14px;
    background: rgba(15, 23, 42, 0.38);
  }

  .blueprint-record-row:hover {
    background: rgba(30, 41, 59, 0.58);
  }
</style>
