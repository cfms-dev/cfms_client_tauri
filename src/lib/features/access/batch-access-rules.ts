import { prepareAccessBatch, getAccessBatch, getAccessBatchChanges, runAccessBatch, stopAccessBatch, disposeAccessBatch, decideAccessBatch } from '$lib/api';
import { listen, type UnlistenFn } from '$lib/shared/platform/native-events';
import type { ServiceEvent, BatchRulesTarget, BatchRulesProblem, BatchRulesIdentity, BatchRulesSession, BatchRulesSnapshot, BatchRulesFailureAction } from '$lib/api/types';
import type { AccessRulesRecord } from './access-rules';
export type { BatchRulesTarget, BatchRulesProblem, BatchRulesIdentity, BatchRulesSession, BatchRulesSnapshot, BatchRulesFailureAction, BatchRulesItemStatus, BatchRulesItemResult, BatchRulesProblemKind } from '$lib/api/types';
export function batchRulesSessionProblem(expected: BatchRulesIdentity, current: BatchRulesSession): BatchRulesProblem | null {
  if (expected.server !== current.server || expected.userId !== current.userId) return { kind: 'identity' };
  if (!current.loggedIn) return { kind: 'session' };
  if (!current.permitted) return { kind: 'permission' };
  if (current.lockdown && !current.bypassLockdown) return { kind: 'lockdown' };
  if (!current.connected) return { kind: 'disconnected' };
  return null;
}


export function batchRulesTargetKey(target: BatchRulesTarget): string { return `${target.objectType}:${target.objectId}`; }
interface Dependencies {
  guard: () => BatchRulesProblem | null;
  onChange: (snapshot: BatchRulesSnapshot) => void;
  resolveFailure?: (target: BatchRulesTarget, problem: BatchRulesProblem, signal: AbortSignal) => Promise<BatchRulesFailureAction>;
}
/** UI adapter only: native services own scanning, mutation order, retries and cancellation. */
export class BatchAccessRulesController {
  snapshot: BatchRulesSnapshot = { phase: 'idle', operation: 'scan', targets: [], results: [], scanIssues: [], scanComplete: false, started: false, runCompleted: 0, runTotal: 0, activeKey: null, waitingUntil: null, retryAt: 0, stopRequested: false, stopReason: null };
  private id: string | null = null;
  private disposed = false;
  private unlisten: UnlistenFn | null = null;
  private revision = 0;
  private pendingRefresh: Promise<void> | null = null;
  private refreshRequested = false;
  private deciding: number | null = null;
  private decision: AbortController | null = null;
  constructor(private roots: BatchRulesTarget[], private dependencies: Dependencies) {}
  async discover(rules: AccessRulesRecord, inherit: boolean, recursive: boolean) {
    if (this.disposed) return;
    if (this.id) await disposeAccessBatch(this.id);
    this.revision = 0;
    this.snapshot = { ...this.snapshot, results: [], targets: [] };
    if (!this.unlisten) {
      const unlisten = await listen<ServiceEvent>('cfms:event', ({ payload }) => {
        if (payload.event === 'AccessBatchChanged' && payload.data.id === this.id && !this.disposed) void this.refresh().catch(() => {});
      });
      if (this.disposed) { unlisten(); return; }
      this.unlisten = unlisten;
    }
    const id = await prepareAccessBatch(this.roots, rules, inherit, recursive);
    if (this.disposed) { await disposeAccessBatch(id); return; }
    this.id = id;
    await this.run('scan');
  }
  private refresh(): Promise<void> {
    this.refreshRequested = true;
    if (this.pendingRefresh) return this.pendingRefresh;
    this.pendingRefresh = (async () => {
      do {
        this.refreshRequested = false;
        await this.readSnapshot();
      } while (this.refreshRequested && !this.disposed);
    })().finally(() => { this.pendingRefresh = null; });
    return this.pendingRefresh;
  }
  private async readSnapshot() {
    const id = this.id;
    if (!id || this.disposed) return;
    const native = await getAccessBatch(id);
    const results = [...this.snapshot.results];
    while (true) {
      const changes = await getAccessBatchChanges(id, this.revision);
      if (this.disposed || id !== this.id) return;
      for (const change of changes) {
        results[change.index] = change.item;
        this.revision = Math.max(this.revision, change.revision);
      }
      if (changes.length < 128) break;
    }
    if (this.disposed || id !== this.id) return;
    this.snapshot = { ...native, results: results.filter(Boolean), targets: results.filter(Boolean).map(item => item.target) };
    this.dependencies.onChange(this.snapshot);
    const prompt = native.decision;
    if (!prompt) {
      this.decision?.abort();
      this.decision = null;
      this.deciding = null;
    }
    if (prompt && this.deciding !== prompt.ticket) {
      this.deciding = prompt.ticket;
      const decision = new AbortController();
      this.decision = decision;
      void Promise.resolve().then(() => {
        if (this.disposed || decision.signal.aborted) return 'cancel' as const;
        return this.dependencies.resolveFailure?.(prompt.target, prompt.problem, decision.signal) ?? 'skip';
      }).then(answer => {
        if (!this.disposed && !decision.signal.aborted && this.id === id) return decideAccessBatch(id, prompt.ticket, answer);
      }).catch(() => {
        if (!this.disposed && !decision.signal.aborted) return decideAccessBatch(id, prompt.ticket, 'cancel');
      }).catch(() => {});
    }
  }
  private async run(command: string, allowIncomplete = false) {
    if (!this.id || this.disposed) return;
    const problem = this.dependencies.guard();
    if (problem) { this.stop(problem); return; }
    try { await runAccessBatch(this.id, command, allowIncomplete); }
    finally { await this.refresh(); }
  }
  resumeScan() { return this.run('scan'); }
  apply(allowIncomplete = false) { return this.run('apply', allowIncomplete); }
  retryFailed() { return this.run('retry'); }
  continuePending() { return this.run('continue'); }
  resubmitUnconfirmed() { return this.run('resubmit'); }
  stop(reason?: BatchRulesProblem) {
    this.decision?.abort();
    if (this.id) void stopAccessBatch(this.id, reason).then(() => this.refresh()).catch(() => {});
  }
  dispose() {
    this.disposed = true; this.decision?.abort(); this.unlisten?.(); this.unlisten = null;
    if (this.id) void disposeAccessBatch(this.id).catch(() => {});
  }
}
