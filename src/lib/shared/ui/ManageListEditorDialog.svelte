<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { onMount } from 'svelte';
  import { untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import type { IconName } from '$lib/shared/ui/icons';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';

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
    return formatUserFacingError(err);
  }
</script>

<ModalFrame
  {title}
  maxWidth="max-w-2xl"
  resizable
  maximizable
  minWidth={480}
  minHeight={420}
  closeLabel={$t('common.close')}
  onClose={onClose}
>
  <div class="flex h-full min-h-0 max-h-[78vh] flex-col">
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
          <FluentButton data-fluent-owner="lib-components-manage-list-editor-dialog"
            type="button"
            title={$t('common.refresh')}
            disabled={loading || saving}
            onclick={refresh}
            appearance="subtle"
            class="rounded p-2 text-md3-on-surface-variant transition-colors hover:bg-md3-surface-container-high hover:text-md3-on-surface disabled:cursor-not-allowed disabled:opacity-45"
            iconOnly
            aria-label={$t('common.refresh')}
          >
            <Icon name="refresh" size="18px" />
          </FluentButton>
        {/if}
      </div>

      <div class="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-md3-on-surface-variant">
            <Icon name="search" size="18px" />
          </span>
          <input
            class="cfms-native-field w-full rounded-lg border border-md3-outline bg-md3-field pl-10 pr-3 text-sm text-md3-on-surface outline-none transition"
            placeholder={$t('manage.searchItems')}
            bind:value={query}
            disabled={loading || saving}
          />
        </div>

        {#if allowAdd}
          <form
            class="flex min-w-0 items-center gap-2"
            onsubmit={(event) => {
              event.preventDefault();
              addCustomItem();
            }}
          >
            <input
              class="cfms-native-field min-w-0 rounded-lg border border-md3-outline bg-md3-field px-3 text-sm text-md3-on-surface outline-none transition"
              placeholder={addPlaceholder}
              bind:value={customValue}
              disabled={loading || saving}
            />
            <FluentButton data-fluent-owner="lib-components-manage-list-editor-dialog"
              type="submit"
              disabled={loading || saving || !customValue.trim()}
              title={$t('common.add')}
              appearance="subtle"
              class="cfms-control-action rounded bg-md3-primary-container text-md3-on-primary-container transition-all disabled:cursor-not-allowed disabled:opacity-45"
              iconOnly
              aria-label={$t('common.add')}
            >
              <Icon name="add" size="18px" />
            </FluentButton>
          </form>
        {/if}
      </div>
    </div>

    <div class="modal-flex-region min-h-[18rem] flex-1 overflow-auto p-5">
      {#if loading}
        <div class="flex items-center justify-center gap-2 py-12 text-sm text-md3-on-surface-variant">
          <ProgressRing size={18} strokeWidth={2.5} label={$t('common.loadingEllipsis')} />
          {$t('common.loadingEllipsis')}
        </div>
      {:else if error}
        <div class="rounded-lg border border-md3-error/35 bg-md3-error-container/20 p-4 text-sm text-md3-on-error-container">
          <div class="flex items-start gap-2">
            <span class="cfms-icon-text__icon"><Icon name="errorFilled" size="18px" /></span>
            <p class="min-w-0 break-words">{error}</p>
          </div>
        </div>
      {:else if visibleItems.length === 0}
        <p class="rounded-lg border border-dashed border-md3-outline px-4 py-10 text-center text-sm text-md3-on-surface-variant">
          {emptyMessage || $t('manage.noItems')}
        </p>
      {:else}
        <div class="cfms-list-rows overflow-hidden rounded-lg border border-md3-outline">
          {#each visibleItems as item (item.id)}
            <FluentButton data-fluent-owner="lib-components-manage-list-editor-dialog"
              type="button"
              disabled={saving}
              aria-pressed={selectedSet.has(item.id)}
              onclick={() => setSelected(item.id, !selectedSet.has(item.id))}
              appearance="subtle"
              shape="square"
              class="cfms-list-row disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span class="grid w-full grid-cols-[auto_1fr] items-start gap-3 px-4 py-3">
                <span
                  class="mt-[-1px] inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors
                         {selectedSet.has(item.id) ? 'text-md3-primary-emphasis' : 'text-md3-on-surface-variant'}"
                  aria-hidden="true"
                >
                  <Icon name={selectedSet.has(item.id) ? 'checkBox' : 'checkBoxBlank'} size="22px" />
                </span>
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
              </span>
            </FluentButton>
          {/each}
        </div>
      {/if}
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 border-t border-md3-outline/60 p-4">
      <DialogActionButton disabled={saving} onclick={onClose}>
        {$t('common.cancel')}
      </DialogActionButton>
      <DialogActionButton
        variant="primary"
        disabled={loading || saving || Boolean(error)}
        onclick={save}
      >
        {#if saving}
          <ProgressRing size={16} strokeWidth={2.4} label={$t('common.saving')} />
          {$t('common.saving')}
        {:else}
          <Icon name="done" size="16px" />
          {saveLabel || $t('common.save')}
        {/if}
      </DialogActionButton>
    </div>
  </div>
</ModalFrame>
