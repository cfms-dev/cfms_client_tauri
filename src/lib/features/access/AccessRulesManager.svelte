<script lang="ts">
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import { untrack, type Snippet } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import {
    ACCESS_OPERATIONS,
    CONDITION_TYPES,
    cloneAccessRules,
    createConditionBlock,
    createRuleGroup,
    createSubRule,
    formatAccessRules,
    normalizeAccessRules,
    parseAccessRulesJson,
    validateAccessRules,
    type AccessConditionBlock,
    type AccessOperation,
    type AccessRuleGroup,
    type AccessRulesRecord,
    type AccessSubRule,
    type ConditionType,
    type MatchMode,
  } from '$lib/features/access/access-rules';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import JsonCodeEditor from '$lib/shared/ui/JsonCodeEditor.svelte';
  import MdSwitch from '$lib/shared/ui/MdSwitch.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';

  interface Props {
    rules: unknown;
    inheritParent: boolean;
    saving?: boolean;
    submitLabel?: string;
    submitDisabled?: boolean;
    resetRevision?: number;
    footer?: Snippet<[submit: (intent?: 'ok' | 'apply') => Promise<void>]>;
    onEdit?: () => void;
    onDraftChange?: (draft: { rules: AccessRulesRecord; inheritParent: boolean } | null) => void;
    onSave: (rules: AccessRulesRecord, inheritParent: boolean, intent?: 'ok' | 'apply') => Promise<void> | void;
    onCancel: () => void;
  }

  let {
    rules,
    inheritParent,
    saving = false,
    submitLabel,
    submitDisabled = false,
    resetRevision = 0,
    footer,
    onEdit,
    onDraftChange,
    onSave,
    onCancel,
  }: Props = $props();

  let activeView = $state<'visual' | 'source'>('visual');
  let activeOperation = $state<AccessOperation>('read');
  let visualRules = $state<AccessRulesRecord>({});
  let sourceText = $state('');
  let inherit = $state(false);
  let sourceError = $state<string | null>(null);
  let incomingDraftKey: string | null = null;

  const operationRules = $derived(visualRules[activeOperation] ?? []);

  $effect(() => {
    const nextRules = normalizeAccessRules(rules);
    const nextInherit = Boolean(inheritParent);
    const nextKey = JSON.stringify([nextRules, nextInherit, resetRevision]);
    if (incomingDraftKey === nextKey) return;
    incomingDraftKey = nextKey;
    visualRules = nextRules;
    sourceText = formatAccessRules(nextRules);
    inherit = nextInherit;
    sourceError = null;
  });

  $effect(() => {
    const notify = onDraftChange;
    if (!notify) return;
    let draft: { rules: AccessRulesRecord; inheritParent: boolean } | null;
    try {
      draft = { rules: cloneAccessRules(validatedDraftRules()), inheritParent: inherit };
      if (activeView === 'source') sourceError = null;
    } catch (error) {
      draft = null;
      if (activeView === 'source') sourceError = (error as Error).message;
    }
    // A parent can update its baseline or button state without making those
    // reactive reads dependencies of the editor's draft notification.
    untrack(() => notify(draft));
  });

  function validatedDraftRules(): AccessRulesRecord {
    const nextRules = activeView === 'source'
      ? parseAccessRulesJson(sourceText)
      : normalizeAccessRules(visualRules);
    validateAccessRules(nextRules);
    return nextRules;
  }

  function getRulesForActiveOperation() {
    return [...(visualRules[activeOperation] ?? [])];
  }

  function commitActiveOperationRules(nextRules: AccessRuleGroup[]) {
    if (saving) return;
    onEdit?.();
    visualRules = {
      ...visualRules,
      [activeOperation]: nextRules,
    };
    sourceError = null;
  }

  function selectEditorView(view: 'visual' | 'source') {
    if (saving) return;
    if (view === activeView) return;

    if (view === 'visual') {
      try {
        visualRules = parseAccessRulesJson(sourceText);
        sourceError = null;
      } catch (err) {
        sourceError = (err as Error).message;
        return;
      }
    } else {
      sourceText = formatAccessRules(normalizeAccessRules(visualRules));
      sourceError = null;
    }

    activeView = view;
  }

  function changeSource(value: string) {
    if (saving) return;
    onEdit?.();
    sourceText = value;
    sourceError = null;
  }

  function setActiveOperation(operation: AccessOperation) {
    if (saving) return;
    activeOperation = operation;
  }

  function addRuleGroup() {
    commitActiveOperationRules([...getRulesForActiveOperation(), createRuleGroup()]);
  }

  function updateRuleGroup(groupIndex: number, patch: Partial<AccessRuleGroup>) {
    const nextRules = getRulesForActiveOperation();
    nextRules[groupIndex] = {
      ...nextRules[groupIndex],
      ...patch,
    };
    commitActiveOperationRules(nextRules);
  }

  function removeRuleGroup(groupIndex: number) {
    commitActiveOperationRules(
      getRulesForActiveOperation().filter((_, index) => index !== groupIndex),
    );
  }

  function addSubRule(groupIndex: number) {
    const group = operationRules[groupIndex];
    updateRuleGroup(groupIndex, {
      match_groups: [...group.match_groups, createSubRule()],
    });
  }

  function updateSubRule(
    groupIndex: number,
    subRuleIndex: number,
    patch: Partial<AccessSubRule>,
  ) {
    const group = operationRules[groupIndex];
    const nextSubRules = [...group.match_groups];
    nextSubRules[subRuleIndex] = {
      ...nextSubRules[subRuleIndex],
      ...patch,
    };
    updateRuleGroup(groupIndex, { match_groups: nextSubRules });
  }

  function removeSubRule(groupIndex: number, subRuleIndex: number) {
    const group = operationRules[groupIndex];
    updateRuleGroup(groupIndex, {
      match_groups: group.match_groups.filter((_, index) => index !== subRuleIndex),
    });
  }

  function setConditionBlock(
    groupIndex: number,
    subRuleIndex: number,
    type: ConditionType,
    block: AccessConditionBlock | undefined,
  ) {
    const subRule = operationRules[groupIndex].match_groups[subRuleIndex];
    const nextSubRule = { ...subRule };
    if (block) {
      nextSubRule[type] = block;
    } else {
      delete nextSubRule[type];
    }

    const group = operationRules[groupIndex];
    const nextSubRules = [...group.match_groups];
    nextSubRules[subRuleIndex] = nextSubRule;
    updateRuleGroup(groupIndex, { match_groups: nextSubRules });
  }

  function updateConditionBlock(
    groupIndex: number,
    subRuleIndex: number,
    type: ConditionType,
    patch: Partial<AccessConditionBlock>,
  ) {
    const block = operationRules[groupIndex].match_groups[subRuleIndex][type];
    if (!block) return;
    setConditionBlock(groupIndex, subRuleIndex, type, {
      ...block,
      ...patch,
    });
  }

  function addConditionEntry(
    groupIndex: number,
    subRuleIndex: number,
    type: ConditionType,
    value: string,
  ) {
    const trimmed = value.trim();
    if (!trimmed) return;

    const block = operationRules[groupIndex].match_groups[subRuleIndex][type];
    if (!block || block.require.includes(trimmed)) return;

    updateConditionBlock(groupIndex, subRuleIndex, type, {
      require: [...block.require, trimmed],
    });
  }

  function removeConditionEntry(
    groupIndex: number,
    subRuleIndex: number,
    type: ConditionType,
    entryIndex: number,
  ) {
    const block = operationRules[groupIndex].match_groups[subRuleIndex][type];
    if (!block) return;

    updateConditionBlock(groupIndex, subRuleIndex, type, {
      require: block.require.filter((_, index) => index !== entryIndex),
    });
  }

  async function submitRules(intent?: 'ok' | 'apply') {
    if (saving || submitDisabled) return;
    let nextRules: AccessRulesRecord;

    try {
      nextRules = validatedDraftRules();
      sourceError = null;
    } catch (err) {
      sourceError = (err as Error).message;
      return;
    }

    if (intent) {
      await onSave(cloneAccessRules(nextRules), inherit, intent);
    } else {
      await onSave(cloneAccessRules(nextRules), inherit);
    }
  }

  function selectValue(event: Event) {
    return (event.currentTarget as HTMLSelectElement).value;
  }

  function entryInput(event: SubmitEvent) {
    return (event.currentTarget as HTMLFormElement).elements.namedItem('entry') as HTMLInputElement;
  }
