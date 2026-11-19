<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import FluentButton from './FluentButton.svelte';
  import Icon from './Icon.svelte';
  import FilterPopover from './FilterPopover.svelte';
  import MultiSelectOptions from './MultiSelectOptions.svelte';
  import { normalizeFilterOptions, type FilterLabels } from './multi-select-filter';
  interface Props {
    labels: FilterLabels;
    allowCustom?: boolean;
    availableOptions: readonly string[];
    selectedOptions: readonly string[];
    disabled?: boolean;
    onApply: (filters: string[]) => void | Promise<void>;
  }
  let { labels, allowCustom = false, availableOptions, selectedOptions, disabled = false, onApply }: Props = $props();
  let draftOptions = $state<string[]>([]);
  let editorRevision = $state(0);
  const draftChanged = $derived(JSON.stringify(normalizeFilterOptions(draftOptions)) !== JSON.stringify(normalizeFilterOptions(selectedOptions)));
  function addOption(value: string) { draftOptions = normalizeFilterOptions([...draftOptions, value]); }
</script>

<FilterPopover {labels} {disabled} count={selectedOptions.length} onOpen={() => { draftOptions = normalizeFilterOptions(selectedOptions); }}>
  {#key editorRevision}
    <MultiSelectOptions {labels} {allowCustom} availableOptions={[...availableOptions, ...selectedOptions]} selectedOptions={draftOptions}
      onAdd={addOption} onToggle={(value) => draftOptions.includes(value) ? draftOptions = draftOptions.filter((option) => option !== value) : addOption(value)} />
  {/key}
  {#snippet footer(close)}
      <footer class="filter-panel__footer">
        <div class="filter-panel__selection">
          <FluentButton data-fluent-owner="shared-multi-select-filter"
            type="button"
            disabled={draftOptions.length === 0}
            aria-label={$t('common.clear')}
            title={$t('common.clear')}
            onclick={() => {
              draftOptions = [];
              editorRevision += 1;
            }}
            appearance="subtle"
            class="filter-reset"
            iconOnly
          >
            <Icon name="eraser" size="20px" />
          </FluentButton>
          <span class="filter-selection-summary">
            {labels.selected(draftOptions.length)}
          </span>
        </div>
        <div class="filter-panel__actions">
          <FluentButton data-fluent-owner="shared-multi-select-filter"
            type="button"
            onclick={() => close()}
            appearance="subtle"
            class="filter-cancel"
          >
            {$t('common.cancel')}
          </FluentButton>
          <FluentButton data-fluent-owner="shared-multi-select-filter"
            type="button"
            disabled={!draftChanged}
            onclick={async () => { const filters = normalizeFilterOptions(draftOptions); await close(); await onApply(filters); }}
            appearance="subtle"
            class="filter-apply"
          >
            {labels.apply}
          </FluentButton>
        </div>
      </footer>
  {/snippet}
</FilterPopover>
