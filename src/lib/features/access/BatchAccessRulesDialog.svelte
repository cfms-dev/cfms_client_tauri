<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { _ as t } from 'svelte-i18n';
  import { getAccessRules, listDirectoryPage, setAccessRules } from '$lib/api';
  import { ACCESS_OPERATIONS, cloneAccessRules, validateAccessRules, type AccessRulesRecord } from '$lib/features/access/access-rules';
  import {
    BatchAccessRulesController, batchRulesTargetKey,
    type BatchRulesFailureAction, type BatchRulesItemStatus, type BatchRulesProblem,
    type BatchRulesSnapshot, type BatchRulesTarget,
  } from '$lib/features/access/batch-access-rules';
  import { accessRulesDraftFingerprint } from '$lib/features/access/access-rules-edit';
  import { formatUserFacingError } from '$lib/shared/errors/user-facing-errors';
  import { floatingProgressStore } from "$lib/shared/notifications/progress.svelte.ts";
  import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';
  import AccessRulesManager from '$lib/features/access/AccessRulesManager.svelte';
  import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';
  import Icon from '$lib/shared/ui/Icon.svelte';
  import MdCheckbox from '$lib/shared/ui/MdCheckbox.svelte';
  import ModalFrame from '$lib/shared/ui/ModalFrame.svelte';
  import ProgressRing from '$lib/shared/ui/ProgressRing.svelte';
  import VirtualList from '$lib/shared/ui/VirtualList.svelte';

  let { targets, initialTemplateKey, canReadTemplate, checkGuard, onApplied, onClose }: {
    targets: BatchRulesTarget[];
    initialTemplateKey?: string;
    canReadTemplate: boolean;
    checkGuard: () => BatchRulesProblem | null;
    onApplied: () => Promise<void>;
    onClose: () => void;
  } = $props();

  const roots = untrack(() => targets.map((target) => ({ ...target })));
  const isMultiSelection = roots.length > 1;
  const progressId = 'files:batch-access-rules:' + crypto.randomUUID();
  let stage = $state<'edit' | 'scan' | 'results'>('edit');
  let recursive = $state(false);
  let editorRules = $state<AccessRulesRecord>({});
  let editorInherit = $state(true);
  let editorResetRevision = $state(0);
  let validDraft = $state<{ rules: AccessRulesRecord; inheritParent: boolean } | null>(null);
  let baseline = $state<string | null>(null);
  let initialized = $state(untrack(() => !canReadTemplate));
  let draftRules = $state<AccessRulesRecord>({});
  let draftInherit = $state(true);
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
  let now = $state(Date.now());
  let snapshot = $state.raw<BatchRulesSnapshot>(undefined!);
  let editorElement: HTMLDivElement;
  let progressElement = $state<HTMLDivElement>();
  let disposed = false;
  let templateRequest = 0;
  let editRevision = 0;
  let generation = 0;
  let cooldownUntil = 0;
  let refreshedSuccesses = 0;
  const unconfirmedKeys = new Set<string>();
  let controller = createController();
  snapshot = controller.snapshot;

  const busy = $derived(['scanning', 'running', 'waiting', 'deciding'].includes(snapshot.phase));
  const guardIssue = $derived(checkGuard());
  const canSubmit = $derived(initialized && !templateLoading && !guardIssue && !busy
    && !preparing && !refreshing && stage === 'edit' && validDraft !== null);
  const dirty = $derived(recursive || baseline === null || (validDraft !== null
    && accessRulesDraftFingerprint(validDraft.rules, validDraft.inheritParent) !== baseline));
  const counts = $derived.by(() => {
    const result = { pending: 0, success: 0, failed: 0, unconfirmed: 0 };
    for (const item of snapshot.results) result[item.status] += 1;
    return result;
  });
  const folders = $derived(snapshot.targets.filter((target) => target.objectType === 'directory').length);
  const documents = $derived(snapshot.targets.length - folders);
  const filteredResults = $derived(snapshot.results.filter((item) => filter === 'all' || item.status === filter));
  const activeTarget = $derived(snapshot.results.find((item) => batchRulesTargetKey(item.target) === snapshot.activeKey)?.target);
  const emptyRules = $derived(ACCESS_OPERATIONS.every((operation) => !(draftRules[operation]?.length)));
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

  $effect(() => {
    const problem = guardIssue;
    if (problem && busy && !snapshot.stopRequested) untrack(() => controller.stop(problem));
    if (problem && confirmation) untrack(cancelConfirmation);
  });

  $effect(() => {
    if (busy) {
      const text = statusText;
      const title = $t('files.setPermissions');
      const current = snapshot.operation === 'scan' ? 0 : snapshot.runCompleted;
      const total = snapshot.operation === 'scan' ? 0 : snapshot.runTotal;
      untrack(() => floatingProgressStore.upsert(progressId, title, text, current, total));
    } else untrack(() => floatingProgressStore.remove(progressId));
  });

  $effect(() => {
    if (stage === 'edit' || confirmation) return;
    // Hiding the focused editor would otherwise leave keyboard focus on the
    // document body, where the dialog cannot receive Escape or trap Tab.
    void tick().then(() => {
      if (!disposed && stage !== 'edit' && !confirmation && !dialogStore.current) {
        progressElement?.focus({ preventScroll: true });
      }
    });
  });

  onMount(() => {
    if (canReadTemplate) void loadTemplate();
    const timer = setInterval(() => { now = Date.now(); }, 1_000);
    return () => clearInterval(timer);
  });

  onDestroy(() => {
    disposed = true;
    generation += 1;
    templateRequest += 1;
    controller.dispose();
    floatingProgressStore.remove(progressId);
  });

  function createController() {
    const round = generation;
    return new BatchAccessRulesController(roots, {
      fetchPage: listDirectoryPage, setRules: setAccessRules, guard: () => checkGuard(),
      initialRetryAt: cooldownUntil, resolveFailure,
      onChange: (next) => {
        if (disposed || round !== generation) return;
        cooldownUntil = Math.max(cooldownUntil, next.retryAt);
        for (const item of next.results) {
          const key = batchRulesTargetKey(item.target);
          if (item.status === 'unconfirmed') unconfirmedKeys.add(key);
          else if (item.status === 'success') unconfirmedKeys.delete(key);
        }
        snapshot = next;
      },
    });
  }

  async function resolveFailure(target: BatchRulesTarget, problem: BatchRulesProblem, signal: AbortSignal): Promise<BatchRulesFailureAction> {
    const choice = await dialogStore.choose({
      title: $t('files.batchRules.failureTitle'), message: problemText(problem),
      details: [{ label: target.name, meta: target.path ?? target.objectId, kind: target.objectType === 'directory' ? 'directory' : 'file' }],
      choices: [
        { value: 'retry' as const, label: $t('common.retry'), icon: 'refresh', intent: 'primary' },
        { value: 'skip' as const, label: $t('files.batchRules.skip') },
        { value: 'skip_all' as const, label: $t('files.batchRules.skipAll') },
      ],
      cancelLabel: $t('files.batchRules.stop'), signal,
    });
    return choice?.value ?? 'cancel';
  }

  function problemText(problem: BatchRulesProblem, scanning = false): string {
    const label = $t(scanning && problem.kind === 'denied' ? 'files.batchRules.scanDenied' : 'files.batchRules.problem.' + problem.kind);
    return problem.error === undefined ? label : label + ': ' + formatUserFacingError(problem.error);
  }

  function close() {
    if (refreshing) return;
    if (busy || preparing) controller.stop();
    else onClose();
  }

  function createBlank() {
    if (busy || refreshing || stage !== 'edit') return;
    templateRequest += 1;
    editorRules = {};
    editorInherit = true;
    editorResetRevision += 1;
    baseline = null;
    initialized = true;
    templateLoading = false;
    templateError = null;
    templateSource = null;
    appliedCount = null;
  }

  async function loadTemplate() {
    if (!canReadTemplate || templateLoading || guardIssue || stage !== 'edit') return;
    const target = roots.find((item) => batchRulesTargetKey(item) === templateKey);
    if (!target) return;
    const request = ++templateRequest;
    const revision = editRevision;
    templateLoading = true;
    templateError = null;
    try {
      const current = await getAccessRules(target.objectType, target.objectId);
      if (disposed || !canReadTemplate || request !== templateRequest || revision !== editRevision || checkGuard()) return;
      if (typeof current?.inherit !== 'boolean') throw new Error($t('files.batchRules.problem.invalid_response'));
      validateAccessRules(current.rules);
      editorRules = cloneAccessRules(current.rules);
      editorInherit = current.inherit;
      editorResetRevision += 1;
      if (roots.length === 1) baseline = accessRulesDraftFingerprint(current.rules, current.inherit);
      templateSource = target.name;
      initialized = true;
      appliedCount = null;
    } catch (error) {
      if (!disposed && request === templateRequest && revision === editRevision) templateError = formatUserFacingError(error);
    } finally {
      if (!disposed && request === templateRequest) templateLoading = false;
    }
  }

  async function prepare(rules: AccessRulesRecord, inherit: boolean, submitIntent: 'ok' | 'apply' = 'apply') {
    if (!canSubmit) return;
    if (!dirty) {
      if (submitIntent === 'ok') onClose();
      return;
    }
    preparing = true;
    intent = submitIntent;
    draftRules = cloneAccessRules(rules);
    draftInherit = inherit;
    draftRecursive = recursive;
    allowIncomplete = false;
    refreshError = null;
    appliedCount = null;
    filter = 'all';
    stage = 'scan';
    generation += 1;
    controller.dispose();
    controller = createController();
    snapshot = controller.snapshot;
    refreshedSuccesses = 0;
    const round = generation;
    try {
      await controller.discover(draftRules, draftInherit, draftRecursive);
      if (disposed || round !== generation) return;
      await afterScan();
    } finally {
      if (!disposed && round === generation) preparing = false;
    }
  }

  async function afterScan() {
    if (snapshot.phase !== 'ready' || guardIssue) {
      if (snapshot.phase === 'stopped' || guardIssue) { stage = 'edit'; focusEditor(); }
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
      else await controller.discover(draftRules, draftInherit, draftRecursive);
      if (!disposed && round === generation) await afterScan();
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
    stage = 'results';
    const round = generation;
    await action();
    if (disposed || round !== generation) return;
    if (counts.success > refreshedSuccesses) await refreshDirectory();
    if (!disposed && round === generation) finishSuccessfulRun();
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
    baseline = accessRulesDraftFingerprint(draftRules, draftInherit);
    recursive = false;
    appliedCount = counts.success;
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
</script>

<ModalFrame
  title={roots.length === 1 ? $t('files.ruleManagerTitle', { values: { name: roots[0].name } }) : $t('files.setPermissions')}
  maxWidth="max-w-6xl" resizable maximizable minWidth={680} minHeight={480}
  closeLabel={$t('common.close')} dismissible={!refreshing} closeOnBackdrop={false} onClose={close}
>
  <div class="batch-rules-layout">
    <div class="batch-rules-context">
      <p>{roots.length === 1 ? roots[0].name : $t('files.batchRules.selection', { values: { count: roots.length } })}</p>
      {#if guardIssue}<p class="batch-rules-warning" role="alert">{problemText(guardIssue)}</p>{/if}
      {#if stage === 'edit'}
        {#if isMultiSelection}<p class="batch-rules-muted">{$t('files.batchRules.overwrite')}</p>{/if}
        {#if canReadTemplate && isMultiSelection}
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
        {:else if canReadTemplate && templateLoading}
          <div class="batch-rules-status"><ProgressRing size={16} label={$t('common.loadingEllipsis')} /><span>{$t('common.loadingEllipsis')}</span></div>
        {:else if canReadTemplate && templateError}
          <DialogActionButton onclick={loadTemplate} disabled={!!guardIssue}>{$t('common.retry')}</DialogActionButton>
        {/if}
        {#if isMultiSelection && templateSource}<p class="batch-rules-muted">{$t('files.batchRules.templateSource', { values: { name: templateSource } })}</p>{/if}
        {#if !templateSource && initialized}<p class="batch-rules-muted">{$t('files.batchRules.newDraft')}</p>{/if}
        {#if templateError}<p class="batch-rules-warning" role="alert">{templateError}</p>{/if}
        {#if !initialized && !templateLoading}
          <DialogActionButton onclick={createBlank}>{$t('files.batchRules.createBlank')}</DialogActionButton>
        {/if}
        {#if appliedCount !== null}<p class="batch-rules-success" role="status">{$t('files.batchRules.applied', { values: { count: appliedCount } })}</p>{/if}
      {/if}
    </div>
    <div class="batch-rules-editor" bind:this={editorElement} hidden={stage !== 'edit'}>
      <AccessRulesManager
        rules={editorRules} inheritParent={editorInherit} resetRevision={editorResetRevision}
        saving={busy || preparing || refreshing || !initialized}
        submitDisabled={!canSubmit}
        onDraftChange={(draft) => { validDraft = draft; }}
        onEdit={() => { editRevision += 1; appliedCount = null; }}
        onSave={prepare} onCancel={close}
      >
        {#snippet footer(submit)}
          <div class="batch-rules-editor-footer">
            {#if roots.some((target) => target.objectType === 'directory')}
              <label class="batch-rules-choice">
                <MdCheckbox bind:checked={recursive} disabled={!initialized || templateLoading} ariaLabel={$t('files.batchRules.recursive')} />
                <span>{$t('files.batchRules.recursive')}</span>
              </label>
            {/if}
            <div class="batch-rules-actions">
              <DialogActionButton variant="primary" data-dialog-default onclick={() => submit('ok')} disabled={!canSubmit}>{$t('files.batchRules.ok')}</DialogActionButton>
              <DialogActionButton onclick={close}>{$t('common.cancel')}</DialogActionButton>
              <DialogActionButton onclick={() => submit('apply')} disabled={!canSubmit || !dirty}>{$t('files.batchRules.applyChanges')}</DialogActionButton>
            </div>
          </div>
        {/snippet}
      </AccessRulesManager>
    </div>
    {#if stage !== 'edit'}
      <div class="batch-rules-summary" aria-live="polite" role="region"
        aria-label={$t('files.setPermissions')} tabindex="-1" bind:this={progressElement}>
        {#if busy}
          <div class="batch-rules-status"><ProgressRing size={20} label={$t('files.setPermissions')} /><span>{statusText}</span></div>
          {#if activeTarget}<p class="batch-rules-current">{activeTarget.name}</p><p class="batch-rules-muted">{activeTarget.path ?? activeTarget.objectId}</p>{/if}
        {:else}<p class="batch-rules-step">{$t('files.batchRules.phase.' + snapshot.phase)}</p>{/if}
        <p>{$t('files.batchRules.scope', { values: { documents, folders } })}</p>
        {#if snapshot.started}
          <p>{$t('files.batchRules.counts', { values: counts })}</p>
          <p class="batch-rules-muted">{$t('files.batchRules.noRollback')}</p>
          <progress max={snapshot.runTotal || 1} value={snapshot.runCompleted} aria-label={$t('files.batchRules.progress', { values: { processed: snapshot.runCompleted, total: snapshot.runTotal } })}></progress>
        {/if}
        {#if snapshot.stopReason}<p class="batch-rules-warning">{problemText(snapshot.stopReason)}</p>{/if}
        {#if !busy && waitSeconds > 0}<p>{$t('files.batchRules.cooldown', { values: { seconds: waitSeconds } })}</p>{/if}
        {#if snapshot.started && incompleteScope}<p class="batch-rules-warning">{$t('files.batchRules.incompleteScope')}</p>{/if}
        {#if refreshError}<p class="batch-rules-warning" role="alert">{refreshError}</p>{/if}
        {#if refreshing}<p class="batch-rules-muted">{$t('files.batchRules.refreshing')}</p>{/if}
      </div>
      {#if snapshot.started}
        <div class="batch-rules-filter">
          <label for={progressId + ':filter'}>{$t('files.batchRules.filter')}</label>
          <select class="cfms-native-field" id={progressId + ':filter'} bind:value={filter}>
            <option value="all">{$t('files.batchRules.allResults')}</option>
            {#each ['success', 'failed', 'unconfirmed', 'pending'] as status}<option value={status}>{$t('files.batchRules.item.' + status)}</option>{/each}
          </select>
        </div>
        <VirtualList items={filteredResults} keyOf={(item) => batchRulesTargetKey(item.target)} estimateSize={84} resetKey={filter} viewportClass="batch-rules-results">
          {#snippet children(item)}
            <div class="batch-rules-result">
              <Icon name={item.target.objectType === 'directory' ? 'folder' : 'filePresent'} size="20px" />
              <div class="batch-rules-result-copy">
                <strong>{item.target.name}</strong><p class="batch-rules-muted">{item.target.path ?? item.target.objectId}</p>
                {#if item.problem}<p class="batch-rules-warning">{problemText(item.problem)}</p>{/if}
              </div>
              <span class:batch-rules-success={item.status === 'success'}>
                {$t(item.skipped ? 'files.batchRules.skipped' : 'files.batchRules.item.' + (busy && snapshot.activeKey === batchRulesTargetKey(item.target) ? 'working' : item.status))}
              </span>
            </div>
          {/snippet}
        </VirtualList>
        {#if filteredResults.length === 0}<p class="batch-rules-empty">{$t('files.batchRules.noResults')}</p>{/if}
      {/if}
      {#if !busy && !preparing && snapshot.started}
        <div class="batch-rules-recovery">
          {#if counts.failed > 0}<DialogActionButton onclick={() => run(() => controller.retryFailed())} disabled={refreshing || !!guardIssue}>{$t('files.batchRules.retryFailed')}</DialogActionButton>{/if}
          {#if counts.pending > 0 || (snapshot.phase === 'paused' && counts.failed > 0)}<DialogActionButton variant="primary" onclick={() => run(() => controller.continuePending())} disabled={refreshing || !!guardIssue}>{$t('files.batchRules.continuePending')}</DialogActionButton>{/if}
          {#if counts.unconfirmed > 0}<DialogActionButton onclick={() => { confirmation = 'resubmit'; }} disabled={refreshing || !!guardIssue}>{$t('files.batchRules.resubmitUnconfirmed')}</DialogActionButton>{/if}
          {#if refreshError}<DialogActionButton onclick={retryRefresh} disabled={refreshing || !!guardIssue}>{$t('files.batchRules.retryRefresh')}</DialogActionButton>{/if}
        </div>
      {/if}
      <div class="batch-rules-actions">
        {#if busy || preparing}
          <DialogActionButton onclick={() => controller.stop()} disabled={snapshot.stopRequested}>{$t('files.batchRules.stop')}</DialogActionButton>
        {:else}
          {#if stage === 'scan' && snapshot.phase === 'paused'}<DialogActionButton variant="primary" data-dialog-default onclick={() => retryScan(true)} disabled={!!guardIssue}>{$t('files.batchRules.resumeScan')}</DialogActionButton>{/if}
          <DialogActionButton onclick={backToEdit} disabled={refreshing}>{$t('files.batchRules.backToEdit')}</DialogActionButton>
          <DialogActionButton onclick={close} disabled={refreshing}>{$t('common.close')}</DialogActionButton>
        {/if}
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
  .batch-rules-layout { display: flex; min-height: 0; max-height: 78vh; flex-direction: column; color: var(--color-md3-on-surface); font-size: 14px; }
  .batch-rules-context, .batch-rules-summary { flex: none; padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--color-md3-outline); }
  .batch-rules-context p, .batch-rules-summary p { margin-block: 0.25rem; overflow-wrap: anywhere; }
  .batch-rules-step { font-weight: 600; }
  .batch-rules-muted { color: var(--color-md3-on-surface-variant); font-size: 12px; }
  .batch-rules-warning { color: var(--color-md3-error); overflow-wrap: anywhere; }
  .batch-rules-template, .batch-rules-choice, .batch-rules-status, .batch-rules-filter { display: flex; align-items: center; gap: 12px; }
  .batch-rules-template { min-width: 0; flex-wrap: wrap; margin-block: 0.5rem; }
  .batch-rules-choice { font-size: 12px; cursor: pointer; }
  .batch-rules-choice > span { min-width: 0; }
  select { max-width: 100%; min-height: 2rem; min-width: 0; border: 1px solid var(--color-md3-outline); border-radius: var(--borderRadiusMedium); padding: 0.3rem 0.5rem; background: var(--color-md3-field); color: var(--color-md3-on-surface); }
  .batch-rules-template select { max-width: 22rem; }
  .batch-rules-editor { display: flex; min-height: 0; flex: 1; flex-direction: column; }
  .batch-rules-editor[hidden] { display: none; }
  .batch-rules-editor-footer { flex: none; border-top: 1px solid var(--color-md3-outline); }
  .batch-rules-editor-footer > .batch-rules-choice { margin: 0.6rem 1.25rem 0; }
  .batch-rules-editor-footer .batch-rules-actions { border: 0; }
  .batch-rules-filter { flex: none; padding: 0.6rem 1.25rem; }
  .batch-rules-layout :global(.batch-rules-results) { flex: 1; min-height: 100px; max-height: 38vh; overflow: auto; }
  .batch-rules-result { display: flex; align-items: flex-start; gap: 12px; padding: 0.75rem 1.25rem; border-bottom: 1px solid var(--color-md3-outline); }
  .batch-rules-result-copy { min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .batch-rules-result p { margin-top: 0.2rem; }
  .batch-rules-result > span { flex: none; font-size: 12px; }
  .batch-rules-success { color: var(--color-md3-success); }
  .batch-rules-current { font-weight: 600; }
  .batch-rules-issue-row { padding-block: 0.5rem; overflow-wrap: anywhere; border-bottom: 1px solid var(--color-md3-outline); }
  .batch-rules-issue-row p { margin-block: 0.25rem 0; }
  .batch-rules-actions, .batch-rules-recovery { display: flex; flex: none; flex-wrap: wrap; gap: 8px; padding: 0.75rem 1.25rem; }
  .batch-rules-actions { justify-content: flex-end; border-top: 1px solid var(--color-md3-outline); }
  .batch-rules-empty { padding: 1rem 1.25rem; }
  progress { width: 100%; height: 0.3rem; accent-color: var(--color-md3-primary); margin-top: 0.65rem; }
  .batch-rules-confirmation { padding: 1.25rem; font-size: 14px; }
  .batch-rules-confirmation > * + * { margin-top: 0.75rem; }
  .batch-rules-confirmation :global(.batch-rules-issues), .batch-rules-confirmation :global(.batch-rules-scope-list) { max-height: 24vh; overflow: auto; margin-top: 0.5rem; }
  summary { cursor: pointer; font-weight: 600; }
  @media (max-width: 640px) {
    .batch-rules-layout { max-height: 82vh; }
    .batch-rules-context, .batch-rules-summary, .batch-rules-actions, .batch-rules-recovery, .batch-rules-confirmation { padding: 0.75rem; }
    .batch-rules-editor-footer > .batch-rules-choice { margin-inline: 0.75rem; }
    .batch-rules-template select { flex: 1; }
    .batch-rules-result { padding-inline: 0.75rem; }
    .batch-rules-result > span { max-width: 5rem; overflow-wrap: anywhere; }
  }
  @media (pointer: coarse) {
    select, .batch-rules-choice { min-height: 2.5rem; }
  }
</style>
