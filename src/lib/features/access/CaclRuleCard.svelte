<script lang="ts">
  import { _ as t } from 'svelte-i18n';
  import {
    PRESET_MACRO_DESCRIPTIONS,
    type ObjectType,
    type Scope,
  } from 'codemirror-lang-cacl';
  import FluentButton from '$lib/shared/ui/FluentButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MdOutlinedField from '$lib/shared/ui/MdOutlinedField.svelte';
  import CaclPrincipalPicker from './CaclPrincipalPicker.svelte';
  import type { CaclPrincipalDirectory } from './cacl-editor-extensions';
  import {
    addDurationRfc3339Utc,
    computeRuleEffectiveMask,
    formatRuleOpSet,
    isOpCoveredByAdditiveItems,
    localInputToRfc3339Utc,
    rfc3339ToLocalInput,
    ruleTimeWindowState,
    toggleAtomicOpOnItems,
    togglePresetMacroOnItems,
    type CaclPrincipalRef,
    type CaclVisualRule,
  } from './cacl-model';
  import { CACL_OPERATION_GROUPS, CACL_PRESET_MACRO_ORDER } from './cacl-presets';

  interface Props {
    rule: CaclVisualRule;
    index: number;
    expanded?: boolean;
    targetObjectType?: ObjectType | null;
    directory: CaclPrincipalDirectory;
    userHints: Readonly<Record<string, string>>;
    canListUsers?: boolean;
    canListGroups?: boolean;
    disabled?: boolean;
    onToggleExpand: () => void;
    onChange: (next: CaclVisualRule) => void;
    onDuplicate: () => void;
    onRemove: () => void;
  }

  let {
    rule,
    index,
    expanded = false,
    targetObjectType = null,
    directory,
    userHints,
    canListUsers = false,
    canListGroups = false,
    disabled = false,
    onToggleExpand,
    onChange,
    onDuplicate,
    onRemove,
  }: Props = $props();

  let showAtomicMatrix = $state(false);
  const fieldPrefix = $props.id();

  const effectiveMask = $derived(computeRuleEffectiveMask(rule.opItems));
  const opSetPreview = $derived(formatRuleOpSet(rule.opItems));
  const timeState = $derived(ruleTimeWindowState(rule.validFrom, rule.validUntil));
  const fromLocalValue = $derived(rfc3339ToLocalInput(rule.validFrom));
  const untilLocalValue = $derived(rfc3339ToLocalInput(rule.validUntil));

  const userDisplayById = $derived.by(() => {
    const map = new Map<string, string>();
    for (const [uid, hint] of Object.entries(userHints)) {
      map.set(uid, hint);
    }
    for (const user of directory.users) {
      map.set(user.user_id, user.username);
    }
    return map;
  });

  function formatPrincipalLabel(principal: CaclPrincipalRef): string {
    if (principal.kind === 'group') return principal.value;
    const name = userDisplayById.get(principal.value);
    const shortId = principal.value.slice(0, 8);
    return name ? `@${name} (${shortId})` : shortId;
  }

  const subjectSummary = $derived.by(() => {
    if (rule.match.kind === 'any') return $t('files.cacl.matchAny');
    if (rule.match.kind === 'when') return $t('files.cacl.matchWhenSummary');
    if (rule.match.principals.length === 0) return $t('files.cacl.noPrincipals');
    return rule.match.principals.slice(0, 3).map(formatPrincipalLabel).join(', ')
      + (rule.match.principals.length > 3 ? ` +${rule.match.principals.length - 3}` : '');
  });

  function patch(partial: Partial<CaclVisualRule>) {
    if (disabled) return;
    onChange({ ...rule, ...partial });
  }

  function setMatchMode(mode: 'any' | 'to' | 'when') {
    if (disabled || rule.match.kind === mode) return;
    if (mode === 'any') {
      patch({ match: { kind: 'any' } });
    } else if (mode === 'to') {
      patch({ match: { kind: 'to', principals: [] } });
    } else {
      const expr = rule.match.kind === 'to' && rule.match.principals.length > 0
        ? rule.match.principals
            .map((p) => `${p.kind}("${p.value}")`)
            .join(' or ')
        : 'any';
      patch({ match: { kind: 'when', expression: expr } });
    }
  }

  function addPrincipal(principal: CaclPrincipalRef) {
    if (disabled) return;
    const current = rule.match.kind === 'to' ? rule.match.principals : [];
    const exists = current.some((p) => p.kind === principal.kind && p.value === principal.value);
    if (exists) return;
    patch({ match: { kind: 'to', principals: [...current, principal] } });
  }

  function removePrincipal(idx: number) {
    if (disabled || rule.match.kind !== 'to') return;
    patch({
      match: {
        kind: 'to',
        principals: rule.match.principals.filter((_, i) => i !== idx),
      },
    });
  }

  function insertWhenSnippet(snippet: string) {
    if (disabled || rule.match.kind !== 'when') return;
    const current = rule.match.expression.trim();
    const next = current && current !== 'any' ? `${current} ${snippet}` : snippet;
    patch({ match: { kind: 'when', expression: next } });
  }

  function isMacroActive(macroName: string): boolean {
    return rule.opItems.some((item) => !item.subtract && item.name === macroName);
  }

  function atomicOpState(opName: string, bit: number): 'included' | 'subtracted' | 'off' {
    if (rule.opItems.some((item) => item.subtract && item.name === opName)) {
      return 'subtracted';
    }
    if ((effectiveMask & bit) !== 0) {
      return 'included';
    }
    return isOpCoveredByAdditiveItems(rule.opItems, opName) ? 'subtracted' : 'off';
  }
