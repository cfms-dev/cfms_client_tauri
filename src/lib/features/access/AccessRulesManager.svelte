<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { fly, scale } from 'svelte/transition';
  import { _ as t } from 'svelte-i18n';
  import { analyzeCacl, type CaclDiagnostic, type ObjectType } from 'codemirror-lang-cacl';
  import { listGroups, listUsers } from '#lib/api.ts';
  import type { ServerCaclDiagnostic } from '#lib/api/types.ts';
  import { isReducedMotionEnabled } from '#lib/shared/appearance.ts';
  import { inlineNotice } from '#lib/shared/motion/transitions.ts';
  import DialogActionButton from '#lib/shared/ui/DialogActionButton.svelte';
  import FluentButton from '#lib/shared/ui/FluentButton.svelte';
  import Icon from '#lib/shared/ui/Icon.svelte';
  import MdSwitch from '#lib/shared/ui/MdSwitch.svelte';
  import ProgressRing from '#lib/shared/ui/ProgressRing.svelte';
  import CaclCodeEditor from './CaclCodeEditor.svelte';
  import CaclPrincipalPicker from './CaclPrincipalPicker.svelte';
  import CaclVisualEditor from './CaclVisualEditor.svelte';
  import { formatCaclSource } from './cacl-formatter';
  import type { CaclPrincipalDirectory } from './cacl-editor-extensions';
  import {
    DACL_SOURCE_MAX_LENGTH,
    DACL_SOURCE_WARN_REMAINING,
    escapeCaclString,
    extractUserAnnotations,
    parseCaclToModel,
    serializeModelToCacl,
    setInheritDirectiveInSource,
    type CaclPolicyDocument,
    type CaclPrincipalRef,
  } from './cacl-model';
  import { CACL_RULE_TEMPLATES } from './cacl-presets';

  export interface CaclDraftState {
    dacl: string;
    inherit: boolean;
    hasErrors: boolean;
    ruleCount: number;
  }

  interface Props {
    dacl: string;
    annotatedDacl?: string | null;
    targetObjectType?: ObjectType | null;
    serverDiagnostics?: readonly ServerCaclDiagnostic[];
    canListUsers?: boolean;
    canListGroups?: boolean;
    saving?: boolean;
    submitLabel?: string;
    submitDisabled?: boolean;
    resetRevision?: number;
    footer?: Snippet<[submit: (intent?: 'ok' | 'apply') => Promise<void>]>;
    onEdit?: () => void;
    onDraftChange?: (draft: CaclDraftState | null) => void;
    onSave: (dacl: string, intent?: 'ok' | 'apply') => Promise<void> | void;
    onCancel: () => void;
  }

  let {
    dacl,
    annotatedDacl = null,
    targetObjectType = null,
    serverDiagnostics = [],
    canListUsers = false,
    canListGroups = false,
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
  let hasSwitchedView = $state(false);
  let sourceText = $state('');
  let visualDoc = $state<CaclPolicyDocument>({ inherit: true, rules: [], userHints: {} });
  let expandedRuleId = $state<string | null>(null);
  let switchError = $state<string | null>(null);
  let showDiagnosticsPanel = $state(false);
  let showPrincipalInsert = $state(false);
  let annotateUsersInCode = $state(false);
  let selectedCodeTemplateId = $state(CACL_RULE_TEMPLATES[0].id);
  let directory = $state<CaclPrincipalDirectory>({ users: [], groups: [] });
  let codeEditorRef = $state<{
    insertAtCursor: (text: string) => void;
    focusRange: (from: number, to: number) => void;
  } | undefined>();
  let incomingDraftKey: string | null = null;

  onMount(() => {
    if (canListUsers) {
      void listUsers().then((users) => {
        directory = { ...directory, users };
      }).catch(() => {});
    }
    if (canListGroups) {
      void listGroups().then((groups) => {
        directory = { ...directory, groups };
      }).catch(() => {});
    }
  });

  $effect(() => {
    const nextKey = JSON.stringify([dacl, annotatedDacl ?? '', resetRevision]);
    if (incomingDraftKey === nextKey) return;
    incomingDraftKey = nextKey;

    const initialText = annotatedDacl && annotatedDacl.trim() ? annotatedDacl : dacl;
    const hints = extractUserAnnotations(initialText);
    const parsed = parseCaclToModel(dacl || 'inherit on;\n');
    annotateUsersInCode = Boolean(annotatedDacl && annotatedDacl.includes('# @'));

    if (parsed.ok) {
      visualDoc = {
        ...parsed.document,
        userHints: { ...hints, ...parsed.document.userHints },
      };
      sourceText = annotateUsersInCode && annotatedDacl ? annotatedDacl : serializeModelToCacl(visualDoc);
      expandedRuleId = visualDoc.rules[0]?.id ?? null;
      if (activeView === 'source' && !annotateUsersInCode) {
        sourceText = serializeModelToCacl(visualDoc);
      }
      switchError = null;
    } else {
      sourceText = initialText;
      activeView = 'source';
      switchError = null;
    }
  });

  const liveAnalysis = $derived(analyzeCacl(sourceText, {
    targetObjectType,
    includeWarnings: true,
  }));

  const clientErrors = $derived(liveAnalysis.diagnostics.filter((d) => d.severity === 'error'));
  const clientWarnings = $derived(liveAnalysis.diagnostics.filter((d) => d.severity === 'warning'));
  const remainingChars = $derived(DACL_SOURCE_MAX_LENGTH - sourceText.length);
  const showCharCounter = $derived(remainingChars <= DACL_SOURCE_WARN_REMAINING);
  const lengthExceeded = $derived(sourceText.length > DACL_SOURCE_MAX_LENGTH);
  const hasErrors = $derived(clientErrors.length > 0 || lengthExceeded);
  const totalDiagnosticItems = $derived(liveAnalysis.diagnostics.length + serverDiagnostics.length);
  const hasDiagnosticItems = $derived(totalDiagnosticItems > 0);
  const showDiagnosticsBar = $derived(lengthExceeded || showCharCounter || hasDiagnosticItems);

  $effect(() => {
    if (!hasDiagnosticItems) {
      showDiagnosticsPanel = false;
    }
  });

  const currentInherit = $derived.by(() => {
    if (activeView === 'visual') return visualDoc.inherit;
    const parsed = parseCaclToModel(sourceText);
    return parsed.ok ? parsed.document.inherit : true;
  });

  $effect(() => {
    const notify = onDraftChange;
    if (!notify) return;
    const text = sourceText;
    const errors = hasErrors;
    const inherit = currentInherit;
    const ruleCount = activeView === 'visual' ? visualDoc.rules.length : liveAnalysis.ruleMetas.length;
    untrack(() => notify(errors
      ? null
      : { dacl: text, inherit, hasErrors: false, ruleCount }));
  });

  function updateFromVisual(nextDoc: CaclPolicyDocument) {
    if (saving) return;
    onEdit?.();
    visualDoc = nextDoc;
    sourceText = serializeModelToCacl(nextDoc, {
      annotateUsers: annotateUsersInCode,
    });
    switchError = null;
  }

  function toggleInherit(nextInherit: boolean) {
    if (saving) return;
    onEdit?.();
    if (activeView === 'visual') {
      updateFromVisual({ ...visualDoc, inherit: nextInherit });
    } else {
      sourceText = setInheritDirectiveInSource(sourceText, nextInherit);
    }
  }

  function changeSource(nextSource: string) {
    if (saving) return;
    onEdit?.();
    sourceText = nextSource;
    switchError = null;
  }

  function selectView(view: 'visual' | 'source') {
    if (saving || view === activeView) return;
    if (view === 'visual') {
      const parsed = parseCaclToModel(sourceText);
      if (!parsed.ok) {
        switchError = $t('files.cacl.cannotSwitchToVisual', { values: { error: parsed.error } });
        showDiagnosticsPanel = true;
        return;
      }
      visualDoc = {
        ...parsed.document,
        userHints: { ...visualDoc.userHints, ...parsed.document.userHints },
      };
      expandedRuleId = visualDoc.rules[0]?.id ?? null;
      switchError = null;
    } else {
      sourceText = serializeModelToCacl(visualDoc, {
        annotateUsers: annotateUsersInCode,
      });
      switchError = null;
    }
    hasSwitchedView = true;
    activeView = view;
  }

  function formatSource() {
    if (saving) return;
    const formatted = formatCaclSource(sourceText);
    if (!formatted.ok) {
      switchError = formatted.error;
      showDiagnosticsPanel = true;
      return;
    }
    if (formatted.text !== sourceText) {
      onEdit?.();
      sourceText = formatted.text;
    }
    switchError = null;
  }

  function toggleAnnotateUsers(nextChecked: boolean) {
    annotateUsersInCode = nextChecked;
    const parsed = parseCaclToModel(sourceText);
    if (!parsed.ok) return;
    sourceText = serializeModelToCacl(
      {
        ...parsed.document,
        userHints: { ...visualDoc.userHints, ...parsed.document.userHints },
      },
      { annotateUsers: nextChecked },
    );
  }

  function insertPrincipalSnippet(principal: CaclPrincipalRef) {
    const snippet = `${principal.kind}(${escapeCaclString(principal.value)})`;
    codeEditorRef?.insertAtCursor(snippet);
    showPrincipalInsert = false;
  }

  function insertCodeTemplate() {
    const tpl = CACL_RULE_TEMPLATES.find((item) => item.id === selectedCodeTemplateId);
    if (!tpl) return;
    const snippet = tpl.snippet(targetObjectType);
    const prefix = sourceText.endsWith('\n') || sourceText.length === 0 ? '' : '\n';
    codeEditorRef?.insertAtCursor(`${prefix}${snippet}\n`);
  }

  function jumpToDiagnostic(diag: CaclDiagnostic) {
    if (activeView !== 'source') {
      selectView('source');
    }
    queueMicrotask(() => {
      codeEditorRef?.focusRange(diag.from, diag.to);
    });
  }

  async function submitPolicy(intent?: 'ok' | 'apply') {
    if (saving || submitDisabled || hasErrors) return;
    const payload = activeView === 'visual'
      ? serializeModelToCacl(visualDoc, { annotateUsers: false })
      : sourceText;
    if (intent) {
      await onSave(payload, intent);
    } else {
      await onSave(payload);
    }
  }
</script>

<div class="dacl-manager">
  <div class="dacl-main" inert={saving} aria-busy={saving}>
    <header class="dacl-topbar">
      <div class="view-tabs" role="tablist" aria-label={$t('files.cacl.editorMode')}>
        <FluentButton
          data-fluent-owner="cacl-access-manager"
          type="button"
          role="tab"
          aria-selected={activeView === 'visual'}
          appearance="subtle"
          disabled={saving}
          class={'mode-tab ' + (activeView === 'visual' ? 'mode-tab--active' : '')}
          onclick={() => selectView('visual')}
        >
          <Icon name="rule" size="16px" />
          <span>{$t('files.accessRulesVisualization')}</span>
        </FluentButton>

        <FluentButton
          data-fluent-owner="cacl-access-manager"
          type="button"
          role="tab"
          aria-selected={activeView === 'source'}
          appearance="subtle"
          disabled={saving}
          class={'mode-tab ' + (activeView === 'source' ? 'mode-tab--active' : '')}
          onclick={() => selectView('source')}
        >
          <Icon name="code" size="16px" />
          <span>{$t('files.sourceCode')}</span>
          {#if clientErrors.length > 0}
            <span
              class="tab-badge tab-badge--error"
              transition:scale={{ start: 0.85, duration: isReducedMotionEnabled() ? 0 : 150, easing: cubicOut }}
            >{clientErrors.length}</span>
          {:else if clientWarnings.length + serverDiagnostics.length > 0}
            <span
              class="tab-badge tab-badge--warn"
              transition:scale={{ start: 0.85, duration: isReducedMotionEnabled() ? 0 : 150, easing: cubicOut }}
            >
              {clientWarnings.length + serverDiagnostics.length}
            </span>
          {/if}
        </FluentButton>
      </div>

      <div class="topbar-meta">
        {#if targetObjectType}
          <span class="target-pill">
            <Icon name={targetObjectType === 'directory' ? 'folder' : 'filePresent'} size="14px" />
            {$t(`files.${targetObjectType}`)}
          </span>
        {/if}

        <label class="inherit-switch" class:inherit-switch--off={!currentInherit}>
          <MdSwitch
            checked={currentInherit}
            disabled={saving}
            onChange={(checked) => toggleInherit(checked)}
            ariaLabel={$t('files.inheritParentRules')}
          />
          <span>{$t('files.inheritParentRules')}</span>
        </label>
      </div>
    </header>

    {#if switchError}
      <div class="banner-alert" role="alert" transition:inlineNotice>
        <span class="cfms-icon-text__icon"><Icon name="errorFilled" size="16px" /></span>
        <span>{switchError}</span>
      </div>
    {/if}

    <div class="dacl-workspace" class:dacl-workspace--source={activeView === 'source'}>
      {#if activeView === 'visual'}
        <div
          class="visual-view-pane"
          in:fly={{ x: -10, duration: !hasSwitchedView || isReducedMotionEnabled() ? 0 : 180, easing: cubicOut }}
        >
          <CaclVisualEditor
            document={visualDoc}
            {targetObjectType}
            {directory}
            {canListUsers}
            {canListGroups}
            disabled={saving}
            {expandedRuleId}
            onExpandedChange={(id) => { expandedRuleId = id; }}
            onChange={updateFromVisual}
          />
        </div>
      {:else}
        <div
          class="source-pane"
          in:fly={{ x: 10, duration: !hasSwitchedView || isReducedMotionEnabled() ? 0 : 180, easing: cubicOut }}
        >
          <div class="source-toolbar">
            <div class="source-toolbar-left">
              <FluentButton
                data-fluent-owner="cacl-access-manager"
                type="button"
                appearance="subtle"
                class={'source-tool-btn ' + (showPrincipalInsert ? 'source-tool-btn--active' : '')}
                aria-expanded={showPrincipalInsert}
                disabled={saving}
                onclick={() => { showPrincipalInsert = !showPrincipalInsert; }}
              >
                <Icon name="manageAccounts" size="15px" />
                <span>{$t('files.cacl.insertPrincipal')}</span>
              </FluentButton>

              <span class="toolbar-divider" aria-hidden="true"></span>

              <div class="template-insert-group">
                <select
                  class="cfms-native-field code-template-select"
                  bind:value={selectedCodeTemplateId}
                  disabled={saving}
                  aria-label={$t('files.cacl.templatePicker')}
                >
                  {#each CACL_RULE_TEMPLATES as tpl (tpl.id)}
                    <option value={tpl.id}>{$t(tpl.labelKey)}</option>
                  {/each}
                </select>
                <FluentButton
                  data-fluent-owner="cacl-access-manager"
                  type="button"
                  appearance="subtle"
                  class="source-tool-btn"
                  disabled={saving}
                  onclick={insertCodeTemplate}
                >
                  <Icon name="add" size="15px" />
                  <span>{$t('files.cacl.insertTemplate')}</span>
                </FluentButton>
              </div>
            </div>

            <div class="source-toolbar-right">
              <label class="annotate-toggle">
                <MdSwitch
                  checked={annotateUsersInCode}
                  disabled={saving}
                  onChange={toggleAnnotateUsers}
                  ariaLabel={$t('files.cacl.annotateUsers')}
                />
                <span>{$t('files.cacl.annotateUsers')}</span>
              </label>
            </div>
          </div>

          {#if showPrincipalInsert}
            <div class="principal-popover" transition:inlineNotice>
              <CaclPrincipalPicker
                {directory}
                {canListUsers}
                {canListGroups}
                disabled={saving}
                onAdd={insertPrincipalSnippet}
              />
            </div>
          {/if}

          <div class="source-editor-wrap" class:has-error={hasErrors}>
            <CaclCodeEditor
              bind:this={codeEditorRef}
              value={sourceText}
              {targetObjectType}
              {serverDiagnostics}
              principalDirectory={directory}
              disabled={saving}
              ariaLabel={$t('files.accessRules')}
              loadingLabel={$t('files.accessRulesEditorLoading')}
              onChange={changeSource}
              onFormat={formatSource}
            />
          </div>

          <p class="source-help">{$t('files.ruleFormatHelp')}</p>
        </div>
      {/if}
    </div>

    {#if showDiagnosticsBar}
      <section class="diagnostics-bar" aria-live="polite" transition:inlineNotice>
        {#snippet diagnosticSummaryContent()}
          {#if lengthExceeded}
            <Icon name="errorFilled" size="15px" />
            <span class="diag-status diag-status--error">
              {$t('files.cacl.lengthExceeded', {
                values: { length: sourceText.length, max: DACL_SOURCE_MAX_LENGTH },
              })}
            </span>
          {:else if clientErrors.length > 0}
            <Icon name="errorFilled" size="15px" />
            <span class="diag-status diag-status--error">
              {$t('files.cacl.diagnosticsErrors', { values: { count: clientErrors.length } })}
            </span>
          {:else if clientWarnings.length + serverDiagnostics.length > 0}
            <Icon name="warning" size="15px" />
            <span class="diag-status diag-status--warn">
              {$t('files.cacl.diagnosticsWarnings', {
                values: { count: clientWarnings.length + serverDiagnostics.length },
              })}
            </span>
          {:else if showCharCounter}
            <Icon name="warning" size="15px" />
            <span class="diag-status diag-status--warn">
              {$t('files.cacl.lengthApproaching', {
                values: { remaining: Math.max(0, remainingChars) },
              })}
            </span>
          {:else}
            <Icon name="info" size="15px" />
            <span class="diag-status">
              {$t('files.cacl.diagnosticsWarnings', {
                values: { count: totalDiagnosticItems },
              })}
            </span>
          {/if}

          {#if showCharCounter}
            <span
              class="char-counter"
              class:char-counter--warn={!lengthExceeded}
              class:char-counter--error={lengthExceeded}
            >
              {sourceText.length} / {DACL_SOURCE_MAX_LENGTH}
            </span>
          {/if}

          {#if hasDiagnosticItems}
            <span class="diag-chevron" class:diag-chevron--open={showDiagnosticsPanel} aria-hidden="true">
              <Icon name="expandMore" size="15px" />
            </span>
          {/if}
        {/snippet}

        {#if hasDiagnosticItems}
          <button
            type="button"
            class="diagnostics-summary diagnostics-summary--interactive"
            aria-expanded={showDiagnosticsPanel}
            onclick={() => { showDiagnosticsPanel = !showDiagnosticsPanel; }}
          >
            {@render diagnosticSummaryContent()}
          </button>
        {:else}
          <div class="diagnostics-summary">
            {@render diagnosticSummaryContent()}
          </div>
        {/if}

        {#if showDiagnosticsPanel && hasDiagnosticItems}
          <ul class="diagnostics-list" transition:inlineNotice>
            {#each liveAnalysis.diagnostics as diag (`c:${diag.code}:${diag.from}:${diag.to}`)}
              <li>
                <button type="button" class="diag-row" onclick={() => jumpToDiagnostic(diag)}>
                  <span class={`diag-code diag-code--${diag.severity}`}>{diag.code}</span>
                  <span class="diag-msg">{diag.message}</span>
                </button>
              </li>
            {/each}
            {#each serverDiagnostics as sdiag (`s:${sdiag.code}:${sdiag.message}`)}
              <li class="diag-row diag-row--static">
                <span class={`diag-code diag-code--${sdiag.severity}`}>{sdiag.code}</span>
                <span class="diag-msg">{sdiag.message}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  </div>

  {#if footer}
    {@render footer(submitPolicy)}
  {:else}
    <footer class="dacl-footer">
      <DialogActionButton onclick={onCancel} disabled={saving}>
        {$t('common.cancel')}
      </DialogActionButton>
      <DialogActionButton
        variant="primary"
        onclick={() => submitPolicy()}
        disabled={saving || submitDisabled || hasErrors}
      >
        {#if saving}
          <ProgressRing size={17} strokeWidth={2.4} label={$t('common.loadingEllipsis')} />
          {$t('common.saving')}
        {:else}
          <Icon name="done" size="17px" />
          {submitLabel ?? $t('common.save')}
        {/if}
      </DialogActionButton>
    </footer>
  {/if}
</div>

<style>
  .dacl-manager {
    display: flex;
    height: 100%;
    min-height: 0;
    max-height: 78vh;
    flex-direction: column;
    overflow: hidden;
    color: var(--colorNeutralForeground1);
  }

  .dacl-main {
    position: relative;
    isolation: isolate;
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
  }

  .dacl-topbar {
    position: relative;
    z-index: 2;
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--colorNeutralStroke2);
  }

  .view-tabs {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  :global(.mode-tab[data-fluent-owner="cacl-access-manager"]) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 4px 12px;
    border-radius: var(--borderRadiusMedium, 4px);
    color: var(--colorNeutralForeground2);
    font: 400 13px/18px var(--fontFamilyBase);
    transition:
      background-color var(--durationFaster, 100ms) var(--curveEasyEase, ease),
      color var(--durationFaster, 100ms) var(--curveEasyEase, ease);
  }

  :global(.mode-tab[data-fluent-owner="cacl-access-manager"]:hover:not(:is(:disabled, [disabled]))) {
    background: var(--colorSubtleBackgroundHover);
    color: var(--colorNeutralForeground1);
  }

  :global(.mode-tab--active[data-fluent-owner="cacl-access-manager"]) {
    background: var(--colorBrandBackground2);
    color: var(--colorBrandForeground2);
    font-weight: 600;
  }

  .tab-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    font: 600 11px/14px var(--fontFamilyBase);
    font-variant-numeric: tabular-nums;
  }

  .tab-badge--error {
    background: var(--colorStatusDangerBackground3);
    color: var(--colorNeutralForegroundStaticInverted);
  }

  .tab-badge--warn {
    background: var(--colorStatusWarningBackground1);
    color: var(--colorStatusWarningForeground2);
  }

  .topbar-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  .target-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: 999px;
    background: var(--colorNeutralBackground2);
    color: var(--colorNeutralForeground2);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .inherit-switch {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--colorNeutralForeground1);
    font: 400 13px/18px var(--fontFamilyBase);
    cursor: pointer;
    transition: color var(--durationFast, 150ms) var(--curveEasyEase, ease);
  }

  .inherit-switch--off {
    color: var(--colorStatusWarningForeground2);
  }

  .banner-alert {
    position: relative;
    z-index: 2;
    flex: none;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 20px;
    border-bottom: 1px solid var(--colorStatusDangerBorder1);
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .dacl-workspace {
    min-height: 0;
    flex: 1;
    overflow: auto;
    padding: 16px 20px;
  }

  .visual-view-pane {
    min-width: 0;
  }

  .dacl-workspace--source {
    display: flex;
    flex-direction: column;
  }

  .source-pane {
    display: flex;
    flex-direction: column;
    flex: 1 0 auto;
    min-height: 100%;
    gap: 10px;
  }

  .source-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 12px;
    padding: 6px 10px;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: var(--borderRadiusMedium, 6px);
    background: var(--colorNeutralBackground2);
  }

  .source-toolbar-left {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .source-toolbar-right {
    display: flex;
    align-items: center;
    margin-inline-start: auto;
  }

  .toolbar-divider {
    width: 1px;
    height: 18px;
    background: var(--colorNeutralStroke2);
    flex: none;
  }

  .template-insert-group {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  :global(.source-tool-btn[data-fluent-owner="cacl-access-manager"]) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 4px 10px;
    border: 1px solid transparent;
    border-radius: var(--borderRadiusMedium, 4px);
    background: transparent;
    color: var(--colorNeutralForeground1);
    font: 400 12px/16px var(--fontFamilyBase);
    transition:
      background-color var(--durationFaster, 100ms) var(--curveEasyEase, ease),
      border-color var(--durationFaster, 100ms) var(--curveEasyEase, ease),
      color var(--durationFaster, 100ms) var(--curveEasyEase, ease);
  }

  :global(.source-tool-btn[data-fluent-owner="cacl-access-manager"]:hover:not(:is(:disabled, [disabled]))) {
    background: var(--colorSubtleBackgroundHover);
  }

  :global(.source-tool-btn--active[data-fluent-owner="cacl-access-manager"]) {
    background: var(--colorBrandBackground2);
    border-color: var(--colorBrandStroke2, transparent);
    color: var(--colorBrandForeground2);
    font-weight: 600;
  }

  .code-template-select {
    min-height: 32px;
    max-width: 14rem;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium, 4px);
    padding-inline: 8px;
    background: var(--colorNeutralBackground1);
    color: var(--colorNeutralForeground1);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .annotate-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--colorNeutralForeground2);
    font: 400 12px/16px var(--fontFamilyBase);
    cursor: pointer;
    white-space: nowrap;
  }

  .principal-popover {
    flex: none;
    padding: 12px;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusLarge, 8px);
    background: var(--colorNeutralBackground2);
  }

  .source-editor-wrap {
    display: flex;
    flex-direction: column;
    flex: 1 1 18rem;
    min-height: 14rem;
  }

  .source-editor-wrap :global(.cacl-code-editor) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 14rem;
    transition: border-color var(--durationFast, 150ms) var(--curveEasyEase, ease);
  }

  .source-editor-wrap :global(.cacl-code-editor > div:first-child),
  .source-editor-wrap :global(.cm-editor) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 14rem;
    height: 100%;
  }

  .source-editor-wrap :global(.cm-scroller) {
    overflow: auto;
  }

  .source-editor-wrap :global(.editor-loading),
  .source-editor-wrap :global(textarea) {
    flex: 1;
    min-height: 14rem;
  }

  .source-editor-wrap.has-error :global(.cacl-code-editor) {
    border-color: var(--colorStatusDangerBorder1);
  }

  .source-help {
    flex: none;
    margin: 0;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .diagnostics-bar {
    position: relative;
    z-index: 2;
    flex: none;
    border-top: 1px solid var(--colorNeutralStroke2);
    background: var(--colorNeutralBackground2);
  }

  .diagnostics-summary {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 8px 20px;
    font: 400 12px/16px var(--fontFamilyBase);
    color: var(--colorNeutralForeground2);
    text-align: left;
  }

  .diagnostics-summary--interactive {
    cursor: pointer;
    transition: background-color var(--durationFaster, 100ms) var(--curveEasyEase, ease);
  }

  .diagnostics-summary--interactive:hover {
    background: var(--colorSubtleBackgroundHover);
  }

  .diag-status {
    flex: 1;
    font-weight: 600;
  }

  .diag-status--error { color: var(--colorStatusDangerForeground1); }
  .diag-status--warn { color: var(--colorStatusWarningForeground2); }

  .char-counter {
    color: var(--colorNeutralForeground3);
    font: 400 11px/14px var(--fontFamilyMonospace);
    font-variant-numeric: tabular-nums;
  }

  .char-counter--warn {
    color: var(--colorStatusWarningForeground2);
    font-weight: 600;
  }

  .char-counter--error {
    color: var(--colorStatusDangerForeground1);
    font-weight: 600;
  }

  .diag-chevron {
    display: inline-flex;
    transition: transform var(--durationFast, 150ms) var(--curveDecelerateMid, cubic-bezier(0, 0, 0, 1));
  }

  .diag-chevron--open {
    transform: rotate(180deg);
  }

  .diagnostics-list {
    max-height: 140px;
    overflow: auto;
    margin: 0;
    padding: 0 20px 8px;
    list-style: none;
    display: grid;
    gap: 4px;
  }

  .diag-row {
    display: flex;
    width: 100%;
    align-items: baseline;
    gap: 8px;
    padding: 4px 8px;
    border-radius: var(--borderRadiusMedium, 4px);
    text-align: left;
    font: 400 12px/16px var(--fontFamilyBase);
    color: var(--colorNeutralForeground1);
    cursor: pointer;
    transition: background-color var(--durationFaster, 100ms) var(--curveEasyEase, ease);
  }

  .diag-row:hover {
    background: var(--colorSubtleBackgroundHover);
  }

  .diag-row--static {
    cursor: default;
  }

  .diag-code {
    flex: none;
    padding: 1px 6px;
    border-radius: 4px;
    font: 600 11px/14px var(--fontFamilyMonospace);
  }

  .diag-code--error {
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
  }

  .diag-code--warning,
  .diag-code--info {
    background: var(--colorStatusWarningBackground1);
    color: var(--colorStatusWarningForeground2);
  }

  .dacl-footer {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid var(--colorNeutralStroke2);
    padding: 12px 20px;
  }

  @media (pointer: coarse) {
    :global(.mode-tab[data-fluent-owner="cacl-access-manager"]),
    :global(.source-tool-btn[data-fluent-owner="cacl-access-manager"]),
    .code-template-select {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.mode-tab[data-fluent-owner="cacl-access-manager"]),
    .inherit-switch,
    :global(.source-tool-btn[data-fluent-owner="cacl-access-manager"]),
    .source-editor-wrap :global(.cacl-code-editor),
    .diagnostics-summary--interactive,
    .diag-chevron,
    .diag-row {
      transition: none;
    }
  }
</style>
