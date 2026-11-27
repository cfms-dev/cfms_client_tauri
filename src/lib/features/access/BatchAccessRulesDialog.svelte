<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import type { ObjectType } from 'codemirror-lang-cacl';
  import { getNodeDacl } from '#lib/api.ts';
  import type { ServerCaclDiagnostic } from '#lib/api/types.ts';
  import {
    BatchAccessRulesController,
    batchRulesTargetKey,
    type BatchRulesFailureAction,
    type BatchRulesItemStatus,
    type BatchRulesProblem,
    type BatchRulesSnapshot,
    type BatchRulesTarget,
  } from '#lib/features/access/batch-access-rules.ts';
  import { accessRulesDraftFingerprint } from '#lib/features/access/access-rules-edit.ts';
  import { parseCaclToModel } from '#lib/features/access/cacl-model.ts';
  import { formatUserFacingError } from '#lib/shared/errors/user-facing-errors.ts';
  import { dialogStore, type ChoiceDialogOption } from '#lib/shared/ui/dialogs.svelte.ts';
  import AccessRulesManager, { type CaclDraftState } from '#lib/features/access/AccessRulesManager.svelte';
  import DialogActionButton from '#lib/shared/ui/DialogActionButton.svelte';
  import Icon from '#lib/shared/ui/Icon.svelte';
  import MdCheckbox from '#lib/shared/ui/MdCheckbox.svelte';
  import ModalFrame from '#lib/shared/ui/ModalFrame.svelte';
  import ProgressRing from '#lib/shared/ui/ProgressRing.svelte';
  import VirtualList from '#lib/shared/ui/VirtualList.svelte';

  let {
    targets,
    initialTemplateKey,
    canListUsers = false,
    canListGroups = false,
    checkGuard,
    onApplied,
    onClose,
  }: {
    targets: BatchRulesTarget[];
    initialTemplateKey?: string;
    canListUsers?: boolean;
    canListGroups?: boolean;
    checkGuard: () => BatchRulesProblem | null;
    onApplied: () => Promise<void>;
    onClose: () => void;
  } = $props();

  const roots = untrack(() => targets.map((target) => ({ ...target })));
  const isMultiSelection = roots.length > 1;
  const targetObjectType: ObjectType | null = untrack(() => {
    const first = roots[0]?.objectType;
    if (!first) return null;
    return roots.every((item) => item.objectType === first) ? first : null;
  });

  let stage = $state<'edit' | 'scan' | 'results'>('edit');
  let recursive = $state(false);
  let editorDacl = $state('inherit on;\n');
  let editorAnnotatedDacl = $state<string | null>(null);
  let editorResetRevision = $state(0);
  let validDraft = $state<CaclDraftState | null>(null);
  let baseline = $state<string | null>(null);
  let initialized = $state(false);
  let draftDacl = $state('inherit on;\n');
  let draftInherit = $state(true);
  let draftRuleCount = $state(0);
  let draftRecursive = $state(false);
  let intent = $state<'ok' | 'apply'>('apply');
  let templateKey = $state(untrack(() => roots.some((target) => batchRulesTargetKey(target) === initialTemplateKey)
    ? initialTemplateKey! : batchRulesTargetKey(roots[0])));
  let templateLoading = $state(false);
  let templateError = $state<string | null>(null);
  let templateSource = $state<string | null>(null);
  let confirmation = $state<'apply' | 'resubmit' | null>(null);
  let allowIncomplete = $state(false);
  let filter = $state<'all' | BatchRulesItemStatus>('all');
  let preparing = $state(false);
  let refreshing = $state(false);
  let refreshError = $state<string | null>(null);
  let appliedCount = $state<number | null>(null);
  let singleRunProblem = $state<string | null>(null);
  let singleRunDiagnostics = $state<readonly ServerCaclDiagnostic[]>([]);
  let now = $state(Date.now());
  let snapshot = $state.raw<BatchRulesSnapshot>(undefined!);
  let editorElement: HTMLDivElement;
  let progressElement = $state<HTMLDivElement>();
  let disposed = false;
  let templateRequest = 0;
  let editRevision = 0;
  let generation = 0;
  let refreshedSuccesses = 0;
  const unconfirmedKeys = new Set<string>();
  let controller = createController();
  snapshot = controller.snapshot;

  const busy = $derived(['scanning', 'running', 'waiting', 'deciding'].includes(snapshot.phase));
  const guardIssue = $derived(checkGuard());
  const canSubmit = $derived(initialized && !templateLoading && !guardIssue && !busy
    && !preparing && !refreshing && stage === 'edit' && validDraft !== null && !validDraft.hasErrors);
  const dirty = $derived(recursive || baseline === null || (validDraft !== null
    && accessRulesDraftFingerprint(validDraft.dacl) !== baseline));
  const counts = $derived.by(() => {
    const result = { pending: 0, success: 0, failed: 0, unconfirmed: 0 };
    for (const item of snapshot.results) result[item.status] += 1;
    return result;
  });
  const folders = $derived(snapshot.targets.filter((target) => target.objectType === 'directory').length);
  const documents = $derived(snapshot.targets.length - folders);
  const filteredResults = $derived(snapshot.results.filter((item) => filter === 'all' || item.status === filter));
  const activeTarget = $derived(snapshot.results.find((item) => batchRulesTargetKey(item.target) === snapshot.activeKey)?.target);
  const emptyRules = $derived(draftRuleCount === 0);
  const incompleteScope = $derived(!snapshot.scanComplete || snapshot.scanIssues.length > 0);
  const waitSeconds = $derived(Math.max(0, Math.ceil(((snapshot.waitingUntil ?? snapshot.retryAt) - now) / 1_000)));
  const confirmationTargets = $derived(confirmation === 'resubmit'
    ? snapshot.results.filter((item) => item.status === 'unconfirmed').map((item) => item.target) : snapshot.targets);
  const includesUnconfirmed = $derived(snapshot.targets.some((target) => unconfirmedKeys.has(batchRulesTargetKey(target))));
  const statusText = $derived(snapshot.stopRequested ? $t('files.batchRules.stopping')
    : snapshot.phase === 'deciding' ? $t('files.batchRules.phase.deciding')
    : snapshot.phase === 'waiting' ? $t('files.batchRules.waiting', { values: { seconds: waitSeconds } })
    : snapshot.operation === 'scan' ? $t('files.batchRules.discovered', { values: { count: snapshot.targets.length } })
    : $t('files.batchRules.progress', { values: { processed: snapshot.runCompleted, total: snapshot.runTotal } }));
  const showEditContext = $derived(stage === 'edit' && (
    isMultiSelection
    || Boolean(guardIssue)
    || templateLoading
    || Boolean(templateError)
    || (!templateSource && initialized)
    || (!initialized && !templateLoading)
    || appliedCount !== null
    || Boolean(singleRunProblem)
    || Boolean(refreshError)
  ));
  const progressPercent = $derived(
    snapshot.runTotal > 0
      ? Math.round(Math.min(1, Math.max(0, snapshot.runCompleted / snapshot.runTotal)) * 100)
      : 0,
  );
  const runTone = $derived.by(() => {
    if (busy || preparing) return 'running';
    if (snapshot.phase === 'finished' && counts.failed === 0 && counts.unconfirmed === 0 && counts.pending === 0 && !incompleteScope && !refreshError) {
      return 'success';
    }
    if (counts.failed > 0 && counts.success === 0 && counts.unconfirmed === 0 && counts.pending === 0) {
      return 'danger';
    }
    if (snapshot.phase === 'stopped' && counts.failed === 0 && counts.unconfirmed === 0) {
      return 'stopped';
    }
    return 'warning';
  });
  const filterOptions = $derived<Array<{ key: 'all' | BatchRulesItemStatus; label: string; count: number }>>([
    { key: 'all', label: $t('files.batchRules.allResults'), count: snapshot.results.length },
    { key: 'success', label: $t('files.batchRules.item.success'), count: counts.success },
    { key: 'failed', label: $t('files.batchRules.item.failed'), count: counts.failed },
    { key: 'unconfirmed', label: $t('files.batchRules.item.unconfirmed'), count: counts.unconfirmed },
    { key: 'pending', label: $t('files.batchRules.item.pending'), count: counts.pending },
  ]);

  $effect(() => {
    const problem = guardIssue;
    if (problem && busy && !snapshot.stopRequested) untrack(() => controller.stop(problem));
    if (problem && confirmation) untrack(cancelConfirmation);
  });

  $effect(() => {
    if (stage === 'edit' || confirmation) return;
    void tick().then(() => {
      if (!disposed && stage !== 'edit' && !confirmation && !dialogStore.current) {
        progressElement?.focus({ preventScroll: true });
      }
    });
  });

  onMount(() => {
    void loadTemplate();
    const timer = setInterval(() => { now = Date.now(); }, 1_000);
    return () => clearInterval(timer);
  });

  onDestroy(() => {
    disposed = true;
    generation += 1;
    templateRequest += 1;
    controller.dispose();
  });

  function shouldShowBatchView(next: BatchRulesSnapshot): boolean {
    return (
      next.targets.length > 1
      || (!next.scanComplete && next.scanIssues.length > 0)
      || next.scanIssues.length > 0
      || next.phase === 'waiting'
      || (next.phase === 'paused' && (
        next.operation === 'scan'
        || next.retryAt > Date.now()
        || (next.waitingUntil ?? 0) > Date.now()
      ))
      || next.results.some((item) => item.status === 'unconfirmed')
    );
  }

  function createController() {
    const round = generation;
    return new BatchAccessRulesController(roots, {
      guard: () => checkGuard(),
      resolveFailure,
      onChange: (next) => {
        if (disposed || round !== generation) return;
        for (const item of next.results) {
          const key = batchRulesTargetKey(item.target);
          if (item.status === 'unconfirmed') unconfirmedKeys.add(key);
          else if (item.status === 'success') unconfirmedKeys.delete(key);
        }
        snapshot = next;
        if (stage === 'edit' && (preparing || ['scanning', 'running', 'waiting', 'deciding'].includes(next.phase) || next.started) && shouldShowBatchView(next)) {
          stage = next.started ? 'results' : 'scan';
        }
      },
    });
  }

  function formatProblemDiagnostics(diagnostics?: readonly ServerCaclDiagnostic[]): string {
    if (!diagnostics || diagnostics.length === 0) return '';
    return diagnostics.slice(0, 3).map((d) => `[${d.code}] ${d.message}`).join(' · ');
  }

  function selfLockoutDialogMessage(problem: BatchRulesProblem): string {
    const base = $t('files.cacl.selfLockoutBatchMessage');
    const detailParts = [
      problem.error !== undefined ? formatUserFacingError(problem.error) : '',
      formatProblemDiagnostics(problem.diagnostics),
    ].filter(Boolean);
    return detailParts.length > 0 ? `${base}\n${detailParts.join(' · ')}` : base;
  }

  async function resolveFailure(target: BatchRulesTarget, problem: BatchRulesProblem, signal: AbortSignal): Promise<BatchRulesFailureAction> {
    const isSelfLockout = problem.kind === 'self_lockout';
    const choices: ChoiceDialogOption<BatchRulesFailureAction>[] = isSelfLockout
      ? [
          {
            value: 'allow_lockout',
            label: $t('files.cacl.allowLockoutOnce'),
            description: $t('files.cacl.allowLockoutOnceHint'),
            icon: 'warning',
            intent: 'danger',
          },
          {
            value: 'allow_lockout_all',
            label: $t('files.cacl.allowLockoutAll'),
            description: $t('files.cacl.allowLockoutAllHint'),
            icon: 'warning',
            intent: 'danger',
          },
          {
            value: 'skip',
            label: $t('files.batchRules.skip'),
            description: $t('files.cacl.skipLockoutOnceHint'),
            intent: 'primary',
          },
          {
            value: 'skip_all',
            label: $t('files.cacl.skipLockoutAll'),
            description: $t('files.cacl.skipLockoutAllHint'),
          },
        ]
      : [
          { value: 'retry', label: $t('common.retry'), icon: 'refresh', intent: 'primary' },
          { value: 'skip', label: $t('files.batchRules.skip') },
          { value: 'skip_all', label: $t('files.batchRules.skipAll') },
        ];

    const choice = await dialogStore.choose({
      title: $t(isSelfLockout ? 'files.cacl.selfLockoutTitle' : 'files.batchRules.failureTitle'),
      message: isSelfLockout ? selfLockoutDialogMessage(problem) : problemText(problem),
      details: [{ label: target.name, meta: target.path ?? target.objectId, kind: target.objectType === 'directory' ? 'directory' : 'file' }],
      choices,
      cancelLabel: $t('files.batchRules.stop'),
      cancelIcon: 'stop',
      signal,
    });
    return choice?.value ?? 'cancel';
  }

  function problemText(problem: BatchRulesProblem, scanning = false): string {
    const label = $t(scanning && problem.kind === 'denied' ? 'files.batchRules.scanDenied' : 'files.batchRules.problem.' + problem.kind);
    const diagText = formatProblemDiagnostics(problem.diagnostics);
    const base = problem.error === undefined ? label : label + ': ' + formatUserFacingError(problem.error);
    return diagText ? `${base} (${diagText})` : base;
  }

  function close() {
    if (refreshing) return;
    if (busy || preparing) controller.stop();
    else onClose();
  }

  function createBlank() {
    if (busy || refreshing || stage !== 'edit') return;
    templateRequest += 1;
    editorDacl = 'inherit on;\n';
    editorAnnotatedDacl = null;
    editorResetRevision += 1;
    baseline = null;
    initialized = true;
    templateLoading = false;
    templateError = null;
    templateSource = null;
    appliedCount = null;
    singleRunProblem = null;
    singleRunDiagnostics = [];
  }

  async function loadTemplate() {
    if (templateLoading || guardIssue || stage !== 'edit') return;
    const target = roots.find((item) => batchRulesTargetKey(item) === templateKey);
    if (!target) return;
    const request = ++templateRequest;
    const revision = editRevision;
    templateLoading = true;
    templateError = null;
    singleRunProblem = null;
    singleRunDiagnostics = [];
    try {
      const current = await getNodeDacl(target.objectType, target.objectId, true);
      if (disposed || request !== templateRequest || revision !== editRevision || checkGuard()) return;
      if (typeof current?.dacl !== 'string') throw new Error($t('files.batchRules.problem.invalid_response'));
      editorDacl = current.dacl;
      editorAnnotatedDacl = typeof current.annotated_dacl === 'string' ? current.annotated_dacl : null;
      editorResetRevision += 1;
      if (roots.length === 1) baseline = accessRulesDraftFingerprint(current.dacl);
      templateSource = target.name;
      initialized = true;
      appliedCount = null;
    } catch (error) {
      if (!disposed && request === templateRequest && revision === editRevision) templateError = formatUserFacingError(error);
    } finally {
      if (!disposed && request === templateRequest) templateLoading = false;
    }
  }

  async function prepare(dacl: string, submitIntent: 'ok' | 'apply' = 'apply') {
    if (!canSubmit) return;
    if (!dirty) {
      if (submitIntent === 'ok') onClose();
      return;
    }
    const parsed = parseCaclToModel(dacl);
    draftInherit = parsed.ok ? parsed.document.inherit : true;
    draftRuleCount = parsed.ok ? parsed.document.rules.length : 0;

    preparing = true;
    intent = submitIntent;
    draftDacl = dacl;
    draftRecursive = recursive;
    allowIncomplete = false;
    refreshError = null;
    appliedCount = null;
    singleRunProblem = null;
    singleRunDiagnostics = [];
    filter = 'all';
    if (roots.length > 1) stage = 'scan';
    generation += 1;
    controller.dispose();
    controller = createController();
    snapshot = controller.snapshot;
    refreshedSuccesses = 0;
    const round = generation;
    try {
      await controller.discover(draftDacl, false, draftRecursive);
      if (disposed || round !== generation) return;
      await afterScan();
    } catch (error) {
      if (!disposed && round === generation) {
        const message = formatUserFacingError(error);
        if (roots.length <= 1) singleRunProblem = message;
        else templateError = message;
        stage = 'edit';
      }
    } finally {
      if (!disposed && round === generation) preparing = false;
    }
  }

  async function afterScan() {
    if (snapshot.phase !== 'ready' || guardIssue) {
      if (snapshot.phase === 'stopped' || guardIssue) {
        stage = 'edit';
        focusEditor();
      } else if (shouldShowBatchView(snapshot)) {
        stage = 'scan';
      }
      return;
    }
    if (draftRecursive || emptyRules || includesUnconfirmed || incompleteScope) confirmation = 'apply';
    else await run(() => controller.apply());
  }

  async function retryScan(resume = false) {
    if (busy || preparing || refreshing || guardIssue) return;
    confirmation = null;
    allowIncomplete = false;
    preparing = true;
    const round = generation;
    try {
      if (resume) await controller.resumeScan();
      else await controller.discover(draftDacl, false, draftRecursive);
      if (!disposed && round === generation) await afterScan();
    } catch (error) {
      if (!disposed && round === generation) { templateError = formatUserFacingError(error); stage = 'edit'; }
    } finally {
      if (!disposed && round === generation) preparing = false;
    }
  }

  function cancelConfirmation() {
    const wasApply = confirmation === 'apply';
    confirmation = null;
    allowIncomplete = false;
    if (wasApply) { stage = 'edit'; focusEditor(); }
  }

  async function confirmScope() {
    if (busy || preparing || refreshing || guardIssue || (confirmation === 'apply' && incompleteScope && !allowIncomplete)) return;
    const action = confirmation;
    confirmation = null;
    if (action === 'resubmit') await run(() => controller.resubmitUnconfirmed());
    else if (action === 'apply') await run(() => controller.apply(allowIncomplete));
  }

  async function run(action: () => Promise<void>) {
    if (busy || refreshing || guardIssue) return;
    const forceBatchView = roots.length > 1 || snapshot.targets.length > 1 || incompleteScope || counts.unconfirmed > 0;
    if (forceBatchView) stage = 'results';
    const round = generation;
    try { await action(); }
    catch (error) {
      if (!disposed && round === generation) {
        const message = formatUserFacingError(error);
        if (stage === 'edit') singleRunProblem = message;
        else refreshError = message;
      }
      return;
    }
    if (disposed || round !== generation) return;
    if (counts.success > refreshedSuccesses) await refreshDirectory();
    if (!disposed && round !== generation) return;
    finishSuccessfulRun();
    if (!disposed && round === generation && stage === 'edit') {
      if (shouldShowBatchView(snapshot)) {
        stage = snapshot.started ? 'results' : 'scan';
      } else {
        const singleItem = snapshot.results[0];
        if (singleItem?.problem && !(snapshot.stopReason?.kind === 'stopped' && singleItem.status !== 'failed')) {
          singleRunProblem = problemText(singleItem.problem);
          singleRunDiagnostics = singleItem.problem.diagnostics ?? [];
        } else if (snapshot.stopReason && snapshot.stopReason.kind !== 'stopped') {
          singleRunProblem = problemText(snapshot.stopReason);
        }
        focusEditor();
      }
    }
  }

  async function refreshDirectory() {
    if (refreshing || guardIssue) return;
    const round = generation;
    refreshing = true;
    refreshError = null;
    try {
      await onApplied();
      if (!disposed && round === generation) refreshedSuccesses = counts.success;
    } catch (error) {
      if (!disposed && round === generation) refreshError = $t('files.batchRules.refreshFailed') + ': ' + formatUserFacingError(error);
    } finally {
      if (!disposed && round === generation) refreshing = false;
    }
  }

  function finishSuccessfulRun() {
    if (snapshot.phase !== 'finished' || incompleteScope || counts.pending || counts.failed
      || counts.unconfirmed || refreshError || guardIssue || refreshing) return;
    baseline = accessRulesDraftFingerprint(draftDacl);
    recursive = false;
    appliedCount = counts.success;
    singleRunProblem = null;
    singleRunDiagnostics = [];
    if (intent === 'ok') onClose();
    else { stage = 'edit'; focusEditor(); }
  }

  async function retryRefresh() {
    await refreshDirectory();
    if (!disposed) finishSuccessfulRun();
  }

  function backToEdit() {
    if (busy || preparing || refreshing) return;
    stage = 'edit';
    focusEditor();
  }

  function focusEditor() {
    void tick().then(() => {
      if (!disposed && stage === 'edit') editorElement?.querySelector<HTMLElement>(
        '[contenteditable="true"], input:not(:disabled), select:not(:disabled), button:not(:disabled), fluent-button:not([disabled])',
      )?.focus({ preventScroll: true });
    });
  }

  function rowStatusKey(item: BatchRulesSnapshot['results'][number]) {
    if (item.skipped) return 'files.batchRules.skipped';
    return 'files.batchRules.item.' + (busy && snapshot.activeKey === batchRulesTargetKey(item.target) ? 'working' : item.status);
  }

  function rowStatusTone(item: BatchRulesSnapshot['results'][number]): 'working' | 'success' | 'failed' | 'unconfirmed' | 'skipped' | 'pending' {
    if (busy && snapshot.activeKey === batchRulesTargetKey(item.target)) return 'working';
    if (item.skipped) return 'skipped';
    return item.status;
  }
