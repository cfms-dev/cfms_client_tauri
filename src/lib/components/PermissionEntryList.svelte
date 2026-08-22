<script lang="ts">
  import { tick } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { PermissionEntry } from '$lib/api';
  import {
    permissionEntryMatchesFilter,
    type PermissionEntryChangeKind,
    type PermissionEntryFilter,
    type PermissionEntryState,
  } from '$lib/permission-entries';
  import Icon from './Icon.svelte';

  interface EntryListRow {
    key: string;
    entry: PermissionEntry;
    state: PermissionEntryState;
    change: PermissionEntryChangeKind;
    valid: boolean;
  }

  let {
    rows,
    selectedKey,
    query,
    filter,
    filterCounts,
    disabled = false,
    onQueryChange,
    onFilterChange,
    onSelect,
    onVisibleKeysChange,
    onAdd,
    onDelete,
    onUndo,
  }: {
    rows: EntryListRow[];
    selectedKey: string | null;
    query: string;
    filter: PermissionEntryFilter;
    filterCounts: Record<PermissionEntryFilter, number>;
    disabled?: boolean;
    onQueryChange: (value: string) => void;
    onFilterChange: (value: PermissionEntryFilter) => void;
    onSelect: (key: string, revealEditor?: boolean) => void;
    onVisibleKeysChange: (keys: string[]) => void;
    onAdd: () => void;
    onDelete: (key: string) => void;
    onUndo: (key: string) => void;
  } = $props();

  const filters: Array<{ value: PermissionEntryFilter; label: string }> = [
    { value: 'all', label: 'manage.permissionFilterAll' },
    { value: 'active', label: 'manage.permissionState.active' },
    { value: 'scheduled', label: 'manage.permissionState.scheduled' },
    { value: 'expired', label: 'manage.permissionState.expired' },
    { value: 'changed', label: 'manage.permissionFilterChanged' },
  ];

  const visibleRows = $derived.by(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      if (!permissionEntryMatchesFilter(row.state, row.change, filter)) return false;
      if (!needle) return true;
      return [
        row.entry.permission,
        row.entry.granted ? $t('manage.permissionGrant') : $t('manage.permissionRevoke'),
        $t(`manage.permissionState.${row.state}`),
        row.change === 'unchanged' ? '' : $t(`manage.permissionChange.${row.change}`),
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  });

  $effect(() => {
    onVisibleKeysChange(visibleRows.map((row) => row.key));
  });

  function stateClass(state: PermissionEntryState): string {
    if (state === 'active') return 'entry-state--active';
    if (state === 'scheduled') return 'entry-state--scheduled';
    return 'entry-state--expired';
  }

  function formatTimestamp(timestamp: number): string {
    if (!Number.isFinite(timestamp)) return $t('manage.permissionInvalidTimeShort');
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp * 1000));
  }

  function timeSummary(entry: PermissionEntry): string {
    if (!Number.isFinite(entry.start_time)) return $t('manage.permissionInvalidTimeShort');
    if (entry.end_time === null) {
      return $t('manage.permissionTimeSummaryOpen', {
        values: { start: formatTimestamp(entry.start_time) },
      });
    }
    return $t('manage.permissionTimeSummaryRange', {
      values: {
        start: formatTimestamp(entry.start_time),
        end: formatTimestamp(entry.end_time),
      },
    });
  }

  async function moveFocus(event: KeyboardEvent, currentKey: string) {
    const currentIndex = visibleRows.findIndex((row) => row.key === currentKey);
    if (currentIndex < 0 || visibleRows.length < 2) return;

    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = Math.min(visibleRows.length - 1, currentIndex + 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = visibleRows.length - 1;
    else return;

    event.preventDefault();
    const next = visibleRows[nextIndex];
    onSelect(next.key, false);
    await tick();
    document.getElementById(`permission-entry-select-${next.key}`)?.focus();
  }
</script>

<section class="entry-list-pane" aria-labelledby="permission-rule-list-title">
  <div class="entry-list-toolbar">
    <div>
      <h3 id="permission-rule-list-title">{$t('manage.directPermissionRules')}</h3>
      <p>{$t('manage.directPermissionRulesDescription')}</p>
    </div>
    <button
      type="button"
      class="add-entry-button"
      disabled={disabled}
      onclick={onAdd}
    >
      <Icon name="add" size="17px" />
      <span>{$t('manage.addPermissionEntry')}</span>
    </button>
  </div>

  <div class="search-field">
    <Icon name="search" size="18px" />
    <input
      value={query}
      data-focus-ring="delegated"
      aria-label={$t('manage.searchPermissionEntries')}
      placeholder={$t('manage.searchPermissionEntries')}
      disabled={disabled}
      oninput={(event) => onQueryChange(event.currentTarget.value)}
    />
    {#if query}
      <button
        type="button"
        aria-label={$t('manage.clearPermissionSearch')}
        disabled={disabled}
        onclick={() => onQueryChange('')}
      >
        <Icon name="close" size="16px" />
      </button>
    {/if}
  </div>

  <div class="entry-filters" role="group" aria-label={$t('manage.filterPermissionEntries')}>
    {#each filters as item (item.value)}
      <button
        type="button"
        aria-pressed={filter === item.value}
        class:active={filter === item.value}
        disabled={disabled}
        onclick={() => onFilterChange(item.value)}
      >
        <span>{$t(item.label)}</span>
        <span class="filter-count">{filterCounts[item.value]}</span>
      </button>
    {/each}
  </div>

  <div class="entry-list-scroll modal-flex-region">
    {#if visibleRows.length === 0}
      <div class="entry-empty">
        <Icon name={query ? 'search' : 'rule'} size="26px" />
        <p>{query
          ? $t('manage.noPermissionEntryMatches')
          : filter === 'all'
            ? $t('manage.noPermissionEntries')
            : $t('manage.noPermissionEntriesInFilter')}</p>
        {#if !query && rows.length === 0}
          <button type="button" disabled={disabled} onclick={onAdd}>
            {$t('manage.addPermissionEntry')}
          </button>
        {/if}
      </div>
    {:else}
      <ul class="entry-list" aria-label={$t('manage.directPermissionRules')}>
        {#each visibleRows as row (row.key)}
          <li
            class="entry-row"
            class:selected={selectedKey === row.key}
            class:deleted={row.change === 'deleted'}
            class:invalid={!row.valid && row.change !== 'deleted'}
          >
            <button
              id={`permission-entry-select-${row.key}`}
              type="button"
              class="entry-select"
              aria-pressed={selectedKey === row.key}
              aria-label={$t('manage.selectPermissionEntry', { values: { permission: row.entry.permission || $t('manage.unnamedPermissionEntry') } })}
              disabled={disabled}
              onclick={() => onSelect(row.key, true)}
              onkeydown={(event) => moveFocus(event, row.key)}
            >
              <span class="entry-title-line">
                <strong>{row.entry.permission || $t('manage.unnamedPermissionEntry')}</strong>
                <span class:grant={row.entry.granted} class:revoke={!row.entry.granted} class="effect-chip">
                  {row.entry.granted ? $t('manage.permissionGrant') : $t('manage.permissionRevoke')}
                </span>
              </span>
              <span class="entry-meta-line">
                <span class={`state-chip ${stateClass(row.state)}`}>
                  {$t(`manage.permissionState.${row.state}`)}
                </span>
                {#if row.change !== 'unchanged'}
                  <span class={`change-chip change-chip--${row.change}`}>
                    {$t(`manage.permissionChange.${row.change}`)}
                  </span>
                {/if}
                {#if !row.valid && row.change !== 'deleted'}
                  <span class="invalid-label">
                    <Icon name="errorFilled" size="13px" />
                    {$t('manage.permissionNeedsAttention')}
                  </span>
                {/if}
              </span>
              <span class="entry-time">{timeSummary(row.entry)}</span>
            </button>
            <div class="entry-actions">
              {#if row.change === 'deleted' || row.change === 'modified'}
                <button
                  type="button"
                  class="undo-action"
                  aria-label={row.change === 'deleted'
                    ? $t('manage.undoDeletePermissionEntry')
                    : $t('manage.undoPermissionEntryChanges')}
                  title={row.change === 'deleted'
                    ? $t('manage.undoDeletePermissionEntry')
                    : $t('manage.undoPermissionEntryChanges')}
                  disabled={disabled}
                  onclick={() => onUndo(row.key)}
                >
                  <Icon name="undo" size="18px" />
                </button>
              {/if}
              {#if row.change !== 'deleted'}
                <button
                  type="button"
                  class="delete-action"
                  aria-label={$t('manage.deletePermissionEntry')}
                  title={$t('manage.deletePermissionEntry')}
                  disabled={disabled}
                  onclick={() => onDelete(row.key)}
                >
                  <Icon name="delete" size="18px" />
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .entry-list-pane {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    border-right: 1px solid var(--color-md3-outline);
    background: color-mix(in srgb, var(--color-md3-surface-container) 84%, transparent);
  }

  .entry-list-toolbar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1rem 0.75rem;
  }

  h3 {
    margin: 0;
    color: var(--color-md3-on-surface);
    font: 650 0.875rem/1.3 var(--font-md3-sans);
  }

  .entry-list-toolbar p {
    margin: 0.2rem 0 0;
    color: var(--color-md3-on-surface-variant);
    font: 400 0.72rem/1.45 var(--font-md3-sans);
  }

  .add-entry-button {
    display: inline-flex;
    min-height: 2rem;
    flex: none;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-small, 6px);
    padding: 0.3rem 0.65rem;
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
    font: 600 0.75rem/1.2 var(--font-md3-sans);
    transition: background-color 100ms ease, transform 120ms cubic-bezier(0.2, 0, 0, 1);
  }

  .add-entry-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-md3-primary-container) 80%, white 20%);
  }

  .add-entry-button:active:not(:disabled) { transform: scale(0.97); }
  button:disabled { cursor: not-allowed; opacity: 0.45; }

  .search-field {
    display: grid;
    min-height: 2.625rem;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
    margin: 0 1rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--explorer-radius-medium, 8px);
    padding: 0 0.7rem;
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-field);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .search-field:focus-within {
    border-color: var(--color-md3-primary);
    box-shadow: inset 0 0 0 1px var(--color-md3-primary);
  }

  .search-field input,
  .search-field input:focus {
    min-width: 0;
    border: 0 !important;
    outline: 0;
    color: var(--color-md3-on-surface);
    background: transparent;
    box-shadow: none !important;
    font: 400 0.8rem/1.4 var(--font-md3-sans);
  }

  .search-field input::placeholder { color: var(--color-md3-on-surface-variant); opacity: 0.9; }

  .search-field button {
    display: grid;
    width: 1.75rem;
    height: 1.75rem;
    place-items: center;
    border-radius: var(--explorer-radius-small, 6px);
    color: var(--color-md3-on-surface-variant);
  }

  .search-field button:hover:not(:disabled) { background: var(--color-md3-surface-container-highest); }

  .entry-filters {
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
    padding: 0.65rem 1rem 0.75rem;
    scrollbar-width: thin;
  }

  .entry-filters button {
    display: inline-flex;
    min-height: 1.8rem;
    flex: none;
    align-items: center;
    gap: 0.3rem;
    border: 1px solid transparent;
    border-radius: var(--explorer-radius-small, 6px);
    padding: 0.25rem 0.45rem;
    color: var(--color-md3-on-surface-variant);
    font: 600 0.69rem/1.2 var(--font-md3-sans);
    transition: color 100ms ease, background-color 100ms ease, border-color 100ms ease;
  }

  .entry-filters button:hover:not(:disabled) {
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-high);
  }

  .entry-filters button.active {
    border-color: color-mix(in srgb, var(--color-md3-primary) 40%, transparent);
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  .filter-count {
    min-width: 1.15rem;
    border-radius: 9999px;
    padding: 0.08rem 0.3rem;
    text-align: center;
    background: color-mix(in srgb, currentColor 10%, transparent);
    font-variant-numeric: tabular-nums;
  }

  .entry-list-scroll {
    min-height: 12rem;
    flex: 1;
    overflow: auto;
    border-top: 1px solid color-mix(in srgb, var(--color-md3-outline) 65%, transparent);
  }

  .entry-list { margin: 0; padding: 0; list-style: none; }

  .entry-row {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    border-bottom: 1px solid color-mix(in srgb, var(--color-md3-outline) 58%, transparent);
    background: transparent;
    transition: background-color 150ms cubic-bezier(0.2, 0, 0, 1), box-shadow 150ms cubic-bezier(0.2, 0, 0, 1);
  }

  .entry-row.selected {
    background: color-mix(in srgb, var(--color-md3-primary-container) 55%, transparent);
    box-shadow: inset 3px 0 0 var(--color-md3-primary);
  }

  .entry-row.deleted { opacity: 0.68; }
  .entry-row.invalid { background: color-mix(in srgb, var(--color-md3-error-container) 38%, transparent); }

  .entry-select {
    min-width: 0;
    padding: 0.75rem 0.65rem 0.75rem 1rem;
    text-align: left;
    color: inherit;
  }

  .entry-select:focus-visible {
    z-index: 1;
    outline: 2px solid var(--color-md3-primary);
    outline-offset: -2px;
  }

  .entry-title-line,
  .entry-meta-line {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .entry-title-line strong {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--color-md3-on-surface);
    font: 600 0.8rem/1.35 var(--font-md3-sans);
  }

  .deleted .entry-title-line strong { text-decoration: line-through; }
  .entry-meta-line { margin-top: 0.38rem; }

  .effect-chip,
  .state-chip,
  .change-chip {
    border-radius: 9999px;
    padding: 0.12rem 0.4rem;
    font: 600 0.64rem/1.35 var(--font-md3-sans);
    white-space: nowrap;
  }

  .effect-chip.grant,
  .entry-state--active {
    color: var(--color-md3-on-primary-container);
    background: var(--color-md3-primary-container);
  }

  .effect-chip.revoke {
    color: var(--color-md3-on-error-container);
    background: var(--color-md3-error-container);
  }

  .entry-state--scheduled {
    color: var(--color-md3-on-surface);
    background: var(--color-md3-surface-container-highest);
  }

  .entry-state--expired {
    color: var(--color-md3-on-surface-variant);
    background: var(--color-md3-surface-container-high);
  }

  .change-chip { color: var(--color-md3-primary-emphasis); background: transparent; }
  .change-chip--deleted { color: var(--color-md3-error); }

  .invalid-label {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    color: var(--color-md3-error);
    font: 600 0.65rem/1.3 var(--font-md3-sans);
  }

  .entry-time {
    display: block;
    margin-top: 0.35rem;
    overflow: hidden;
    color: var(--color-md3-on-surface-variant);
    font: 400 0.69rem/1.45 var(--font-md3-sans);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-actions {
    display: flex;
    align-items: center;
    gap: 0.1rem;
    padding-right: 0.55rem;
  }

  .delete-action,
  .undo-action {
    display: grid;
    align-self: center;
    width: 2rem;
    height: 2rem;
    place-items: center;
    border-radius: 9999px;
    transition: background-color 100ms ease, transform 120ms cubic-bezier(0.2, 0, 0, 1);
  }

  .delete-action { color: var(--color-md3-error); }
  .undo-action { color: var(--color-md3-primary-emphasis); }
  .delete-action:hover:not(:disabled) { background: var(--color-md3-error-container); }
  .undo-action:hover:not(:disabled) { background: var(--color-md3-primary-container); }
  .delete-action:active:not(:disabled), .undo-action:active:not(:disabled) { transform: scale(0.93); }

  .entry-empty {
    display: grid;
    min-height: 14rem;
    place-items: center;
    align-content: center;
    gap: 0.55rem;
    padding: 1.5rem;
    color: var(--color-md3-on-surface-variant);
    text-align: center;
  }

  .entry-empty p { max-width: 30ch; margin: 0; font: 400 0.78rem/1.5 var(--font-md3-sans); }
  .entry-empty button { color: var(--color-md3-primary-emphasis); font: 600 0.76rem/1.3 var(--font-md3-sans); }

  @media (max-width: 719px) {
    .entry-list-pane {
      width: 100%;
      max-width: 100%;
      min-height: 20rem;
      border-right: 0;
      border-bottom: 1px solid var(--color-md3-outline);
    }

    .entry-filters {
      flex-wrap: wrap;
      overflow: visible;
    }
  }

  @media (pointer: coarse) {
    .add-entry-button,
    .entry-filters button { min-height: 2.5rem; }
    .delete-action,
    .undo-action { width: 2.75rem; height: 2.75rem; }
    .entry-select { min-height: 4.25rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    .add-entry-button,
    .entry-row,
    .delete-action,
    .undo-action { transition: none; }
  }
</style>
