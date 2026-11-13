<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import MultiSelectFilter from '$lib/shared/ui/MultiSelectFilter.svelte';
  interface Props { availableActions: readonly string[]; selectedActions: readonly string[]; disabled?: boolean; onApply: (filters: string[]) => void | Promise<void>; }
  let { availableActions, selectedActions, disabled = false, onApply }: Props = $props();
</script>

<MultiSelectFilter availableOptions={availableActions} selectedOptions={selectedActions} {disabled} {onApply} allowCustom labels={{
  label: $t('manage.auditFilter'), button: $t('manage.auditFilterButton', { values: { count: selectedActions.length } }),
  title: $t('manage.auditFilterTitle'), help: $t('manage.auditFilterHelp'),
  search: $t('manage.auditFilterSearch'), searchPlaceholder: $t('manage.auditFilterSearchPlaceholder'),
  clearSearch: $t('manage.auditFilterClearSearch'), options: $t('manage.auditFilterOptions'),
  noMatches: $t('manage.auditFilterNoMatches'), noSuggestions: $t('manage.auditFilterNoSuggestions'),
  selected: (count) => $t('manage.auditFilterSelected', { values: { count } }),
  apply: $t('manage.auditFilterApply'), addCustom: $t('manage.auditFilterAddCustom'),
}} />