</script>

<article class="rule-card" class:rule-card--deny={rule.effect === 'deny'}>
  <header class="rule-header">
    <button
      type="button"
      class="rule-toggle"
      aria-expanded={expanded}
      onclick={onToggleExpand}
    >
      <span class="rule-chevron" aria-hidden="true">
        <Icon name={expanded ? 'expandMore' : 'breadcrumbSep'} size="16px" />
      </span>
      <span class="rule-index">#{index + 1}</span>
      <span class="effect-badge" class:effect-badge--deny={rule.effect === 'deny'}>
        {$t(rule.effect === 'deny' ? 'files.cacl.effectDeny' : 'files.cacl.effectAllow')}
      </span>
      <code class="op-summary" title={opSetPreview}>{opSetPreview}</code>
      <span class="scope-badge">{$t(`files.cacl.scope.${rule.scope}`)}</span>
      <span class="subject-summary" title={subjectSummary}>{subjectSummary}</span>
      {#if timeState !== 'none'}
        <span class={`time-badge time-badge--${timeState}`}>
          {$t(`files.cacl.timeState.${timeState}`)}
        </span>
      {/if}
      {#if rule.remark}
        <span class="remark-summary" title={rule.remark}>“{rule.remark}”</span>
      {/if}
    </button>

    <div class="rule-header-actions">
      <FluentButton
        data-fluent-owner="cacl-rule-card"
        type="button"
        appearance="subtle"
        class="rule-action-btn"
        disabled={disabled}
        title={$t('files.cacl.duplicateRule')}
        aria-label={$t('files.cacl.duplicateRule')}
        iconOnly
        onclick={onDuplicate}
      >
        <Icon name="contentCopy" size="16px" />
      </FluentButton>
      <FluentButton
        data-fluent-owner="cacl-rule-card"
        type="button"
        appearance="subtle"
        tone="danger"
        class="rule-action-btn rule-action-btn--danger"
        disabled={disabled}
        title={$t('files.cacl.deleteRule')}
        aria-label={$t('files.cacl.deleteRule')}
        iconOnly
        onclick={onRemove}
      >
        <Icon name="delete" size="16px" />
      </FluentButton>
    </div>
  </header>

  {#if expanded}
    <div class="rule-body">
      <div class="rule-section rule-section--grid">
        <div class="control-block">
          <span class="block-label">{$t('files.cacl.effectLabel')}</span>
          <div class="segmented-group" role="group" aria-label={$t('files.cacl.effectLabel')}>
            <button
              type="button"
              class="segment-btn"
              class:active={rule.effect === 'allow'}
              disabled={disabled}
              onclick={() => patch({ effect: 'allow' })}
            >
              {$t('files.cacl.effectAllow')}
            </button>
            <button
              type="button"
              class="segment-btn segment-btn--deny"
              class:active={rule.effect === 'deny'}
              disabled={disabled}
              onclick={() => patch({ effect: 'deny' })}
            >
              {$t('files.cacl.effectDeny')}
            </button>
          </div>
        </div>

        <div class="control-block">
          <label class="block-label" for={`${fieldPrefix}-scope`}>{$t('files.cacl.scopeLabel')}</label>
          <select
            id={`${fieldPrefix}-scope`}
            class="cfms-native-field scope-select"
            value={rule.scope}
            disabled={disabled}
            onchange={(event) => patch({ scope: event.currentTarget.value as Scope })}
          >
            <option value="all">{$t('files.cacl.scopeDesc.all')}</option>
            <option value="self">{$t('files.cacl.scopeDesc.self')}</option>
            <option value="dirs" disabled={targetObjectType === 'document'}>
              {$t('files.cacl.scopeDesc.dirs')}
            </option>
            <option value="docs" disabled={targetObjectType === 'document'}>
              {$t('files.cacl.scopeDesc.docs')}
            </option>
          </select>
        </div>
      </div>

      <div class="rule-section">
        <div class="section-head">
          <span class="block-label">{$t('files.cacl.operationsLabel')}</span>
          <code class="op-preview-code">{opSetPreview}</code>
        </div>

        <div class="macro-grid">
          {#each CACL_PRESET_MACRO_ORDER as macroName (macroName)}
            {@const active = isMacroActive(macroName)}
            <button
              type="button"
              class="macro-chip"
              class:active
              disabled={disabled}
              title={PRESET_MACRO_DESCRIPTIONS[macroName]}
              aria-pressed={active}
              onclick={() => patch({ opItems: togglePresetMacroOnItems(rule.opItems, macroName) })}
            >
              <span>{macroName}</span>
            </button>
          {/each}
        </div>

        <button
          type="button"
          class="matrix-toggle"
          aria-expanded={showAtomicMatrix}
          onclick={() => { showAtomicMatrix = !showAtomicMatrix; }}
        >
          <Icon name={showAtomicMatrix ? 'expandLess' : 'expandMore'} size="15px" />
          <span>{$t(showAtomicMatrix ? 'files.cacl.hideAtomicOps' : 'files.cacl.showAtomicOps')}</span>
        </button>

        {#if showAtomicMatrix}
          <div class="atomic-groups">
            {#each CACL_OPERATION_GROUPS as group (group.id)}
              <div class="atomic-group">
                <span class="atomic-group-title">{$t(group.labelKey)}</span>
                <div class="atomic-op-list">
                  {#each group.ops as op (op.name)}
                    {@const state = atomicOpState(op.name, op.bit)}
                    <button
                      type="button"
                      class="atomic-chip"
                      class:atomic-chip--included={state === 'included'}
                      class:atomic-chip--subtracted={state === 'subtracted'}
                      disabled={disabled}
                      title={`${op.description} (${op.target})`}
                      aria-pressed={state === 'included'}
                      onclick={() => patch({ opItems: toggleAtomicOpOnItems(rule.opItems, op.name) })}
                    >
                      {#if state === 'subtracted'}-{/if}{op.name}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="rule-section">
        <div class="section-head">
          <span class="block-label">{$t('files.cacl.subjectLabel')}</span>
          <div class="segmented-group" role="group" aria-label={$t('files.cacl.subjectLabel')}>
            <button
              type="button"
              class="segment-btn"
              class:active={rule.match.kind === 'to'}
              disabled={disabled}
              onclick={() => setMatchMode('to')}
            >
              {$t('files.cacl.matchMode.to')}
            </button>
            <button
              type="button"
              class="segment-btn"
              class:active={rule.match.kind === 'any'}
              disabled={disabled}
              onclick={() => setMatchMode('any')}
            >
              {$t('files.cacl.matchMode.any')}
            </button>
            <button
              type="button"
              class="segment-btn"
              class:active={rule.match.kind === 'when'}
              disabled={disabled}
              onclick={() => setMatchMode('when')}
            >
              {$t('files.cacl.matchMode.when')}
            </button>
          </div>
        </div>

        {#if rule.match.kind === 'any'}
          <p class="section-hint">{$t('files.cacl.matchAnyHint')}</p>
        {:else if rule.match.kind === 'to'}
          {#if rule.match.principals.length === 0}
            <p class="section-hint">{$t('files.cacl.noPrincipalsHint')}</p>
          {:else}
            <div class="principal-pills">
              {#each rule.match.principals as principal, pIdx (`${principal.kind}:${principal.value}`)}
                <span class="principal-pill">
                  <Icon name={principal.kind === 'user' ? 'manageAccounts' : 'groups'} size="14px" />
                  <span title={principal.value}>{formatPrincipalLabel(principal)}</span>
                  <button
                    type="button"
                    class="pill-remove"
                    disabled={disabled}
                    aria-label={$t('files.removeEntry')}
                    onclick={() => removePrincipal(pIdx)}
                  >
                    <Icon name="close" size="13px" />
                  </button>
                </span>
              {/each}
            </div>
          {/if}
          <CaclPrincipalPicker
            {directory}
            {canListUsers}
            {canListGroups}
            {disabled}
            onAdd={addPrincipal}
          />
        {:else}
          <div class="when-editor">
            <MdOutlinedField inputId={`${fieldPrefix}-when`} label={$t('files.cacl.whenExpressionLabel')} {disabled}>
              <input
                id={`${fieldPrefix}-when`}
                class="cfms-native-field mono-input"
                data-focus-ring="delegated"
                value={rule.match.expression}
                disabled={disabled}
                placeholder='group("editors") and not perm("bypass_dacl")'
                oninput={(event) => patch({
                  match: { kind: 'when', expression: event.currentTarget.value },
                })}
              />
            </MdOutlinedField>
            <div class="when-chips">
              {#each ['and', 'or', 'not', 'user("")', 'group("")', 'perm("")'] as token (token)}
                <button
                  type="button"
                  class="when-chip"
                  disabled={disabled}
                  onclick={() => insertWhenSnippet(token)}
                >
                  <code>{token}</code>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="rule-section rule-section--grid">
        <div class="control-block">
          <MdOutlinedField inputId={`${fieldPrefix}-from`} label={$t('files.cacl.validFrom')} {disabled}>
            <input
              id={`${fieldPrefix}-from`}
              type="datetime-local"
              step="1"
              class="cfms-native-field"
              data-focus-ring="delegated"
              value={fromLocalValue}
              disabled={disabled}
              onchange={(event) => patch({
                validFrom: localInputToRfc3339Utc(event.currentTarget.value),
              })}
            />
            {#snippet end()}
              {#if rule.validFrom}
                <button
                  type="button"
                  class="field-clear-btn"
                  disabled={disabled}
                  title={$t('common.clear')}
                  aria-label={$t('common.clear')}
                  onclick={() => patch({ validFrom: null })}
                >
                  <Icon name="close" size="15px" />
                </button>
              {/if}
            {/snippet}
          </MdOutlinedField>
        </div>

        <div class="control-block">
          <MdOutlinedField inputId={`${fieldPrefix}-until`} label={$t('files.cacl.validUntil')} {disabled}>
            <input
              id={`${fieldPrefix}-until`}
              type="datetime-local"
              step="1"
              class="cfms-native-field"
              data-focus-ring="delegated"
              value={untilLocalValue}
              disabled={disabled}
              onchange={(event) => patch({
                validUntil: localInputToRfc3339Utc(event.currentTarget.value),
              })}
            />
            {#snippet end()}
              {#if rule.validUntil}
                <button
                  type="button"
                  class="field-clear-btn"
                  disabled={disabled}
                  title={$t('common.clear')}
                  aria-label={$t('common.clear')}
                  onclick={() => patch({ validUntil: null })}
                >
                  <Icon name="close" size="15px" />
                </button>
              {/if}
            {/snippet}
          </MdOutlinedField>
        </div>

        <div class="duration-presets">
          <span class="block-label">{$t('files.cacl.quickUntil')}</span>
          <div class="duration-chips">
            {#each [
              { label: '+1h', seconds: 3_600 },
              { label: '+24h', seconds: 86_400 },
              { label: '+7d', seconds: 604_800 },
              { label: '+30d', seconds: 2_592_000 },
            ] as preset (preset.label)}
              <button
                type="button"
                class="when-chip"
                disabled={disabled}
                onclick={() => patch({
                  validUntil: addDurationRfc3339Utc(rule.validFrom, preset.seconds),
                })}
              >
                {preset.label}
              </button>
            {/each}
          </div>
          {#if rule.effect === 'deny' && rule.validUntil}
            <p class="warning-hint">
              <span class="cfms-icon-text__icon"><Icon name="warning" size="14px" /></span>
              <span>{$t('files.cacl.tempDenyWarning')}</span>
            </p>
          {/if}
        </div>
      </div>

      <div class="rule-section">
        <MdOutlinedField inputId={`${fieldPrefix}-remark`} label={$t('files.cacl.remarkLabel')} {disabled}>
          <input
            id={`${fieldPrefix}-remark`}
            type="text"
            class="cfms-native-field"
            data-focus-ring="delegated"
            value={rule.remark ?? ''}
            disabled={disabled}
            placeholder={$t('files.cacl.remarkPlaceholder')}
            oninput={(event) => patch({
              remark: event.currentTarget.value || null,
            })}
          />
        </MdOutlinedField>
      </div>
    </div>
  {/if}
</article>

<style>
  .rule-card {
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusLarge, 8px);
    background: var(--colorNeutralBackground1);
    overflow: hidden;
  }

  .rule-card--deny {
    border-color: color-mix(in srgb, var(--colorStatusDangerBorder1) 70%, var(--colorNeutralStroke1));
  }

  .rule-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--colorNeutralBackground2);
  }

  .rule-toggle {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 4px;
    border-radius: var(--borderRadiusMedium, 4px);
    text-align: left;
    color: var(--colorNeutralForeground1);
    cursor: pointer;
  }

  .rule-toggle:hover {
    background: var(--colorSubtleBackgroundHover);
  }

  .rule-chevron {
    display: inline-flex;
    color: var(--colorNeutralForeground3);
  }

  .rule-index {
    color: var(--colorNeutralForeground3);
    font: 600 12px/16px var(--fontFamilyMonospace);
    font-variant-numeric: tabular-nums;
  }

  .effect-badge,
  .scope-badge,
  .time-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 999px;
    font: 600 12px/16px var(--fontFamilyBase);
  }

  .effect-badge {
    background: var(--colorBrandBackground2);
    color: var(--colorBrandForeground2);
  }

  .effect-badge--deny {
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
  }

  .scope-badge {
    border: 1px solid var(--colorNeutralStroke2);
    background: var(--colorNeutralBackground1);
    color: var(--colorNeutralForeground2);
    font-weight: 400;
  }

  .op-summary {
    max-width: 28ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 500 12px/16px var(--fontFamilyMonospace);
    color: var(--colorNeutralForeground1);
  }

  .subject-summary,
  .remark-summary {
    max-width: 26ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 400 12px/16px var(--fontFamilyBase);
    color: var(--colorNeutralForeground2);
  }

  .remark-summary {
    color: var(--colorNeutralForeground3);
    font-style: italic;
  }

  .time-badge--active {
    background: var(--colorStatusSuccessBackground1);
    color: var(--colorStatusSuccessForeground1);
  }

  .time-badge--scheduled {
    background: var(--colorBrandBackground2);
    color: var(--colorBrandForeground2);
  }

  .time-badge--expired,
  .time-badge--invalid {
    background: var(--colorStatusWarningBackground1);
    color: var(--colorStatusWarningForeground2);
  }

  .rule-header-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
  }

  :global(.rule-action-btn[data-fluent-owner="cacl-rule-card"]) {
    min-width: 32px;
    min-height: 32px;
    border-radius: var(--borderRadiusMedium, 4px);
    color: var(--colorNeutralForeground2);
  }

  :global(.rule-action-btn[data-fluent-owner="cacl-rule-card"]:hover:not(:is(:disabled, [disabled]))) {
    background: var(--colorSubtleBackgroundHover);
    color: var(--colorNeutralForeground1);
  }

  :global(.rule-action-btn--danger[data-fluent-owner="cacl-rule-card"]:hover:not(:is(:disabled, [disabled]))) {
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
  }

  .rule-body {
    display: grid;
    gap: 16px;
    padding: 16px;
    border-top: 1px solid var(--colorNeutralStroke2);
  }

  .rule-section {
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .rule-section--grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px 16px;
    align-items: start;
  }

  .control-block {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .block-label {
    color: var(--colorNeutralForeground2);
    font: 600 12px/16px var(--fontFamilyBase);
  }

  .section-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .op-preview-code {
    padding: 2px 8px;
    border-radius: var(--borderRadiusMedium, 4px);
    background: var(--colorNeutralBackground2);
    color: var(--colorNeutralForeground2);
    font: 400 12px/16px var(--fontFamilyMonospace);
    overflow-wrap: anywhere;
  }

  .segmented-group {
    display: inline-flex;
    width: fit-content;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium, 4px);
    overflow: hidden;
    background: var(--colorNeutralBackground2);
  }

  .segment-btn {
    min-height: 30px;
    padding: 4px 12px;
    font: 400 13px/18px var(--fontFamilyBase);
    color: var(--colorNeutralForeground2);
    cursor: pointer;
    transition: background-color 120ms ease, color 120ms ease;
  }

  .segment-btn + .segment-btn {
    border-left: 1px solid var(--colorNeutralStroke2);
  }

  .segment-btn:hover:not(:disabled) {
    background: var(--colorSubtleBackgroundHover);
    color: var(--colorNeutralForeground1);
  }

  .segment-btn.active {
    background: var(--colorBrandBackground);
    color: var(--colorNeutralForegroundOnBrand);
    font-weight: 600;
  }

  .segment-btn--deny.active {
    background: var(--colorStatusDangerBackground3);
    color: var(--colorNeutralForegroundStaticInverted);
  }

  .scope-select {
    min-height: var(--cfms-control-height-medium, 32px);
    width: 100%;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium, 4px);
    padding-inline: 8px;
    background: var(--colorNeutralBackground1);
    color: var(--colorNeutralForeground1);
    font: 400 13px/20px var(--fontFamilyBase);
  }

  .macro-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .macro-chip,
  .atomic-chip,
  .when-chip {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 4px 10px;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium, 4px);
    background: var(--colorNeutralBackground2);
    color: var(--colorNeutralForeground1);
    font: 500 12px/16px var(--fontFamilyMonospace);
    cursor: pointer;
    transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
  }

  .macro-chip:hover:not(:disabled),
  .atomic-chip:hover:not(:disabled),
  .when-chip:hover:not(:disabled) {
    background: var(--colorSubtleBackgroundHover);
  }

  .macro-chip.active,
  .atomic-chip--included {
    border-color: var(--colorCompoundBrandStroke);
    background: var(--colorBrandBackground2);
    color: var(--colorBrandForeground2);
    font-weight: 600;
  }

  .atomic-chip--subtracted {
    border-color: var(--colorStatusDangerBorder1);
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
    font-weight: 600;
  }

  .matrix-toggle {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: var(--borderRadiusMedium, 4px);
    color: var(--colorBrandForegroundLink);
    font: 600 12px/16px var(--fontFamilyBase);
    cursor: pointer;
  }

  .matrix-toggle:hover {
    background: var(--colorSubtleBackgroundHover);
  }

  .atomic-groups {
    display: grid;
    gap: 12px;
    padding: 12px;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: var(--borderRadiusMedium, 4px);
    background: var(--colorNeutralBackground2);
  }

  .atomic-group {
    display: grid;
    gap: 6px;
  }

  .atomic-group-title {
    color: var(--colorNeutralForeground3);
    font: 600 11px/16px var(--fontFamilyBase);
  }

  .atomic-op-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .section-hint {
    margin: 0;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .principal-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .principal-pill {
    display: inline-flex;
    max-width: 100%;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: 999px;
    background: var(--colorNeutralBackground2);
    color: var(--colorNeutralForeground1);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .pill-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    padding: 2px;
    color: var(--colorNeutralForeground3);
    cursor: pointer;
  }

  .pill-remove:hover:not(:disabled) {
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
  }

  .when-editor {
    display: grid;
    gap: 8px;
    padding-top: 6px;
  }

  .mono-input {
    width: 100%;
    font: 400 13px/18px var(--fontFamilyMonospace);
  }

  .when-chips,
  .duration-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .duration-presets {
    grid-column: 1 / -1;
    display: grid;
    gap: 6px;
  }

  .field-clear-btn {
    color: var(--colorNeutralForeground3);
    cursor: pointer;
  }

  .field-clear-btn:hover:not(:disabled) {
    color: var(--colorNeutralForeground1);
  }

  .warning-hint {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 2px 0 0;
    color: var(--colorStatusWarningForeground2);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .warning-hint .cfms-icon-text__icon {
    color: var(--colorStatusWarningForeground1);
  }

  @media (pointer: coarse) {
    .segment-btn,
    .macro-chip,
    .atomic-chip,
    .when-chip,
    .scope-select {
      min-height: 44px;
    }

    :global(.rule-action-btn[data-fluent-owner="cacl-rule-card"]) {
      min-width: 44px;
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .segment-btn,
    .macro-chip,
    .atomic-chip,
    .when-chip {
      transition: none;
    }
  }
</style>