</script>

<ModalFrame
  title={roots.length === 1 ? $t('files.ruleManagerTitle', { values: { name: roots[0].name } }) : $t('files.setPermissions')}
  maxWidth="max-w-6xl" resizable maximizable minWidth={680} minHeight={480}
  closeLabel={$t('common.close')} dismissible={!refreshing} closeOnBackdrop={false} onClose={close}
>
  <div class="batch-rules-layout">
    {#if showEditContext}
      <div class="batch-rules-context">
        {#if isMultiSelection}
          <p class="batch-rules-selection-title">{$t('files.batchRules.selection', { values: { count: roots.length } })}</p>
          <p class="batch-rules-muted">{$t('files.batchRules.overwrite')}</p>
          <div class="batch-rules-template">
            <select class="cfms-native-field" bind:value={templateKey} aria-label={$t('files.batchRules.templateObject')} disabled={templateLoading}>
              {#each roots as target (batchRulesTargetKey(target))}
                <option value={batchRulesTargetKey(target)}>{$t('files.' + target.objectType)} · {target.name}</option>
              {/each}
            </select>
            <DialogActionButton onclick={loadTemplate} disabled={templateLoading || !!guardIssue}>
              {#if templateLoading}<ProgressRing size={16} label={$t('common.loadingEllipsis')} />{/if}
              {$t(templateError ? 'common.retry' : 'files.batchRules.loadTemplate')}
            </DialogActionButton>
          </div>
          {#if templateSource}<p class="batch-rules-muted">{$t('files.batchRules.templateSource', { values: { name: templateSource } })}</p>{/if}
        {:else if templateLoading}
          <div class="batch-rules-status"><ProgressRing size={16} label={$t('common.loadingEllipsis')} /><span>{$t('common.loadingEllipsis')}</span></div>
        {:else if templateError}
          <div class="batch-inline-notice batch-inline-notice--danger" role="alert">
            <span class="cfms-icon-text__icon"><Icon name="errorFilled" size={16} /></span>
            <span class="batch-inline-notice-text">{templateError}</span>
            <DialogActionButton onclick={loadTemplate} disabled={!!guardIssue}>{$t('common.retry')}</DialogActionButton>
          </div>
        {/if}

        {#if !templateSource && initialized}
          <p class="batch-rules-muted">{$t('files.batchRules.newDraft')}</p>
        {/if}
        {#if isMultiSelection && templateError}
          <div class="batch-inline-notice batch-inline-notice--danger" role="alert">
            <span class="cfms-icon-text__icon"><Icon name="errorFilled" size={16} /></span>
            <span class="batch-inline-notice-text">{templateError}</span>
          </div>
        {/if}
        {#if guardIssue}
          <div class="batch-inline-notice batch-inline-notice--danger" role="alert">
            <span class="cfms-icon-text__icon"><Icon name="errorFilled" size={16} /></span>
            <span class="batch-inline-notice-text">{problemText(guardIssue)}</span>
          </div>
        {/if}
        {#if singleRunProblem}
          <div class="batch-inline-notice batch-inline-notice--danger" role="alert">
            <span class="cfms-icon-text__icon"><Icon name="errorFilled" size={16} /></span>
            <span class="batch-inline-notice-text">{singleRunProblem}</span>
          </div>
        {/if}
        {#if refreshError}
          <div class="batch-inline-notice batch-inline-notice--warning" role="alert">
            <span class="cfms-icon-text__icon"><Icon name="warning" size={16} /></span>
            <span class="batch-inline-notice-text">{refreshError}</span>
            <DialogActionButton onclick={retryRefresh} disabled={refreshing || !!guardIssue}>
              <Icon name="refresh" size={16} />
              {$t('files.batchRules.retryRefresh')}
            </DialogActionButton>
          </div>
        {/if}
        {#if !initialized && !templateLoading}
          <div class="batch-rules-blank-action">
            <DialogActionButton onclick={createBlank}>{$t('files.batchRules.createBlank')}</DialogActionButton>
          </div>
        {/if}
        {#if appliedCount !== null}
          <div class="batch-inline-notice batch-inline-notice--success" role="status">
            <span class="cfms-icon-text__icon"><Icon name="checkCircle" size={16} /></span>
            <span class="batch-inline-notice-text">{$t('files.batchRules.applied', { values: { count: appliedCount } })}</span>
          </div>
        {/if}
      </div>
    {/if}

    <div class="batch-rules-editor" bind:this={editorElement} hidden={stage !== 'edit'}>
      <AccessRulesManager
        dacl={editorDacl}
        annotatedDacl={editorAnnotatedDacl}
        {targetObjectType}
        serverDiagnostics={singleRunDiagnostics}
        {canListUsers}
        {canListGroups}
        resetRevision={editorResetRevision}
        saving={busy || preparing || refreshing || !initialized}
        submitDisabled={!canSubmit}
        onDraftChange={(draft) => { validDraft = draft; }}
        onEdit={() => { editRevision += 1; appliedCount = null; singleRunProblem = null; singleRunDiagnostics = []; }}
        onSave={prepare}
        onCancel={close}
      >
        {#snippet footer(submit)}
          <div class="batch-rules-editor-footer">
            {#if busy || preparing}
              <div class="batch-rules-status" role="status" aria-live="polite">
                <ProgressRing size={16} label={$t('files.setPermissions')} />
                <span>{statusText}</span>
              </div>
            {:else if roots.some((target) => target.objectType === 'directory')}
              <div class="recursive-block">
                <label class="batch-rules-choice recursive-choice">
                  <MdCheckbox bind:checked={recursive} disabled={!initialized || templateLoading} ariaLabel={$t('files.batchRules.recursive')} />
                  <span class="recursive-copy">
                    <span class="recursive-label">{$t('files.batchRules.recursive')}</span>
                    <span class="batch-rules-muted recursive-hint">{$t('files.cacl.recursiveInheritanceHint')}</span>
                  </span>
                </label>
              </div>
            {/if}
            <div class="batch-rules-actions">
              {#if busy || preparing}
                <DialogActionButton variant="tonal" onclick={() => controller.stop()} disabled={snapshot.stopRequested}>
                  <Icon name="stop" size={16} />
                  {$t('files.batchRules.stop')}
                </DialogActionButton>
              {:else}
                <DialogActionButton variant="primary" data-dialog-default onclick={() => submit('ok')} disabled={!canSubmit}>{$t('files.batchRules.ok')}</DialogActionButton>
                <DialogActionButton onclick={close}>{$t('common.cancel')}</DialogActionButton>
                <DialogActionButton onclick={() => submit('apply')} disabled={!canSubmit || !dirty}>{$t('files.batchRules.applyChanges')}</DialogActionButton>
              {/if}
            </div>
          </div>
        {/snippet}
      </AccessRulesManager>
    </div>

    {#if stage !== 'edit'}
      <div class="batch-run-shell" aria-live="polite" role="region" aria-label={$t('files.setPermissions')} tabindex="-1" bind:this={progressElement}>
        <section class="batch-run-header">
          {#if guardIssue}
            <div class="batch-callout batch-callout--danger" role="alert">
              <span class="cfms-icon-text__icon"><Icon name="errorFilled" size={16} /></span>
              <span>{problemText(guardIssue)}</span>
            </div>
          {/if}

          <div class="batch-run-hero">
            <div class="batch-run-heading">
              <div class="batch-run-badge batch-run-badge--{runTone}" aria-hidden="true">
                {#if busy || preparing}
                  <ProgressRing size={20} strokeWidth={2.2} label={$t('files.setPermissions')} />
                {:else if runTone === 'success'}
                  <Icon name="checkCircle" size={20} filled />
                {:else if runTone === 'stopped'}
                  <Icon name="stop" size={20} filled />
                {:else if runTone === 'danger'}
                  <Icon name="errorFilled" size={20} filled />
                {:else}
                  <Icon name="warning" size={20} filled />
                {/if}
              </div>
              <div class="batch-run-title-group">
                <h3 class="batch-run-title">
                  {snapshot.stopRequested ? $t('files.batchRules.stopping') : $t('files.batchRules.phase.' + snapshot.phase)}
                </h3>
                <p class="batch-run-meta">
                  <span>{$t('files.batchRules.scope', { values: { documents, folders } })}</span>
                  {#if busy || preparing}
                    <span class="batch-run-meta-sep" aria-hidden="true">·</span>
                    <span>{statusText}</span>
                  {/if}
                </p>
                {#if (busy || preparing) && activeTarget}
                  <p class="batch-run-active-target" title={activeTarget.path ?? activeTarget.objectId}>
                    <Icon name={activeTarget.objectType === 'directory' ? 'folder' : 'filePresent'} size={14} />
                    <span class="batch-run-active-name">{activeTarget.name}</span>
                    {#if activeTarget.path || activeTarget.objectId}
                      <span class="batch-run-active-path" class:batch-run-mono={!activeTarget.path}>{activeTarget.path ?? activeTarget.objectId}</span>
                    {/if}
                  </p>
                {/if}
              </div>
            </div>

            {#if snapshot.started || snapshot.runTotal > 0}
              <div class="batch-run-metrics">
                <span class="batch-run-fraction">{snapshot.runCompleted} / {snapshot.runTotal}</span>
                <span class="batch-run-percent">{progressPercent}%</span>
              </div>
            {/if}
          </div>

          {#if snapshot.started || busy || preparing}
            <div
              class="batch-run-progress batch-run-progress--{runTone}"
              class:batch-run-progress--indeterminate={(busy || preparing) && !snapshot.started}
              role="progressbar"
              aria-label={statusText}
              aria-valuemin={0}
              aria-valuemax={snapshot.runTotal || 1}
              aria-valuenow={snapshot.started ? snapshot.runCompleted : undefined}
            >
              <div
                class="batch-run-progress-fill"
                style:width={snapshot.started ? `${progressPercent}%` : undefined}
              ></div>
            </div>
          {/if}

          {#if snapshot.stopReason || (!busy && waitSeconds > 0) || (snapshot.started && incompleteScope) || refreshError || refreshing || (snapshot.started && (busy || counts.pending > 0 || counts.failed > 0 || snapshot.phase === 'stopped' || snapshot.phase === 'paused'))}
            <div class="batch-run-notices">
              {#if snapshot.stopReason}
                <div class="batch-callout {snapshot.stopReason.kind === 'stopped' ? 'batch-callout--neutral' : 'batch-callout--danger'}" role={snapshot.stopReason.kind === 'stopped' ? 'status' : 'alert'}>
                  <span class="cfms-icon-text__icon">
                    <Icon name={snapshot.stopReason.kind === 'stopped' ? 'stop' : 'errorFilled'} size={16} />
                  </span>
                  <span>{problemText(snapshot.stopReason)}</span>
                </div>
              {/if}
              {#if !busy && waitSeconds > 0}
                <div class="batch-callout batch-callout--warning" role="status">
                  <span class="cfms-icon-text__icon"><Icon name="accessTime" size={16} /></span>
                  <span>{$t('files.batchRules.cooldown', { values: { seconds: waitSeconds } })}</span>
                </div>
              {/if}
              {#if snapshot.started && incompleteScope}
                <div class="batch-callout batch-callout--warning" role="status">
                  <span class="cfms-icon-text__icon"><Icon name="warning" size={16} /></span>
                  <span>{$t('files.batchRules.incompleteScope')}</span>
                </div>
              {/if}
              {#if refreshError}
                <div class="batch-callout batch-callout--danger" role="alert">
                  <span class="cfms-icon-text__icon"><Icon name="errorFilled" size={16} /></span>
                  <span>{refreshError}</span>
                </div>
              {/if}
              {#if refreshing}
                <div class="batch-callout batch-callout--neutral" role="status">
                  <span class="cfms-icon-text__icon"><ProgressRing size={14} strokeWidth={2} label={$t('files.batchRules.refreshing')} /></span>
                  <span>{$t('files.batchRules.refreshing')}</span>
                </div>
              {/if}
              {#if snapshot.started && (busy || counts.pending > 0 || counts.failed > 0 || snapshot.phase === 'stopped' || snapshot.phase === 'paused')}
                <p class="batch-run-footnote">
                  <span class="cfms-icon-text__icon"><Icon name="info" size={14} /></span>
                  <span>{$t('files.batchRules.noRollback')}</span>
                </p>
              {/if}
            </div>
          {/if}
        </section>

        {#if snapshot.started}
          <div class="batch-run-filters" role="group" aria-label={$t('files.batchRules.filter')}>
            <span class="sr-only">{$t('files.batchRules.counts', { values: counts })}</span>
            {#each filterOptions as option (option.key)}
              <button
                type="button"
                data-focus-ring="delegated"
                class="batch-filter-pill batch-filter-pill--{option.key}"
                class:is-active={filter === option.key}
                aria-pressed={filter === option.key}
                onclick={() => { filter = option.key; }}
              >
                {#if option.key !== 'all'}
                  <span class="batch-filter-dot batch-filter-dot--{option.key}" aria-hidden="true"></span>
                {/if}
                <span class="batch-filter-label">{option.label}</span>
                <span class="batch-filter-count">{option.count}</span>
              </button>
            {/each}
          </div>

          {#if filteredResults.length === 0}
            <div class="batch-rules-empty">
              <Icon name="filterList" size={28} />
              <p>{$t('files.batchRules.noResults')}</p>
              {#if filter !== 'all'}
                <DialogActionButton variant="secondary" onclick={() => { filter = 'all'; }}>
                  {$t('files.batchRules.allResults')}
                </DialogActionButton>
              {/if}
            </div>
          {:else}
            <VirtualList items={filteredResults} keyOf={(item) => batchRulesTargetKey(item.target)} estimateSize={76} resetKey={filter} viewportClass="batch-rules-results">
              {#snippet children(item)}
                {@const tone = rowStatusTone(item)}
                <div class="batch-rules-result">
                  <div class="batch-result-icon" aria-hidden="true">
                    <Icon name={item.target.objectType === 'directory' ? 'folder' : 'filePresent'} size={18} />
                  </div>
                  <div class="batch-rules-result-copy">
                    <strong class="batch-result-name" title={item.target.name}>{item.target.name}</strong>
                    <p class="batch-result-path" class:batch-run-mono={!item.target.path} title={item.target.path ?? item.target.objectId}>
                      {item.target.path ?? item.target.objectId}
                    </p>
                    {#if item.problem}
                      <div class="batch-result-problem" class:batch-result-problem--warning={item.status === 'unconfirmed'}>
                        <span class="cfms-icon-text__icon">
                          <Icon name={item.status === 'unconfirmed' ? 'warning' : 'errorFilled'} size={14} />
                        </span>
                        <span>{problemText(item.problem)}</span>
                      </div>
                    {/if}
                  </div>
                  <span class="batch-status-badge batch-status-badge--{tone}">
                    {#if tone === 'working'}
                      <ProgressRing size={12} strokeWidth={2} label={$t(rowStatusKey(item))} />
                    {:else if tone === 'success'}
                      <Icon name="checkCircle" size={14} />
                    {:else if tone === 'failed'}
                      <Icon name="errorFilled" size={14} />
                    {:else if tone === 'unconfirmed'}
                      <Icon name="warning" size={14} />
                    {:else if tone === 'skipped'}
                      <Icon name="block" size={14} />
                    {:else}
                      <Icon name="accessTime" size={14} />
                    {/if}
                    <span>{$t(rowStatusKey(item))}</span>
                  </span>
                </div>
              {/snippet}
            </VirtualList>
          {/if}
        {:else}
          <div class="batch-run-spacer"></div>
        {/if}

        <footer class="batch-run-footer">
          {#if !busy && !preparing && snapshot.started}
            <div class="batch-run-footer-recovery">
              {#if counts.pending > 0 || (snapshot.phase === 'paused' && counts.failed > 0)}
                <DialogActionButton variant="primary" onclick={() => run(() => controller.continuePending())} disabled={refreshing || !!guardIssue}>
                  <Icon name="resume" size={16} />
                  {$t('files.batchRules.continuePending')}
                </DialogActionButton>
              {/if}
              {#if counts.failed > 0}
                <DialogActionButton variant={counts.pending > 0 ? 'tonal' : 'primary'} onclick={() => run(() => controller.retryFailed())} disabled={refreshing || !!guardIssue}>
                  <Icon name="refresh" size={16} />
                  {$t('files.batchRules.retryFailed')}
                </DialogActionButton>
              {/if}
              {#if counts.unconfirmed > 0}
                <DialogActionButton variant="tonal" onclick={() => { confirmation = 'resubmit'; }} disabled={refreshing || !!guardIssue}>
                  <Icon name="restartAlt" size={16} />
                  {$t('files.batchRules.resubmitUnconfirmed')}
                </DialogActionButton>
              {/if}
              {#if refreshError}
                <DialogActionButton variant="tonal" onclick={retryRefresh} disabled={refreshing || !!guardIssue}>
                  <Icon name="refresh" size={16} />
                  {$t('files.batchRules.retryRefresh')}
                </DialogActionButton>
              {/if}
            </div>
          {/if}
          <div class="batch-run-footer-nav">
            {#if busy || preparing}
              <DialogActionButton variant="tonal" onclick={() => controller.stop()} disabled={snapshot.stopRequested}>
                <Icon name="stop" size={16} />
                {$t('files.batchRules.stop')}
              </DialogActionButton>
            {:else}
              {#if stage === 'scan' && snapshot.phase === 'paused'}
                <DialogActionButton variant="primary" data-dialog-default onclick={() => retryScan(true)} disabled={!!guardIssue}>
                  <Icon name="resume" size={16} />
                  {$t('files.batchRules.resumeScan')}
                </DialogActionButton>
              {/if}
              <DialogActionButton variant="tonal" onclick={backToEdit} disabled={refreshing}>
                <Icon name="arrowBack" size={16} />
                {$t('files.batchRules.backToEdit')}
              </DialogActionButton>
              <DialogActionButton onclick={close} disabled={refreshing}>{$t('common.close')}</DialogActionButton>
            {/if}
          </div>
        </footer>
      </div>
    {/if}
  </div>
</ModalFrame>

{#if confirmation}
  <ModalFrame title={$t(confirmation === 'resubmit' ? 'files.batchRules.unconfirmedTitle' : 'files.batchRules.scopeTitle')}
    maxWidth="max-w-xl" closeLabel={$t('common.close')} closeOnBackdrop={false} onClose={cancelConfirmation}>
    <div class="batch-rules-confirmation">
      <p>{$t('files.batchRules.confirmCount', { values: { count: confirmationTargets.length } })}</p>
      <p>{$t('files.batchRules.overwrite')}</p>
      <p class="batch-rules-muted">{$t(draftInherit ? 'files.batchRules.inheritOn' : 'files.batchRules.inheritOff')}</p>
      {#if confirmation === 'apply' && draftRecursive}<p class="batch-rules-muted">{$t('files.batchRules.recursiveEnabled')}</p>{/if}
      {#if confirmation === 'apply' && emptyRules}<p class="batch-rules-warning">{$t('files.batchRules.emptyRules')}</p>{/if}
      {#if confirmation === 'resubmit' || includesUnconfirmed}<p class="batch-rules-warning">{$t('files.batchRules.unconfirmedConfirm')}</p>{/if}
      {#if confirmation === 'apply' && incompleteScope}
        <p class="batch-rules-warning">{$t('files.batchRules.incompleteScope')}</p>
        <VirtualList items={snapshot.scanIssues} keyOf={(issue) => batchRulesTargetKey(issue.target)} estimateSize={72} viewportClass="batch-rules-issues">
          {#snippet children(issue)}<div class="batch-rules-issue-row"><strong>{issue.target.path ?? issue.target.name}</strong><p>{problemText(issue.problem, true)}</p></div>{/snippet}
        </VirtualList>
        <label class="batch-rules-choice"><MdCheckbox bind:checked={allowIncomplete} ariaLabel={$t('files.batchRules.allowIncomplete')} /><span>{$t('files.batchRules.allowIncomplete')}</span></label>
        <DialogActionButton onclick={() => retryScan()} disabled={!!guardIssue}>{$t('files.batchRules.retryScan')}</DialogActionButton>
      {/if}
      <details>
        <summary>{$t('files.batchRules.showTargets')}</summary>
        <VirtualList items={confirmationTargets} keyOf={batchRulesTargetKey} estimateSize={60} viewportClass="batch-rules-scope-list">
          {#snippet children(target)}<div class="batch-rules-issue-row"><strong>{target.name}</strong><p class="batch-rules-muted">{target.path ?? target.objectId}</p></div>{/snippet}
        </VirtualList>
      </details>
    </div>
    <div class="batch-rules-actions">
      <DialogActionButton variant="primary" data-dialog-default onclick={confirmScope}
        disabled={!!guardIssue || preparing || (confirmation === 'apply' && incompleteScope && !allowIncomplete)}>
        {$t(confirmation === 'resubmit' ? 'files.batchRules.resubmitUnconfirmed' : 'files.batchRules.apply', { values: { count: confirmationTargets.length } })}
      </DialogActionButton>
      <DialogActionButton onclick={cancelConfirmation}>{$t('common.cancel')}</DialogActionButton>
    </div>
  </ModalFrame>
{/if}

<style>
  .batch-rules-layout {
    display: flex;
    min-height: 0;
    max-height: 78vh;
    flex-direction: column;
    color: var(--colorNeutralForeground1);
    font: 400 14px/20px var(--fontFamilyBase);
  }

  .batch-rules-context {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 8px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--colorNeutralStroke2);
    background: var(--colorNeutralBackground2);
  }

  .batch-rules-context p {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .batch-rules-selection-title {
    font-weight: 600;
  }

  .batch-rules-muted {
    color: var(--colorNeutralForeground3);
    font-size: 12px;
    line-height: 16px;
  }

  .batch-rules-warning {
    color: var(--colorStatusDangerForeground1);
    overflow-wrap: anywhere;
  }

  .batch-rules-template,
  .batch-rules-choice,
  .batch-rules-status {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .batch-rules-template {
    min-width: 0;
    flex-wrap: wrap;
  }

  .batch-rules-choice {
    font-size: 12px;
    cursor: pointer;
  }

  .batch-rules-choice > span {
    min-width: 0;
  }

  .batch-rules-blank-action {
    display: flex;
  }

  .batch-inline-notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
    padding: 8px 12px;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: var(--borderRadiusLarge);
    font-size: 13px;
    line-height: 18px;
  }

  .batch-inline-notice-text {
    flex: 1 1 14rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .batch-inline-notice--danger {
    border-color: color-mix(in srgb, var(--colorStatusDangerBorder1) 70%, transparent);
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
  }

  .batch-inline-notice--warning {
    border-color: color-mix(in srgb, var(--colorStatusWarningBorder1) 75%, transparent);
    background: var(--colorStatusWarningBackground1);
    color: var(--colorStatusWarningForeground2);
  }

  .batch-inline-notice--success {
    border-color: color-mix(in srgb, var(--colorStatusSuccessBorder1) 75%, transparent);
    background: var(--colorStatusSuccessBackground1);
    color: var(--colorStatusSuccessForeground1);
  }

  .recursive-block {
    flex: 1 1 20rem;
    min-width: 0;
  }

  .recursive-choice {
    align-items: flex-start;
    gap: 8px;
  }

  .recursive-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
    padding-top: 4px;
  }

  .recursive-label {
    color: var(--colorNeutralForeground1);
    font: 400 13px/20px var(--fontFamilyBase);
  }

  .recursive-hint {
    margin: 0;
    font: 400 12px/16px var(--fontFamilyBase);
  }

  select {
    max-width: 100%;
    min-height: 2rem;
    min-width: 0;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusMedium);
    padding: 0.3rem 0.5rem;
    background: var(--colorNeutralBackground1);
    color: var(--colorNeutralForeground1);
  }

  .batch-rules-template select {
    max-width: 22rem;
  }

  .batch-rules-editor {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
  }

  .batch-rules-editor[hidden] {
    display: none;
  }

  .batch-rules-editor-footer {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
    padding: 12px 20px;
    border-top: 1px solid var(--colorNeutralStroke2);
  }

  .batch-rules-editor-footer .batch-rules-actions {
    flex: none;
    margin-inline-start: auto;
    padding: 0;
    border: 0;
  }

  .batch-run-shell {
    display: flex;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    outline: none;
  }

  .batch-run-header {
    display: flex;
    flex: none;
    flex-direction: column;
    gap: 14px;
    padding: 20px 24px;
    border-bottom: 1px solid var(--colorNeutralStroke2);
    background: var(--colorNeutralBackground2);
  }

  .batch-run-hero {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px 20px;
  }

  .batch-run-heading {
    display: flex;
    min-width: 0;
    flex: 1 1 18rem;
    align-items: flex-start;
    gap: 12px;
  }

  .batch-run-badge {
    display: grid;
    width: 36px;
    height: 36px;
    flex: none;
    place-items: center;
    border-radius: var(--borderRadiusLarge);
    background: transparent;
    color: var(--colorBrandForeground1);
  }

  .batch-run-badge--success {
    background: var(--colorStatusSuccessBackground1);
    color: var(--colorStatusSuccessForeground1);
  }

  .batch-run-badge--warning {
    background: var(--colorStatusWarningBackground1);
    color: var(--colorStatusWarningForeground1);
  }

  .batch-run-badge--danger {
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
  }

  .batch-run-badge--stopped {
    background: var(--colorNeutralBackground4);
    color: var(--colorNeutralForeground2);
  }

  .batch-run-title-group {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 3px;
  }

  .batch-run-title {
    margin: 0;
    color: var(--colorNeutralForeground1);
    font: 600 16px/22px var(--fontFamilyBase);
  }

  .batch-run-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--colorNeutralForeground2);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .batch-run-meta-sep {
    color: var(--colorNeutralForeground3);
  }

  .batch-run-active-target {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    margin: 2px 0 0;
    padding: 3px 8px;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: var(--borderRadiusMedium);
    background: var(--colorNeutralBackground1);
    color: var(--colorNeutralForeground2);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .batch-run-active-name {
    flex: none;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--colorNeutralForeground1);
    font-weight: 600;
  }

  .batch-run-active-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--colorNeutralForeground3);
  }

  .batch-run-mono {
    font-family: var(--fontFamilyMonospace);
  }

  .batch-run-metrics {
    display: flex;
    flex: none;
    align-items: baseline;
    gap: 8px;
    font-variant-numeric: tabular-nums;
  }

  .batch-run-fraction {
    color: var(--colorNeutralForeground1);
    font: 600 16px/22px var(--fontFamilyBase);
  }

  .batch-run-percent {
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .batch-run-progress {
    position: relative;
    width: 100%;
    height: 6px;
    overflow: hidden;
    border-radius: var(--borderRadiusCircular);
    background: var(--colorNeutralBackground5);
  }

  .batch-run-progress-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--colorBrandBackground);
    transition: width 200ms cubic-bezier(0.2, 0, 0, 1);
  }

  .batch-run-progress--success .batch-run-progress-fill {
    background: var(--colorStatusSuccessForeground1);
  }

  .batch-run-progress--warning .batch-run-progress-fill {
    background: var(--colorStatusWarningForeground1);
  }

  .batch-run-progress--danger .batch-run-progress-fill {
    background: var(--colorStatusDangerForeground1);
  }

  .batch-run-progress--stopped .batch-run-progress-fill {
    background: var(--colorNeutralForeground3);
  }

  .batch-run-progress--indeterminate .batch-run-progress-fill {
    width: 38%;
    animation: batch-progress-indeterminate 1.4s ease-in-out infinite;
  }

  @keyframes batch-progress-indeterminate {
    0% {
      transform: translateX(-110%);
    }
    100% {
      transform: translateX(310%);
    }
  }

  .batch-run-notices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .batch-callout {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--colorNeutralStroke2);
    border-radius: var(--borderRadiusLarge);
    font: 400 12px/16px var(--fontFamilyBase);
    overflow-wrap: anywhere;
  }

  .batch-callout--neutral {
    background: var(--colorNeutralBackground1);
    color: var(--colorNeutralForeground2);
  }

  .batch-callout--warning {
    border-color: color-mix(in srgb, var(--colorStatusWarningBorder1) 75%, transparent);
    background: var(--colorStatusWarningBackground1);
    color: var(--colorStatusWarningForeground2);
  }

  .batch-callout--danger {
    border-color: color-mix(in srgb, var(--colorStatusDangerBorder1) 70%, transparent);
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
  }

  .batch-run-footnote {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    color: var(--colorNeutralForeground3);
    font: 400 12px/16px var(--fontFamilyBase);
  }

  .batch-run-filters {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 24px;
    border-bottom: 1px solid var(--colorNeutralStroke2);
    background: var(--colorNeutralBackground1);
  }

  .batch-filter-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 4px 10px;
    border: 1px solid var(--colorNeutralStroke1);
    border-radius: var(--borderRadiusCircular);
    background: var(--colorNeutralBackground1);
    color: var(--colorNeutralForeground2);
    font: 400 12px/16px var(--fontFamilyBase);
    cursor: pointer;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }

  .batch-filter-pill:hover {
    background: var(--colorSubtleBackgroundHover);
    color: var(--colorNeutralForeground1);
  }

  .batch-filter-pill:active {
    background: var(--colorSubtleBackgroundPressed);
  }

  .batch-filter-pill:focus-visible {
    outline: 2px solid var(--colorStrokeFocus2);
    outline-offset: 1px;
  }

  .batch-filter-pill.is-active {
    border-color: var(--colorCompoundBrandStroke);
    background: var(--colorBrandBackground2);
    color: var(--colorBrandForeground1);
    font-weight: 600;
  }

  .batch-filter-pill--success.is-active {
    border-color: var(--colorStatusSuccessBorder1);
    background: var(--colorStatusSuccessBackground1);
    color: var(--colorStatusSuccessForeground1);
  }

  .batch-filter-pill--failed.is-active {
    border-color: var(--colorStatusDangerBorder1);
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
  }

  .batch-filter-pill--unconfirmed.is-active {
    border-color: var(--colorStatusWarningBorder1);
    background: var(--colorStatusWarningBackground1);
    color: var(--colorStatusWarningForeground2);
  }

  .batch-filter-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
  }

  .batch-filter-dot--success {
    background: var(--colorStatusSuccessForeground1);
  }

  .batch-filter-dot--failed {
    background: var(--colorStatusDangerForeground1);
  }

  .batch-filter-dot--unconfirmed {
    background: var(--colorStatusWarningForeground1);
  }

  .batch-filter-dot--pending {
    background: var(--colorNeutralForeground3);
  }

  .batch-filter-count {
    padding: 1px 6px;
    border-radius: var(--borderRadiusCircular);
    background: color-mix(in srgb, currentColor 10%, transparent);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    line-height: 14px;
    font-weight: 600;
  }

  .batch-run-shell :global(.batch-rules-results) {
    flex: 1 1 auto;
    min-height: 140px;
    overflow: auto;
  }

  .batch-rules-result {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto;
    align-items: start;
    gap: 12px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--colorNeutralStroke2);
    transition: background-color 120ms ease;
  }

  .batch-rules-result:hover {
    background: var(--colorSubtleBackgroundHover);
  }

  .batch-result-icon {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border-radius: var(--borderRadiusMedium);
    background: var(--colorNeutralBackground3);
    color: var(--colorNeutralForeground2);
  }

  .batch-rules-result-copy {
    min-width: 0;
  }

  .batch-result-name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--colorNeutralForeground1);
    font: 600 14px/20px var(--fontFamilyBase);
  }

  .batch-result-path {
    margin: 2px 0 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--colorNeutralForeground3);
    font-size: 12px;
    line-height: 16px;
  }

  .batch-result-problem {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-top: 8px;
    padding: 6px 10px;
    border: 1px solid color-mix(in srgb, var(--colorStatusDangerBorder1) 55%, transparent);
    border-radius: var(--borderRadiusMedium);
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
    font: 400 12px/16px var(--fontFamilyBase);
    overflow-wrap: anywhere;
  }

  .batch-result-problem--warning {
    border-color: color-mix(in srgb, var(--colorStatusWarningBorder1) 65%, transparent);
    background: var(--colorStatusWarningBackground1);
    color: var(--colorStatusWarningForeground2);
  }

  .batch-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border: 1px solid transparent;
    border-radius: var(--borderRadiusCircular);
    font: 600 12px/16px var(--fontFamilyBase);
    white-space: nowrap;
  }

  .batch-status-badge--working {
    border-color: color-mix(in srgb, var(--colorCompoundBrandStroke) 35%, transparent);
    background: var(--colorBrandBackground2);
    color: var(--colorBrandForeground1);
  }

  .batch-status-badge--success {
    border-color: color-mix(in srgb, var(--colorStatusSuccessBorder1) 60%, transparent);
    background: var(--colorStatusSuccessBackground1);
    color: var(--colorStatusSuccessForeground1);
  }

  .batch-status-badge--failed {
    border-color: color-mix(in srgb, var(--colorStatusDangerBorder1) 60%, transparent);
    background: var(--colorStatusDangerBackground1);
    color: var(--colorStatusDangerForeground1);
  }

  .batch-status-badge--unconfirmed {
    border-color: color-mix(in srgb, var(--colorStatusWarningBorder1) 70%, transparent);
    background: var(--colorStatusWarningBackground1);
    color: var(--colorStatusWarningForeground2);
  }

  .batch-status-badge--skipped {
    border-color: var(--colorNeutralStroke2);
    background: var(--colorNeutralBackground4);
    color: var(--colorNeutralForeground2);
  }

  .batch-status-badge--pending {
    border-color: var(--colorNeutralStroke2);
    background: var(--colorNeutralBackground3);
    color: var(--colorNeutralForeground3);
  }

  .batch-rules-empty {
    display: flex;
    flex: 1 1 auto;
    min-height: 140px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 28px 24px;
    color: var(--colorNeutralForeground3);
    text-align: center;
  }

  .batch-rules-empty p {
    margin: 0;
  }

  .batch-run-spacer {
    flex: 1 1 auto;
  }

  .batch-run-footer {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 16px;
    padding: 12px 24px;
    border-top: 1px solid var(--colorNeutralStroke2);
    background: var(--colorNeutralBackground1);
  }

  .batch-run-footer-recovery,
  .batch-run-footer-nav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .batch-run-footer-nav {
    margin-inline-start: auto;
  }

  .batch-rules-issue-row {
    padding-block: 0.5rem;
    overflow-wrap: anywhere;
    border-bottom: 1px solid var(--colorNeutralStroke2);
  }

  .batch-rules-issue-row p {
    margin-block: 0.25rem 0;
  }

  .batch-rules-actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--colorNeutralStroke2);
  }

  .batch-rules-confirmation {
    padding: 1.25rem;
    font-size: 14px;
  }

  .batch-rules-confirmation > * + * {
    margin-top: 0.75rem;
  }

  .batch-rules-confirmation :global(.batch-rules-issues),
  .batch-rules-confirmation :global(.batch-rules-scope-list) {
    max-height: 24vh;
    overflow: auto;
    margin-top: 0.5rem;
  }

  summary {
    cursor: pointer;
    font-weight: 600;
  }

  @media (max-width: 640px) {
    .batch-rules-layout {
      max-height: 82vh;
    }

    .batch-rules-context,
    .batch-rules-actions,
    .batch-rules-confirmation,
    .batch-rules-editor-footer {
      padding: 12px 16px;
    }

    .batch-run-header {
      padding: 14px 16px;
    }

    .batch-run-filters {
      padding: 10px 16px;
    }

    .batch-rules-result {
      grid-template-columns: 32px minmax(0, 1fr);
      padding: 12px 16px;
    }

    .batch-status-badge {
      grid-column: 2;
      justify-self: start;
    }

    .batch-run-footer {
      padding: 12px 16px;
    }

    .batch-rules-template select {
      flex: 1;
    }
  }

  @media (pointer: coarse) {
    select,
    .batch-rules-choice,
    .batch-filter-pill {
      min-height: 44px;
    }

    .recursive-copy {
      padding-top: 12px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .batch-run-progress-fill,
    .batch-filter-pill,
    .batch-rules-result {
      transition: none;
    }

    .batch-run-progress--indeterminate .batch-run-progress-fill {
      animation: none;
      width: 100%;
      opacity: 0.55;
    }
  }

  :global(:root[data-reduce-motion="true"]) .batch-run-progress-fill,
  :global(:root[data-reduce-motion="true"]) .batch-filter-pill,
  :global(:root[data-reduce-motion="true"]) .batch-rules-result {
    transition: none;
  }

  :global(:root[data-reduce-motion="true"]) .batch-run-progress--indeterminate .batch-run-progress-fill {
    animation: none;
    width: 100%;
    opacity: 0.55;
  }

  @media (forced-colors: active) {
    .batch-run-progress {
      border: 1px solid CanvasText;
      background: Canvas;
    }

    .batch-run-progress-fill {
      background: Highlight;
    }

    .batch-filter-pill,
    .batch-status-badge,
    .batch-callout,
    .batch-inline-notice,
    .batch-result-problem {
      border-color: CanvasText;
      background: Canvas;
      color: CanvasText;
    }

    .batch-filter-pill.is-active {
      border-color: Highlight;
      background: Highlight;
      color: HighlightText;
    }
  }
</style>
