<script lang="ts">
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { _ as t } from 'svelte-i18n';
  import type { ObjectType } from 'codemirror-lang-cacl';
  import { isReducedMotionEnabled } from '#lib/shared/appearance.ts';
  import { inlineNotice } from '#lib/shared/motion/transitions.ts';
  import FluentButton from '#lib/shared/ui/FluentButton.svelte';
  import Icon from '#lib/shared/ui/Icon.svelte';
  import CaclRuleCard from './CaclRuleCard.svelte';
  import type { CaclPrincipalDirectory } from './cacl-editor-extensions';
  import { createCaclRuleId, createDefaultCaclRule, type CaclPolicyDocument, type CaclVisualRule } from './cacl-model';
  import { CACL_RULE_TEMPLATES } from './cacl-presets';

  interface Props {
    document: CaclPolicyDocument;
    targetObjectType?: ObjectType | null;
    directory: CaclPrincipalDirectory;
    canListUsers?: boolean;
    canListGroups?: boolean;
    disabled?: boolean;
    expandedRuleId?: string | null;
    onExpandedChange?: (id: string | null) => void;
    onChange: (next: CaclPolicyDocument) => void;
  }

  let {
    document,
    targetObjectType = null,
    directory,
    canListUsers = false,
    canListGroups = false,
    disabled = false,
    expandedRuleId = null,
    onExpandedChange,
    onChange,
  }: Props = $props();

  let selectedTemplateId = $state(CACL_RULE_TEMPLATES[0].id);

  const allowCount = $derived(document.rules.filter((r) => r.effect === 'allow').length);
  const denyCount = $derived(document.rules.length - allowCount);

  function addRule(rule: CaclVisualRule) {
    if (disabled) return;
    onChange({
      ...document,
      rules: [...document.rules, rule],
    });
    onExpandedChange?.(rule.id);
  }

  function addBlankRule(effect: 'allow' | 'deny' = 'allow') {
    const scope = targetObjectType === 'document' ? 'self' : 'all';
    const opItems = targetObjectType === 'document'
      ? [{ name: 'READ_CONTENT', subtract: false }, { name: 'READ_METADATA', subtract: false }]
      : [{ name: 'PRESET_READ', subtract: false }];
    addRule(createDefaultCaclRule({ effect, scope, opItems }));
  }

  function insertSelectedTemplate() {
    const template = CACL_RULE_TEMPLATES.find((item) => item.id === selectedTemplateId);
    if (!template) return;
    addRule(template.buildRule(targetObjectType));
  }

  function updateRule(index: number, nextRule: CaclVisualRule) {
    if (disabled) return;
    const nextRules = [...document.rules];
    nextRules[index] = nextRule;
    onChange({ ...document, rules: nextRules });
  }

  function duplicateRule(index: number) {
    if (disabled) return;
    const source = document.rules[index];
    if (!source) return;
    const copy: CaclVisualRule = {
      ...structuredClone(source),
      id: createCaclRuleId(),
    };
    const nextRules = [...document.rules];
    nextRules.splice(index + 1, 0, copy);
    onChange({ ...document, rules: nextRules });
    onExpandedChange?.(copy.id);
  }

  function removeRule(index: number) {
    if (disabled) return;
    const target = document.rules[index];
    onChange({
      ...document,
      rules: document.rules.filter((_, i) => i !== index),
    });
    if (target && expandedRuleId === target.id) {
      onExpandedChange?.(null);
    }
  }
</script>

