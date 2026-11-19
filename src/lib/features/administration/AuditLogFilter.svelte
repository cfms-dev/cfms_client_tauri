<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import FilterPopover from '$lib/shared/ui/FilterPopover.svelte';
  import MultiSelectOptions from '$lib/shared/ui/MultiSelectOptions.svelte';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import { focusRovingItem } from '$lib/shared/ui/keyboard';
  import { DEFAULT_AUDIT_EXCLUSIONS, defaultAuditFilters, normalizeAuditActions, normalizeAuditFilters, selectAuditAction, type AuditActionFilters } from './audit-filters';

  interface Props {
    availableActions: readonly string[];
    filters: AuditActionFilters;
    disabled?: boolean;
    onApply: (filters: AuditActionFilters) => void | Promise<void>;
  }
  let { availableActions, filters, disabled = false, onApply }: Props = $props();
  const instanceId = $props.id();
  let draft = $state<AuditActionFilters>(defaultAuditFilters());
  let side = $state<keyof AuditActionFilters>('include');
  let editorRevision = $state(0);
  const sides = ['include', 'exclude'] as const;
  const changed = $derived(JSON.stringify(normalizeAuditFilters(draft)) !== JSON.stringify(normalizeAuditFilters(filters)));
  const defaultsSelected = $derived(JSON.stringify(normalizeAuditFilters(draft)) === JSON.stringify(defaultAuditFilters()));
  const availableOptions = $derived(normalizeAuditActions([
    ...DEFAULT_AUDIT_EXCLUSIONS, ...availableActions, ...filters.include, ...filters.exclude, ...draft.include, ...draft.exclude,
  ]));
  const labels = $derived({
    label: $t('manage.auditFilter'),
    button: $t('manage.auditFilterButton', { values: { include: filters.include.length, exclude: filters.exclude.length } }),
    title: $t('manage.auditFilterTitle'), help: $t('manage.auditFilterHelp'),
    search: $t('manage.auditFilterSearch'), searchPlaceholder: $t('manage.auditFilterSearchPlaceholder'),
    clearSearch: $t('manage.auditFilterClearSearch'), options: $t(side === 'include' ? 'manage.auditInclude' : 'manage.auditExclude'),
    noMatches: $t('manage.auditFilterNoMatches'), noSuggestions: $t('manage.auditFilterNoSuggestions'),
    addCustom: $t('manage.auditFilterAddCustom'),
  });
  function toggleAction(action: string) {
    draft = draft[side].includes(action)
      ? { ...draft, [side]: draft[side].filter((candidate) => candidate !== action) }
      : selectAuditAction(draft, side, action);
  }
  function handleTabKeydown(event: KeyboardEvent) {
    focusRovingItem(event, event.currentTarget as HTMLElement, { selector: '[role="tab"]', orientation: 'horizontal' })?.click();
  }
</script>

<FilterPopover {labels} {disabled} count={filters.include.length + filters.exclude.length}
  onOpen={() => { draft = normalizeAuditFilters(filters); side = 'include'; }}>
  <div class="audit-filter-tabs" role="tablist" tabindex="-1" aria-label={$t('manage.auditFilterTitle')} onkeydown={handleTabKeydown}>
    {#each sides as key}
      <button data-fluent-owner="shared-multi-select-filter" type="button" role="tab"
        id={`${instanceId}-${key}-tab`} aria-controls={`${instanceId}-options`}
        aria-selected={side === key} tabindex={side === key ? 0 : -1} onclick={() => side = key}>
        {$t(key === 'include' ? 'manage.auditInclude' : 'manage.auditExclude')} ({draft[key].length})
      </button>
    {/each}
  </div>
  <div class="audit-filter-editor" role="tabpanel" id={`${instanceId}-options`} aria-labelledby={`${instanceId}-${side}-tab`}>
    {#key `${side}-${editorRevision}`}
      <MultiSelectOptions {labels} {availableOptions} selectedOptions={draft[side]} allowCustom
        onToggle={toggleAction} onAdd={(action) => draft = selectAuditAction(draft, side, action)} />
    {/key}
  </div>
  {#snippet footer(close)}
    <footer class="filter-panel__footer">
      <div class="filter-panel__actions audit-filter-draft-actions">
        <FluentButton data-fluent-owner="shared-multi-select-filter"
          type="button"
          appearance="subtle"
          class="filter-reset"
          iconOnly
          aria-label={$t('manage.auditFilterClearAll')}
          title={$t('manage.auditFilterClearAll')}
          disabled={draft.include.length + draft.exclude.length === 0}
          onclick={() => { draft = { include: [], exclude: [] }; editorRevision += 1; }}>
          <Icon name="eraser" size="20px" />
        </FluentButton>
        <FluentButton data-fluent-owner="shared-multi-select-filter"
          type="button"
          appearance="subtle"
          class="filter-reset"
          iconOnly
          aria-label={$t('manage.auditFilterRestoreDefaults')}
          title={$t('manage.auditFilterRestoreDefaults')}
          disabled={defaultsSelected}
          onclick={() => { draft = defaultAuditFilters(); editorRevision += 1; }}>
          <Icon name="tagReset" size="20px" />
        </FluentButton>
      </div>
      <div class="filter-panel__actions">
        <FluentButton data-fluent-owner="shared-multi-select-filter" type="button" appearance="subtle" onclick={close}>
          {$t('common.cancel')}
        </FluentButton>
        <FluentButton data-fluent-owner="shared-multi-select-filter" type="button" appearance="primary" disabled={!changed}
          onclick={async () => { const next = normalizeAuditFilters(draft); await close(); await onApply(next); }}>
          {$t('manage.auditFilterApply')}
        </FluentButton>
      </div>
    </footer>
  {/snippet}
</FilterPopover>

<style>
  .audit-filter-tabs { display: flex; flex: none; gap: 8px; padding: 0 16px 12px; }
  .audit-filter-tabs button { flex: 1; min-height: 32px; border-radius: var(--borderRadiusMedium); padding: 4px 8px; color: var(--colorNeutralForeground2); }
  .audit-filter-tabs button:hover { background: var(--colorNeutralBackground1Hover); }
  .audit-filter-tabs button[aria-selected="true"] { color: var(--colorBrandForeground1); background: var(--colorBrandBackground2); font-weight: 600; }
  .audit-filter-editor { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
  :global(.filter-panel__actions.audit-filter-draft-actions) { flex: 0 1 auto; justify-content: flex-start; margin-inline-start: 0; gap: 4px; }
  @media (pointer: coarse) { .audit-filter-tabs button { min-height: 44px; } }
</style>