</script>

<div class="flex h-full min-h-0 max-h-[78vh] flex-col overflow-hidden">
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden" inert={saving} aria-busy={saving}>
  <div class="border-b border-md3-outline px-5 py-3">
    <div class="flex flex-wrap items-center gap-2">
      <FluentButton data-fluent-owner="lib-components-access-rules-manager"
        type="button"
        onclick={() => selectEditorView('visual')}
        disabled={saving}
        appearance="subtle"
        class={"editor-tab " + (activeView === 'visual' ? 'editor-tab-active' : '')}
      >
        <Icon name="rule" size="17px" />
        {$t('files.accessRulesVisualization')}
      </FluentButton>
      <FluentButton data-fluent-owner="lib-components-access-rules-manager"
        type="button"
        onclick={() => selectEditorView('source')}
        disabled={saving}
        appearance="subtle"
        class={"editor-tab " + (activeView === 'source' ? 'editor-tab-active' : '')}
      >
        <Icon name="code" size="17px" />
        {$t('files.sourceCode')}
      </FluentButton>
      <div class="ml-auto flex items-center gap-2 text-sm text-md3-on-surface-variant">
        <MdSwitch
          bind:checked={inherit}
          disabled={saving}
          onChange={() => onEdit?.()}
          ariaLabel={$t('files.inheritParentRules')}
        />
        {$t('files.inheritParentRules')}
      </div>
    </div>
  </div>

  {#if activeView === 'visual'}
    <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[150px_1fr]">
      <nav class="border-b border-md3-outline bg-md3-surface-container p-3 md:border-b-0 md:border-r">
        <p class="mb-2 px-2 text-[11px] font-medium uppercase text-md3-on-surface-variant">
          {$t('files.accessOperation')}
        </p>
        <div class="grid grid-cols-2 gap-2 md:grid-cols-1">
          {#each ACCESS_OPERATIONS as operation}
            <FluentButton data-fluent-owner="lib-components-access-rules-manager"
              type="button"
              onclick={() => setActiveOperation(operation)}
              disabled={saving}
              appearance="subtle"
              class={"operation-button " + (activeOperation === operation ? 'operation-button-active' : '')}
            >
              {#if operation === 'read'}
                <Icon name="visibility" size="18px" />
              {:else if operation === 'write'}
                <Icon name="edit" size="18px" />
              {:else if operation === 'move'}
                <Icon name="driveFileMove" size="18px" />
              {:else}
                <Icon name="manageAccounts" size="18px" />
              {/if}
              {$t(`files.operation.${operation}`)}
            </FluentButton>
          {/each}
        </div>
      </nav>

      <div class="min-h-0 overflow-auto p-5">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 class="text-sm font-semibold text-md3-on-surface">
              {$t(`files.operation.${activeOperation}`)}
            </h4>
            <p class="mt-1 text-xs text-md3-on-surface-variant">
              {$t('files.ruleGroupsCount', { values: { count: operationRules.length } })}
            </p>
          </div>
          <FluentButton data-fluent-owner="lib-components-access-rules-manager"
            type="button"
            onclick={addRuleGroup}
            disabled={saving}
            appearance="subtle"
            class="filled-button"
          >
            <Icon name="add" size="17px" />
            {$t('files.addRuleGroup')}
          </FluentButton>
        </div>

        {#if operationRules.length === 0}
          <div class="rounded-lg border border-dashed border-md3-outline p-8 text-center text-sm text-md3-on-surface-variant">
            {$t('files.noRuleGroups')}
          </div>
        {:else}
          <div class="space-y-4">
            {#each operationRules as group, groupIndex}
              <section class="rounded-lg border border-md3-outline bg-md3-surface-container">
                <div class="flex flex-wrap items-center gap-3 border-b border-md3-outline px-4 py-3">
                  <div class="min-w-0">
                    <h5 class="text-sm font-semibold text-md3-on-surface">
                      {$t('files.ruleGroup')} #{groupIndex + 1}
                    </h5>
                  </div>
                  <label class="ml-auto flex items-center gap-2 text-xs text-md3-on-surface-variant">
                    {$t('files.matchMode')}
                    <select
                      class="cfms-native-field select-field"
                      value={group.match}
                      onchange={(event) => updateRuleGroup(groupIndex, { match: selectValue(event) as MatchMode })}
                      disabled={saving}
                    >
                      <option value="all">{$t('files.allAnd')}</option>
                      <option value="any">{$t('files.anyOr')}</option>
                    </select>
                  </label>
                  <FluentButton data-fluent-owner="lib-components-access-rules-manager"
                    type="button"
                    title={$t('files.deleteRuleGroup')}
                    onclick={() => removeRuleGroup(groupIndex)}
                    disabled={saving}
                    appearance="subtle"
                    tone="danger"
                    class="cfms-control-action icon-button danger-button"
                    iconOnly
                    aria-label={$t('files.deleteRuleGroup')}
                  >
                    <Icon name="delete" size="18px" />
                  </FluentButton>
                </div>

                <div class="space-y-3 p-4">
                  {#each group.match_groups as subRule, subRuleIndex}
                    <article class="rounded-lg border border-md3-outline/70 bg-md3-surface">
                      <div class="flex flex-wrap items-center gap-3 border-b border-md3-outline/60 px-3 py-2.5">
                        <span class="text-sm font-medium text-md3-on-surface">
                          {$t('files.subgroup')} #{subRuleIndex + 1}
                        </span>
                        <label class="ml-auto flex items-center gap-2 text-xs text-md3-on-surface-variant">
                          {$t('files.matchMode')}
                          <select
                            class="cfms-native-field select-field"
                            value={subRule.match}
                            onchange={(event) => updateSubRule(groupIndex, subRuleIndex, { match: selectValue(event) as MatchMode })}
                            disabled={saving}
                          >
                            <option value="all">{$t('files.allAnd')}</option>
                            <option value="any">{$t('files.anyOr')}</option>
                          </select>
                        </label>
                        <FluentButton data-fluent-owner="lib-components-access-rules-manager"
                          type="button"
                          title={$t('files.deleteSubgroup')}
                          onclick={() => removeSubRule(groupIndex, subRuleIndex)}
                          disabled={saving}
                          appearance="subtle"
                          tone="danger"
                          class="cfms-control-action icon-button danger-button"
                          iconOnly
                          aria-label={$t('files.deleteSubgroup')}
                        >
                          <Icon name="remove" size="18px" />
                        </FluentButton>
                      </div>

                      <div class="grid gap-3 p-3 lg:grid-cols-2">
                        {#each CONDITION_TYPES as type}
                          {@const block = subRule[type]}
                          {#if block}
                            <div class="rounded-lg border border-md3-outline/60 bg-md3-surface-container p-3">
                              <div class="mb-3 flex items-center gap-2">
                                <span class="text-sm font-medium text-md3-on-surface">
                                  {$t(`files.condition.${type}`)}
                                </span>
                                <select
                                  class="cfms-native-field select-field ml-auto"
                                  value={block.match}
                                  onchange={(event) => updateConditionBlock(groupIndex, subRuleIndex, type, { match: selectValue(event) as MatchMode })}
                                  disabled={saving}
                                >
                                  <option value="all">{$t('files.allAnd')}</option>
                                  <option value="any">{$t('files.anyOr')}</option>
                                </select>
                                <FluentButton data-fluent-owner="lib-components-access-rules-manager"
                                  type="button"
                                  title={$t('files.removeSection')}
                                  onclick={() => setConditionBlock(groupIndex, subRuleIndex, type, undefined)}
                                  disabled={saving}
                                  appearance="subtle"
                                  tone="danger"
                                  class="cfms-control-action icon-button danger-button"
                                  iconOnly
                                  aria-label={$t('files.removeSection')}
                                >
                                  <Icon name="close" size="17px" />
                                </FluentButton>
                              </div>

                              {#if block.require.length === 0}
                                <p class="mb-3 text-xs text-md3-on-surface-variant">
                                  {$t('files.noEntries')}
                                </p>
                              {:else}
                                <div class="mb-3 flex flex-wrap gap-2">
                                  {#each block.require as entry, entryIndex}
                                    <span class="inline-flex max-w-full items-center gap-1 rounded-full bg-md3-surface-container-high px-2.5 py-1 text-xs text-md3-on-surface">
                                      <span class="truncate">{entry}</span>
                                      <FluentButton data-fluent-owner="lib-components-access-rules-manager"
                                        type="button"
                                        title={$t('files.removeEntry')}
                                        onclick={() => removeConditionEntry(groupIndex, subRuleIndex, type, entryIndex)}
                                        disabled={saving}
                                        appearance="subtle"
                                        tone="danger"
                                        class="text-md3-on-surface-variant hover:text-md3-error"
                                        iconOnly
                                        aria-label={$t('files.removeEntry')}
                                      >
                                        <Icon name="close" size="14px" />
                                      </FluentButton>
                                    </span>
                                  {/each}
                                </div>
                              {/if}

                              <form
                                class="flex gap-2"
                                onsubmit={(event) => {
                                  event.preventDefault();
                                  const input = entryInput(event);
                                  addConditionEntry(groupIndex, subRuleIndex, type, input.value);
                                  input.value = '';
                                }}
                              >
                                <input
                                  name="entry"
                                  class="cfms-native-field min-w-0 flex-1 rounded-lg border border-md3-outline bg-md3-field px-3 text-sm text-md3-on-surface outline-none transition"
                                  placeholder={type === 'rights' ? $t('files.rightNamePlaceholder') : $t('files.groupNamePlaceholder')}
                                  disabled={saving}
                                />
                                <FluentButton data-fluent-owner="lib-components-access-rules-manager"
                                  type="submit"
                                  title={$t('files.addEntry')}
                                  disabled={saving}
                                  appearance="subtle"
                                  class="cfms-control-action icon-button primary-button"
                                  iconOnly
                                  aria-label={$t('files.addEntry')}
                                >
                                  <Icon name="add" size="18px" />
                                </FluentButton>
                              </form>
                            </div>
                          {/if}
                        {/each}

                        {#if !subRule.rights || !subRule.groups}
                          <div class="flex flex-wrap items-start gap-2">
                            {#if !subRule.rights}
                              <FluentButton data-fluent-owner="lib-components-access-rules-manager"
                                type="button"
                                onclick={() => setConditionBlock(groupIndex, subRuleIndex, 'rights', createConditionBlock())}
                                disabled={saving}
                                appearance="subtle"
                                class="outline-button"
                              >
                                <Icon name="add" size="17px" />
                                {$t('files.addRightsSection')}
                              </FluentButton>
                            {/if}
                            {#if !subRule.groups}
                              <FluentButton data-fluent-owner="lib-components-access-rules-manager"
                                type="button"
                                onclick={() => setConditionBlock(groupIndex, subRuleIndex, 'groups', createConditionBlock())}
                                disabled={saving}
                                appearance="subtle"
                                class="outline-button"
                              >
                                <Icon name="add" size="17px" />
                                {$t('files.addGroupsSection')}
                              </FluentButton>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    </article>
                  {/each}

                  <FluentButton data-fluent-owner="lib-components-access-rules-manager"
                    type="button"
                    onclick={() => addSubRule(groupIndex)}
                    disabled={saving}
                    appearance="subtle"
                    class="outline-button"
                  >
                    <Icon name="add" size="17px" />
                    {$t('files.addSubgroup')}
                  </FluentButton>
                </div>
              </section>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-auto p-5">
      <div class="access-rules-source-editor" class:has-error={sourceError !== null}>
        <JsonCodeEditor
          value={sourceText}
          disabled={saving}
          ariaLabel={$t('files.accessRules')}
          loadingLabel={$t('files.accessRulesEditorLoading')}
          onChange={changeSource}
        />
      </div>
      {#if sourceError}
        <p class="mt-2 text-xs text-md3-error" role="alert">
          {$t('files.invalidAccessRulesJson', { values: { error: sourceError } })}
        </p>
      {/if}
      <p class="mt-3 text-xs text-md3-on-surface-variant">
        {$t('files.ruleFormatHelp')}
      </p>
    </div>
  {/if}
  </div>

  {#if footer}
    {@render footer(submitRules)}
  {:else}
    <div class="flex flex-wrap items-center justify-end gap-2 border-t border-md3-outline px-5 py-4">
    <DialogActionButton onclick={onCancel} disabled={saving}>
      {$t('common.cancel')}
    </DialogActionButton>
    <DialogActionButton
      variant="primary"
      onclick={() => submitRules()}
      disabled={saving || submitDisabled}
    >
      {#if saving}
        <ProgressRing size={17} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
        {$t('common.saving')}
      {:else}
        <Icon name="done" size="17px" />
        {submitLabel ?? $t('common.save')}
      {/if}
    </DialogActionButton>
    </div>
  {/if}
</div>

<style>
  :global(.editor-tab[data-fluent-owner="lib-components-access-rules-manager"]),
  :global(.operation-button[data-fluent-owner="lib-components-access-rules-manager"]),
  :global(.filled-button[data-fluent-owner="lib-components-access-rules-manager"]),
  :global(.outline-button[data-fluent-owner="lib-components-access-rules-manager"]),
  :global(.icon-button[data-fluent-owner="lib-components-access-rules-manager"]) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease,
      filter 150ms ease;
  }

  :global(.editor-tab[data-fluent-owner="lib-components-access-rules-manager"]) {
    min-height: 2.25rem;
    border-radius: var(--borderRadiusMedium);
    padding: 0.45rem 0.85rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 14px;
  }

  :global(.editor-tab[data-fluent-owner="lib-components-access-rules-manager"]):hover,
  :global(.operation-button[data-fluent-owner="lib-components-access-rules-manager"]:hover),
  :global(.outline-button[data-fluent-owner="lib-components-access-rules-manager"]:hover),
  :global(.icon-button[data-fluent-owner="lib-components-access-rules-manager"]:hover) {
    background: color-mix(in srgb, var(--color-md3-primary-container) 34%, transparent);
  }

  :global(.editor-tab-active[data-fluent-owner="lib-components-access-rules-manager"]),
  :global(.operation-button-active[data-fluent-owner="lib-components-access-rules-manager"]) {
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
  }

  :global(.operation-button[data-fluent-owner="lib-components-access-rules-manager"]) {
    min-height: 2.5rem;
    border-radius: var(--borderRadiusMedium);
    padding: 0.55rem 0.7rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 14px;
  }

  :global(.filled-button[data-fluent-owner="lib-components-access-rules-manager"]) {
    min-height: 2.25rem;
    border-radius: var(--borderRadiusMedium);
    background: var(--color-md3-primary);
    color: var(--color-md3-on-primary);
    padding: 0.5rem 1rem;
    font-size: 14px;
    font-weight: 500;
  }

  :global(.outline-button[data-fluent-owner="lib-components-access-rules-manager"]) {
    min-height: 2.25rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: var(--borderRadiusMedium);
    color: var(--color-md3-on-surface);
    padding: 0.45rem 0.85rem;
    font-size: 12px;
  }

  :global(.icon-button[data-fluent-owner="lib-components-access-rules-manager"]) {
    border-radius: var(--borderRadiusMedium);
    color: var(--color-md3-on-surface-variant);
  }

  :global(.primary-button[data-fluent-owner="lib-components-access-rules-manager"]) {
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
  }

  :global(.danger-button[data-fluent-owner="lib-components-access-rules-manager"]:hover) {
    background: var(--color-md3-error-container);
    color: var(--color-md3-on-error-container);
  }

  :global(.filled-button[data-fluent-owner="lib-components-access-rules-manager"]:is(:disabled, [disabled])),
  :global(.outline-button[data-fluent-owner="lib-components-access-rules-manager"]:is(:disabled, [disabled])),
  :global(.icon-button[data-fluent-owner="lib-components-access-rules-manager"]:is(:disabled, [disabled])),
  :global(.editor-tab[data-fluent-owner="lib-components-access-rules-manager"]):is(:disabled, [disabled]),
  :global(.operation-button[data-fluent-owner="lib-components-access-rules-manager"]:is(:disabled, [disabled])) {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .select-field {
    border-radius: var(--borderRadiusMedium);
    border: 1px solid var(--color-md3-outline);
    background: var(--color-md3-field);
    color: var(--color-md3-on-surface);
    padding-inline: 0.55rem;
    outline: none;
  }

  .access-rules-source-editor :global(.cm-editor),
  .access-rules-source-editor :global(.editor-loading),
  .access-rules-source-editor :global(textarea) {
    height: 54vh;
    min-height: 12rem;
  }

  .access-rules-source-editor.has-error :global(.code-editor) {
    border-color: var(--color-md3-error);
  }
</style>