<div class="visual-editor">
  <div class="visual-toolbar">
    <p class="rule-stats">
      {$t('files.cacl.ruleSummary', {
        values: {
          total: document.rules.length,
          allow: allowCount,
          deny: denyCount,
        },
      })}
    </p>

    <div class="toolbar-actions">
      <div class="template-group">
        <select
          class="cfms-native-field template-select"
          bind:value={selectedTemplateId}
          disabled={disabled}
          aria-label={$t('files.cacl.templatePicker')}
        >
          {#each CACL_RULE_TEMPLATES as template (template.id)}
            <option value={template.id}>{$t(template.labelKey)}</option>
          {/each}
        </select>
        <FluentButton
          data-fluent-owner="cacl-visual-editor"
          type="button"
          appearance="subtle"
          class="toolbar-btn toolbar-btn--secondary"
          disabled={disabled}
          onclick={insertSelectedTemplate}
        >
          <Icon name="wandStars" size="16px" />
          {$t('files.cacl.insertTemplate')}
        </FluentButton>
      </div>

      <FluentButton
        data-fluent-owner="cacl-visual-editor"
        type="button"
        appearance="primary"
        class="toolbar-btn toolbar-btn--primary"
        disabled={disabled}
        onclick={() => addBlankRule('allow')}
      >
        <Icon name="add" size="16px" />
        {$t('files.cacl.addRule')}
      </FluentButton>
    </div>
  </div>

  {#if document.rules.length === 0}
    <div class="empty-policy" class:empty-policy--warn={!document.inherit} transition:inlineNotice>
      <Icon name={document.inherit ? 'info' : 'warning'} size="24px" />
      <div class="empty-copy">
        <h4>
          {$t(document.inherit ? 'files.cacl.emptyInheritTitle' : 'files.cacl.emptyDefaultDenyTitle')}
        </h4>
        <p>
          {$t(document.inherit ? 'files.cacl.emptyInheritBody' : 'files.cacl.emptyDefaultDenyBody')}
        </p>
      </div>
      <div class="empty-actions">
        <FluentButton
          data-fluent-owner="cacl-visual-editor"
          type="button"
          appearance="primary"
          class="toolbar-btn toolbar-btn--primary"
          disabled={disabled}
          onclick={() => addBlankRule('allow')}
        >
          <Icon name="add" size="16px" />
          {$t('files.cacl.addAllowRule')}
        </FluentButton>
        <FluentButton
          data-fluent-owner="cacl-visual-editor"
          type="button"
          appearance="subtle"
          class="toolbar-btn toolbar-btn--secondary"
          disabled={disabled}
          onclick={() => addBlankRule('deny')}
        >
          <Icon name="block" size="16px" />
          {$t('files.cacl.addDenyRule')}
        </FluentButton>
      </div>
    </div>
  {:else}
    <div class="rules-list">
      {#each document.rules as rule, idx (rule.id)}
        <div
          class="rule-list-item"
          animate:flip={{ duration: isReducedMotionEnabled() ? 0 : 220, easing: cubicOut }}
          transition:inlineNotice
        >
          <CaclRuleCard
            {rule}
            index={idx}
            expanded={expandedRuleId === rule.id}
            {targetObjectType}
            {directory}
            userHints={document.userHints}
            {canListUsers}
            {canListGroups}
            {disabled}
            onToggleExpand={() => onExpandedChange?.(expandedRuleId === rule.id ? null : rule.id)}
            onChange={(nextRule) => updateRule(idx, nextRule)}
            onDuplicate={() => duplicateRule(idx)}
            onRemove={() => removeRule(idx)}
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .visual-editor {
    display: grid;
    gap: 16px;
  }

  .visual-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .rule-stats {
    margin: 0;
    color: var(--colorNeutralForeground2);
    font: 400 13px/18px var(--fontFamilyBase);
  }

  .toolbar-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .template-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .template-select {
    min-height: var(--cfms-control-height-medium, 32px);
    max-width: 16rem;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium, 4px);
    padding-inline: 8px;
    background: var(--colorNeutralBackground1);
    color: var(--colorNeutralForeground1);
    font: 400 13px/20px var(--fontFamilyBase);
  }

  :global(.toolbar-btn[data-fluent-owner="cacl-visual-editor"]) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--cfms-control-height-medium, 32px);
    border-radius: var(--borderRadiusMedium, 4px);
    padding: 4px 12px;
    font: 600 13px/18px var(--fontFamilyBase);
  }

  :global(.toolbar-btn--primary[data-fluent-owner="cacl-visual-editor"]) {
    background: var(--colorBrandBackground);
    color: var(--colorNeutralForegroundOnBrand);
  }

  :global(.toolbar-btn--secondary[data-fluent-owner="cacl-visual-editor"]) {
    border: 1px solid var(--colorNeutralStroke1);
    background: var(--colorNeutralBackground2);
    color: var(--colorNeutralForeground1);
  }

  .empty-policy {
    display: grid;
    justify-items: center;
    gap: 12px;
    padding: 28px 20px;
    border: 1px dashed var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusLarge, 8px);
    background: var(--colorNeutralBackground2);
    color: var(--colorNeutralForeground2);
    text-align: center;
    transition:
      border-color var(--durationNormal, 200ms) var(--curveEasyEase, ease),
      background-color var(--durationNormal, 200ms) var(--curveEasyEase, ease),
      color var(--durationNormal, 200ms) var(--curveEasyEase, ease);
  }

  .empty-policy--warn {
    border-color: var(--colorStatusWarningBorder1);
    background: var(--colorStatusWarningBackground1);
    color: var(--colorStatusWarningForeground2);
  }

  .empty-copy {
    display: grid;
    gap: 4px;
    max-width: 56ch;
  }

  .empty-copy h4 {
    margin: 0;
    color: var(--colorNeutralForeground1);
    font: 600 14px/20px var(--fontFamilyBase);
  }

  .empty-copy p {
    margin: 0;
    font: 400 13px/18px var(--fontFamilyBase);
  }

  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .rules-list {
    display: grid;
    gap: 10px;
  }

  .rule-list-item {
    min-width: 0;
  }

  @media (pointer: coarse) {
    .template-select,
    :global(.toolbar-btn[data-fluent-owner="cacl-visual-editor"]) {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .empty-policy {
      transition: none;
    }
  }
</style>
