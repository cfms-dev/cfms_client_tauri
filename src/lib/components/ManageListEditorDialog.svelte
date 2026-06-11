<script lang="ts">
  import { onMount } from 'svelte';
  import { untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import Icon from '$lib/components/Icon.svelte';
  import ModalFrame from '$lib/components/ModalFrame.svelte';
  import type { IconName } from '$lib/icons';

  interface EditorItem {
    id: string;
    label?: string;
    meta?: string;
  }

  interface EditorData {
    items: EditorItem[];
    selected: string[];
  }

  let {
    title,
    description,
    icon = 'checklist',
    items = [],
    selected = [],
    allowAdd = false,
    addPlaceholder = '',
    emptyMessage = '',
    saveLabel,
    onRefresh,
    onSave,
    onClose,
  }: {
    title: string;
    description: string;
    icon?: IconName;
    items?: EditorItem[];
    selected?: string[];
    allowAdd?: boolean;
    addPlaceholder?: string;
    emptyMessage?: string;
    saveLabel?: string;
    onRefresh?: () => Promise<EditorData>;
    onSave: (selected: string[]) => Promise<void>;
    onClose: () => void;
  } = $props();

  let localItems = $state<EditorItem[]>(untrack(() => items));
  let selectedSet = $state<Set<string>>(new Set(untrack(() => selected)));
  let customValue = $state('');
  let query = $state('');
  let loading = $state(false);
  let saving = $state(false);
  let error = $state<string | null>(null);

  const allItems = $derived.by(() => {
    const known = new Map(localItems.map((item) => [item.id, item]));
    const extras: EditorItem[] = [...selectedSet]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, label: id }));

    return [...localItems, ...extras].sort((a, b) =>
      displayLabel(a).localeCompare(displayLabel(b)),
    );
  });
  const visibleItems = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return allItems;

    return allItems.filter((item) =>
      [item.id, item.label, item.meta]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  });
  const selectedCount = $derived(selectedSet.size);

  onMount(() => {
    if (onRefresh) void refresh();
  });

  function displayLabel(item: EditorItem) {
    return item.label || item.id;
  }

  function setSelected(id: string, checked: boolean) {
    const next = new Set(selectedSet);
    if (checked) next.add(id);
    else next.delete(id);
    selectedSet = next;
  }

  function addCustomItem() {
    const id = customValue.trim();
    if (!id) return;

    if (!localItems.some((item) => item.id === id)) {
      localItems = [...localItems, { id, label: id }];
    }

    setSelected(id, true);
    customValue = '';
  }

  async function refresh() {
    if (!onRefresh) return;

    loading = true;
    error = null;
    try {
      const data = await onRefresh();
      localItems = data.items;
      selectedSet = new Set(data.selected);
    } catch (err) {
      error = formatError(err);
    } finally {
      loading = false;
    }
  }

  async function save() {
    saving = true;
    error = null;
    try {
      await onSave([...selectedSet].sort());
    } catch (err) {
      error = formatError(err);
    } finally {
      saving = false;
    }
  }

  function formatError(err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
</script>

<ModalFrame {title} maxWidth="max-w-2xl" closeLabel={$t('common.close')} onClose={onClose}>
  <div class="flex max-h-[78vh] flex-col">
    <div class="space-y-4 border-b border-md3-outline/60 p-5">
      <div class="flex items-start gap-3">
        <span class="rounded-lg bg-md3-primary-container/70 p-2 text-md3-primary-emphasis">
          <Icon name={icon} size="22px" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm text-md3-on-surface-variant">{description}</p>
          <p class="mt-1 text-xs text-md3-on-surface-variant">
            {$t('manage.selectedCount', { values: { count: selectedCount } })}
          </p>
        </div>
        {#if onRefresh}
          <button
            type="button"
            class="rounded-full p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface disabled:cursor-not-allowed disabled:opacity-45"
            title={$t('common.refresh')}
            disabled={loading || saving}
            onclick={refresh}
          >
            <Icon name="refresh" size="18px" />
          </button>
        {/if}
      </div>

      <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name="search" size="18px" />
          </span>
          <input
            class="w-full rounded-lg border border-md3-outline bg-md3-field py-2.5 pl-10 pr-3 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
            placeholder={$t('manage.searchItems')}
            bind:value={query}
            disabled={loading || saving}
          />
        </div>

        {#if allowAdd}
          <form
            class="flex min-w-0 gap-2"
            onsubmit={(event) => {
              event.preventDefault();
              addCustomItem();
            }}
          >
            <input
              class="min-w-0 rounded-lg border border-md3-outline bg-md3-field px-3 py-2.5 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/30"
              placeholder={addPlaceholder}
              bind:value={customValue}
              disabled={loading || saving}
            />
            <button
              type="submit"
              class="rounded-full bg-md3-primary-container p-2.5 text-md3-on-primary-container transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={loading || saving || !customValue.trim()}
              title={$t('common.add')}
            >
              <Icon name="add" size="18px" />
            </button>
          </form>
        {/if}
      </div>
    </div>

    <div class="min-h-[18rem] overflow-auto p-5">
      {#if loading}
        <div class="flex items-center justify-center gap-2 py-12 text-sm text-md3-on-surface-variant">
          <span class="animate-spin"><Icon name="refresh" size="18px" /></span>
          {$t('common.loadingEllipsis')}
        </div>
      {:else if error}
        <div class="rounded-lg border border-md3-error/35 bg-md3-error-container/20 p-4 text-sm text-md3-on-error-container">
          <div class="flex items-start gap-2">
            <Icon name="errorFilled" size="18px" />
            <p class="min-w-0 break-words">{error}</p>
          </div>
        </div>
      {:else if visibleItems.length === 0}
        <p class="rounded-lg border border-dashed border-md3-outline px-4 py-10 text-center text-sm text-md3-on-surface-variant">
          {emptyMessage || $t('manage.noItems')}
        </p>
      {:else}
        <div class="overflow-hidden rounded-lg border border-md3-outline">
          {#each visibleItems as item (item.id)}
            <label
              class="grid cursor-pointer grid-cols-[auto_1fr] items-start gap-3 border-b border-md3-outline/50 px-4 py-3 transition-colors hover:bg-md3-primary-container/15 last:border-b-0"
            >
              <input
                type="checkbox"
                class="mt-1 h-4 w-4 accent-md3-primary"
                checked={selectedSet.has(item.id)}
                disabled={saving}
                onchange={(event) => setSelected(item.id, event.currentTarget.checked)}
              />
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-md3-on-surface">
                  {displayLabel(item)}
                </span>
                {#if item.meta || item.id !== displayLabel(item)}
                  <span class="mt-0.5 block truncate text-xs text-md3-on-surface-variant">
                    {item.meta || item.id}
                  </span>
                {/if}
              </span>
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 border-t border-md3-outline/60 p-4">
      <button
        type="button"
        class="rounded-full bg-md3-surface-container-high px-4 py-2 text-sm font-medium text-md3-on-surface-variant transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={saving}
        onclick={onClose}
      >
        {$t('common.cancel')}
      </button>
      <button
        type="button"
        class="inline-flex items-center gap-2 rounded-full bg-md3-primary px-4 py-2 text-sm font-medium text-md3-on-primary transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={loading || saving || Boolean(error)}
        onclick={save}
      >
        {#if saving}
          <span class="animate-spin"><Icon name="refresh" size="16px" /></span>
          {$t('common.saving')}
        {:else}
          <Icon name="done" size="16px" />
          {saveLabel || $t('common.save')}
        {/if}
      </button>
    </div>
  </div>
</ModalFrame>
