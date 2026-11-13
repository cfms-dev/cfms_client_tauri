<script lang="ts">
  import { tick } from 'svelte';
  import FluentButton from './FluentButton.svelte';
  import Icon from './Icon.svelte';
  import { normalizeFilterOptions, type FilterOptionLabels } from './multi-select-filter';
  interface Props {
    labels: FilterOptionLabels;
    availableOptions: readonly string[];
    selectedOptions: readonly string[];
    allowCustom?: boolean;
    onToggle: (value: string) => void;
    onAdd: (value: string) => void;
  }
  let { labels, availableOptions, selectedOptions, allowCustom = false, onToggle, onAdd }: Props = $props();
  let query = $state('');
  let queryInput = $state<HTMLInputElement | null>(null);
  let listElement = $state<HTMLDivElement | null>(null);
  const normalizedAvailableOptions = $derived(normalizeFilterOptions([...availableOptions, ...selectedOptions]));
  const trimmedQuery = $derived(query.trim());
  const filteredOptions = $derived(normalizedAvailableOptions.filter((option) => option.toLocaleLowerCase().includes(trimmedQuery.toLocaleLowerCase())));
  const customActionAvailable = $derived(allowCustom && Boolean(trimmedQuery) && !normalizedAvailableOptions.includes(trimmedQuery));
  function addQueryAction() {
    if (!allowCustom || !trimmedQuery) return;
    onAdd(trimmedQuery);
    query = '';
    void tick().then(() => queryInput?.focus({ preventScroll: true }));
  }
  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      listElement?.querySelector<HTMLButtonElement>('[role="option"]')?.focus();
    } else if (event.key === 'Enter' && trimmedQuery) {
      event.preventDefault();
      addQueryAction();
    }
  }
  function handleListKeydown(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = Array.from(listElement?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next]?.focus();
    event.preventDefault();
  }
</script>
      <div class="filter-search cfms-input-composite cfms-field-surface">
        <Icon name="search" size="18px" />
        <input class="cfms-native-field"
          bind:this={queryInput}
          bind:value={query}
          type="text"
          data-focus-ring="delegated"
          autocomplete="off"
          aria-label={labels.search}
          placeholder={labels.searchPlaceholder}
          onkeydown={handleInputKeydown}
        />
        {#if query}
          <span class="cfms-input-composite__end">
            <FluentButton data-fluent-owner="shared-multi-select-filter"
              type="button"
              aria-label={labels.clearSearch}
              onclick={() => {
                query = '';
                queryInput?.focus({ preventScroll: true });
              }}
              appearance="subtle"
              class="cfms-control-action"
              iconOnly
            >
              <Icon name="close" size="15px" />
            </FluentButton>
          </span>
        {/if}
      </div>

      <div bind:this={listElement} onkeydown={handleListKeydown} class="filter-options" role="listbox" tabindex="-1" aria-multiselectable="true" aria-label={labels.options}>
        {#if customActionAvailable}
          <button data-fluent-owner="shared-multi-select-filter"
            type="button"
            class="filter-option filter-option--custom"
            role="option"
            aria-selected="false"
            onclick={addQueryAction}
          >
            <span class="filter-option__icon"><Icon name="add" size="17px" /></span>
            <span class="filter-option__content">
              <span>{labels.addCustom}</span>
              <code>{trimmedQuery}</code>
            </span>
          </button>
        {/if}

        {#each filteredOptions as action (action)}
          <button data-fluent-owner="shared-multi-select-filter"
            type="button"
            class="filter-option"
            class:filter-option--selected={selectedOptions.includes(action)}
            role="option"
            aria-selected={selectedOptions.includes(action)}
            onclick={() => onToggle(action)}
          >
            <span class="filter-option__icon">
              <Icon name={selectedOptions.includes(action) ? 'checkBox' : 'checkBoxBlank'} size="18px" />
            </span>
            <code>{action}</code>
          </button>
        {:else}
          {#if !customActionAvailable}
            <div class="filter-empty">
              <Icon name={trimmedQuery ? 'search' : 'filterList'} size="22px" />
              <p>{trimmedQuery ? labels.noMatches : labels.noSuggestions}</p>
            </div>
          {/if}
        {/each}
      </div>
