<script lang="ts">
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
    type AccessConditionBlock,
    type AccessOperation,
    type AccessRuleGroup,
    type AccessRulesRecord,
    type AccessSubRule,
    type ConditionType,
    type MatchMode,
  } from '$lib/access-rules';
  import Icon from '$lib/components/Icon.svelte';
  import MdSwitch from '$lib/components/MdSwitch.svelte';
  import ProgressRing from '$lib/components/ProgressRing.svelte';

  interface Props {
    rules: unknown;
    inheritParent: boolean;
    saving?: boolean;
    onSave: (rules: AccessRulesRecord, inheritParent: boolean) => Promise<void> | void;
    onCancel: () => void;
  }

  let {
    rules,
    inheritParent,
    saving = false,
    onSave,
    onCancel,
  }: Props = $props();

  let activeView = $state<'visual' | 'source'>('visual');
  let activeOperation = $state<AccessOperation>('read');
  let visualRules = $state<AccessRulesRecord>({});
  let sourceText = $state('');
  let inherit = $state(false);
  let sourceError = $state<string | null>(null);

  const operationRules = $derived(visualRules[activeOperation] ?? []);

  $effect(() => {
    const nextRules = normalizeAccessRules(rules);
    visualRules = nextRules;
    sourceText = formatAccessRules(nextRules);
    inherit = Boolean(inheritParent);
    sourceError = null;
  });

  function getRulesForActiveOperation() {
    return [...(visualRules[activeOperation] ?? [])];
  }

  function commitActiveOperationRules(nextRules: AccessRuleGroup[]) {
    visualRules = {
      ...visualRules,
      [activeOperation]: nextRules,
    };
    sourceError = null;
  }

  function selectEditorView(view: 'visual' | 'source') {
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

  function setActiveOperation(operation: AccessOperation) {
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

  async function submitRules() {
    let nextRules: AccessRulesRecord;

    try {
      nextRules = activeView === 'source'
        ? parseAccessRulesJson(sourceText)
        : normalizeAccessRules(visualRules);
      sourceError = null;
    } catch (err) {
      sourceError = (err as Error).message;
      return;
    }

    await onSave(cloneAccessRules(nextRules), inherit);
  }

  function selectValue(event: Event) {
    return (event.currentTarget as HTMLSelectElement).value;
  }

  function entryInput(event: SubmitEvent) {
    return (event.currentTarget as HTMLFormElement).elements.namedItem('entry') as HTMLInputElement;
  }
</script>

<div class="flex max-h-[78vh] flex-col overflow-hidden">
  <div class="border-b border-md3-outline px-5 py-3">
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="editor-tab {activeView === 'visual' ? 'editor-tab-active' : ''}"
        onclick={() => selectEditorView('visual')}
      >
        <Icon name="rule" size="17px" />
        {$t('files.accessRulesVisualization')}
      </button>
      <button
        type="button"
        class="editor-tab {activeView === 'source' ? 'editor-tab-active' : ''}"
        onclick={() => selectEditorView('source')}
      >
        <Icon name="code" size="17px" />
        {$t('files.sourceCode')}
      </button>
      <div class="ml-auto flex items-center gap-2 text-sm text-md3-on-surface-variant">
        <MdSwitch
          bind:checked={inherit}
          ariaLabel={$t('files.inheritParentRules')}
        />
        {$t('files.inheritParentRules')}
      </div>
    </div>
  </div>

  {#if activeView === 'visual'}
    <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[150px_1fr]">
      <nav class="border-b border-md3-outline bg-md3-surface-container/60 p-3 md:border-b-0 md:border-r">
        <p class="mb-2 px-2 text-[11px] font-medium uppercase text-md3-on-surface-variant">
          {$t('files.accessOperation')}
        </p>
        <div class="grid grid-cols-2 gap-2 md:grid-cols-1">
          {#each ACCESS_OPERATIONS as operation}
            <button
              type="button"
              class="operation-button {activeOperation === operation ? 'operation-button-active' : ''}"
              onclick={() => setActiveOperation(operation)}
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
            </button>
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
          <button
            type="button"
            class="filled-button"
            onclick={addRuleGroup}
            disabled={saving}
          >
            <Icon name="add" size="17px" />
            {$t('files.addRuleGroup')}
          </button>
        </div>

        {#if operationRules.length === 0}
          <div class="rounded-lg border border-dashed border-md3-outline p-8 text-center text-sm text-md3-on-surface-variant">
            {$t('files.noRuleGroups')}
          </div>
        {:else}
          <div class="space-y-4">
            {#each operationRules as group, groupIndex}
              <section class="rounded-lg border border-md3-outline bg-md3-surface-container/70">
                <div class="flex flex-wrap items-center gap-3 border-b border-md3-outline px-4 py-3">
                  <div class="min-w-0">
                    <h5 class="text-sm font-semibold text-md3-on-surface">
                      {$t('files.ruleGroup')} #{groupIndex + 1}
                    </h5>
                  </div>
                  <label class="ml-auto flex items-center gap-2 text-xs text-md3-on-surface-variant">
                    {$t('files.matchMode')}
                    <select
                      class="select-field"
                      value={group.match}
                      onchange={(event) => updateRuleGroup(groupIndex, { match: selectValue(event) as MatchMode })}
                      disabled={saving}
                    >
                      <option value="all">{$t('files.allAnd')}</option>
                      <option value="any">{$t('files.anyOr')}</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    class="icon-button danger-button"
                    title={$t('files.deleteRuleGroup')}
                    onclick={() => removeRuleGroup(groupIndex)}
                    disabled={saving}
                  >
                    <Icon name="delete" size="18px" />
                  </button>
                </div>

                <div class="space-y-3 p-4">
                  {#each group.match_groups as subRule, subRuleIndex}
                    <article class="rounded-lg border border-md3-outline/70 bg-md3-surface/35">
                      <div class="flex flex-wrap items-center gap-3 border-b border-md3-outline/60 px-3 py-2.5">
                        <span class="text-sm font-medium text-md3-on-surface">
                          {$t('files.subgroup')} #{subRuleIndex + 1}
                        </span>
                        <label class="ml-auto flex items-center gap-2 text-xs text-md3-on-surface-variant">
                          {$t('files.matchMode')}
                          <select
                            class="select-field"
                            value={subRule.match}
                            onchange={(event) => updateSubRule(groupIndex, subRuleIndex, { match: selectValue(event) as MatchMode })}
                            disabled={saving}
                          >
                            <option value="all">{$t('files.allAnd')}</option>
                            <option value="any">{$t('files.anyOr')}</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          class="icon-button danger-button"
                          title={$t('files.deleteSubgroup')}
                          onclick={() => removeSubRule(groupIndex, subRuleIndex)}
                          disabled={saving}
                        >
                          <Icon name="remove" size="18px" />
                        </button>
                      </div>

                      <div class="grid gap-3 p-3 lg:grid-cols-2">
                        {#each CONDITION_TYPES as type}
                          {@const block = subRule[type]}
                          {#if block}
                            <div class="rounded-lg border border-md3-outline/60 bg-md3-surface-container/55 p-3">
                              <div class="mb-3 flex items-center gap-2">
                                <span class="text-sm font-medium text-md3-on-surface">
                                  {$t(`files.condition.${type}`)}
                                </span>
                                <select
                                  class="select-field ml-auto"
                                  value={block.match}
                                  onchange={(event) => updateConditionBlock(groupIndex, subRuleIndex, type, { match: selectValue(event) as MatchMode })}
                                  disabled={saving}
                                >
                                  <option value="all">{$t('files.allAnd')}</option>
                                  <option value="any">{$t('files.anyOr')}</option>
                                </select>
                                <button
                                  type="button"
                                  class="icon-button danger-button"
                                  title={$t('files.removeSection')}
                                  onclick={() => setConditionBlock(groupIndex, subRuleIndex, type, undefined)}
                                  disabled={saving}
                                >
                                  <Icon name="close" size="17px" />
                                </button>
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
                                      <button
                                        type="button"
                                        class="text-md3-on-surface-variant hover:text-md3-error"
                                        title={$t('files.removeEntry')}
                                        onclick={() => removeConditionEntry(groupIndex, subRuleIndex, type, entryIndex)}
                                        disabled={saving}
                                      >
                                        <Icon name="close" size="14px" />
                                      </button>
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
                                  class="min-w-0 flex-1 rounded-lg border border-md3-outline bg-md3-field px-3 py-2 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/25"
                                  placeholder={type === 'rights' ? $t('files.rightNamePlaceholder') : $t('files.groupNamePlaceholder')}
                                  disabled={saving}
                                />
                                <button type="submit" class="icon-button primary-button" title={$t('files.addEntry')} disabled={saving}>
                                  <Icon name="add" size="18px" />
                                </button>
                              </form>
                            </div>
                          {/if}
                        {/each}

                        {#if !subRule.rights || !subRule.groups}
                          <div class="flex flex-wrap items-start gap-2">
                            {#if !subRule.rights}
                              <button
                                type="button"
                                class="outline-button"
                                onclick={() => setConditionBlock(groupIndex, subRuleIndex, 'rights', createConditionBlock())}
                                disabled={saving}
                              >
                                <Icon name="add" size="17px" />
                                {$t('files.addRightsSection')}
                              </button>
                            {/if}
                            {#if !subRule.groups}
                              <button
                                type="button"
                                class="outline-button"
                                onclick={() => setConditionBlock(groupIndex, subRuleIndex, 'groups', createConditionBlock())}
                                disabled={saving}
                              >
                                <Icon name="add" size="17px" />
                                {$t('files.addGroupsSection')}
                              </button>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    </article>
                  {/each}

                  <button
                    type="button"
                    class="outline-button"
                    onclick={() => addSubRule(groupIndex)}
                    disabled={saving}
                  >
                    <Icon name="add" size="17px" />
                    {$t('files.addSubgroup')}
                  </button>
                </div>
              </section>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-auto p-5">
      <textarea
        class="h-[54vh] w-full resize-none rounded-lg border bg-md3-field p-3 text-sm text-md3-on-surface outline-none transition focus:border-md3-primary focus:ring-2 focus:ring-md3-primary/25 {sourceError ? 'border-md3-error' : 'border-md3-outline'}"
        style="font-family: var(--font-md3-mono);"
        bind:value={sourceText}
        disabled={saving}
      ></textarea>
      {#if sourceError}
        <p class="mt-2 text-xs text-md3-error">
          {$t('files.invalidAccessRulesJson', { values: { error: sourceError } })}
        </p>
      {/if}
      <p class="mt-3 text-xs text-md3-on-surface-variant">
        {$t('files.ruleFormatHelp')}
      </p>
    </div>
  {/if}

  <div class="flex flex-wrap items-center justify-end gap-2 border-t border-md3-outline px-5 py-4">
    <button
      type="button"
      class="rounded-full bg-md3-surface-container-high px-4 py-2 text-sm font-medium text-md3-on-surface-variant transition-all hover:brightness-110 disabled:opacity-50"
      onclick={onCancel}
      disabled={saving}
    >
      {$t('common.cancel')}
    </button>
    <button
      type="button"
      class="filled-button"
      onclick={submitRules}
      disabled={saving}
    >
      {#if saving}
        <ProgressRing size={17} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
        {$t('common.saving')}
      {:else}
        <Icon name="done" size="17px" />
        {$t('common.save')}
      {/if}
    </button>
  </div>
</div>

<style>
  .editor-tab,
  .operation-button,
  .filled-button,
  .outline-button,
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      color 150ms ease,
      filter 150ms ease;
  }

  .editor-tab {
    min-height: 2.25rem;
    border-radius: 9999px;
    padding: 0.45rem 0.85rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.875rem;
  }

  .editor-tab:hover,
  .operation-button:hover,
  .outline-button:hover,
  .icon-button:hover {
    background: color-mix(in srgb, var(--color-md3-primary-container) 34%, transparent);
  }

  .editor-tab-active,
  .operation-button-active {
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
  }

  .operation-button {
    min-height: 2.5rem;
    border-radius: 0.5rem;
    padding: 0.55rem 0.7rem;
    color: var(--color-md3-on-surface-variant);
    font-size: 0.875rem;
  }

  .filled-button {
    min-height: 2.25rem;
    border-radius: 9999px;
    background: var(--color-md3-primary);
    color: var(--color-md3-on-primary);
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .outline-button {
    min-height: 2.25rem;
    border: 1px solid var(--color-md3-outline);
    border-radius: 9999px;
    color: var(--color-md3-on-surface);
    padding: 0.45rem 0.85rem;
    font-size: 0.8125rem;
  }

  .icon-button {
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    color: var(--color-md3-on-surface-variant);
  }

  .primary-button {
    background: var(--color-md3-primary-container);
    color: var(--color-md3-on-primary-container);
  }

  .danger-button:hover {
    background: var(--color-md3-error-container);
    color: var(--color-md3-on-error-container);
  }

  .filled-button:disabled,
  .outline-button:disabled,
  .icon-button:disabled,
  .editor-tab:disabled,
  .operation-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .select-field {
    min-height: 2rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-md3-outline);
    background: var(--color-md3-field);
    color: var(--color-md3-on-surface);
    padding: 0.25rem 0.55rem;
    outline: none;
  }
</style>
