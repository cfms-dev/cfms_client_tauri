import type { ListDirectoryPageResponse, ServerObjectType } from '$lib/api/types';
import { serverAvailability, serverErrorStatus } from '$lib/api/server-errors';
import { cloneAccessRules, validateAccessRules, type AccessRulesRecord } from '$lib/features/access/access-rules';
import { DirectoryLoadController, type DirectoryPageFetcher } from '$lib/features/files/directory-load-controller';
import { DIRECTORY_PAGE_SIZE } from '$lib/features/files/progressive-listing';

export interface BatchRulesTarget {
  objectType: ServerObjectType;
  objectId: string;
  name: string;
  path?: string;
}

export type BatchRulesProblemKind = 'identity' | 'session' | 'permission' | 'disconnected'
  | 'lockdown' | 'temporary' | 'denied' | 'missing' | 'rejected' | 'unconfirmed'
  | 'invalid_response' | 'cycle' | 'cursor' | 'stopped';

export interface BatchRulesProblem {
  kind: BatchRulesProblemKind;
  status?: number;
  error?: unknown;
}

export interface BatchRulesIdentity {
  server: string | null;
  username: string | null;
}

export interface BatchRulesSession extends BatchRulesIdentity {
  loggedIn: boolean;
  permitted: boolean;
  connected: boolean;
  lockdown: boolean;
  bypassLockdown: boolean;
}

export function batchRulesSessionProblem(expected: BatchRulesIdentity, current: BatchRulesSession): BatchRulesProblem | null {
  if (expected.server !== current.server || expected.username !== current.username) return { kind: 'identity' };
  if (!current.loggedIn) return { kind: 'session' };
  if (!current.permitted) return { kind: 'permission' };
  if (current.lockdown && !current.bypassLockdown) return { kind: 'lockdown' };
  if (!current.connected) return { kind: 'disconnected' };
  return null;
}

export type BatchRulesItemStatus = 'pending' | 'success' | 'failed' | 'unconfirmed';
export type BatchRulesFailureAction = 'retry' | 'skip' | 'skip_all' | 'cancel';
export interface BatchRulesItemResult {
  target: BatchRulesTarget;
  status: BatchRulesItemStatus;
  problem?: BatchRulesProblem;
  skipped?: boolean;
}
export interface BatchRulesScanIssue {
  target: BatchRulesTarget;
  problem: BatchRulesProblem;
}

export interface BatchRulesSnapshot {
  phase: 'idle' | 'scanning' | 'ready' | 'running' | 'waiting' | 'deciding' | 'paused' | 'stopped' | 'finished';
  operation: 'scan' | 'apply';
  targets: BatchRulesTarget[];
  results: BatchRulesItemResult[];
  scanIssues: BatchRulesScanIssue[];
  scanComplete: boolean;
  started: boolean;
  runCompleted: number;
  runTotal: number;
  activeKey: string | null;
  waitingUntil: number | null;
  retryAt: number;
  stopRequested: boolean;
  stopReason: BatchRulesProblem | null;
}

interface Dependencies {
  fetchPage: DirectoryPageFetcher;
  setRules: (type: ServerObjectType, id: string, rules: AccessRulesRecord, inherit: boolean) => Promise<boolean>;
  guard: () => BatchRulesProblem | null;
  onChange: (snapshot: BatchRulesSnapshot) => void;
  resolveFailure?: (target: BatchRulesTarget, problem: BatchRulesProblem, signal: AbortSignal) => Promise<BatchRulesFailureAction>;
  requestTimeoutMs?: number;
  initialRetryAt?: number;
}

type RequestOutcome<T> = { ok: true; value: T } | {
  ok: false;
  problem: BatchRulesProblem;
  halt: boolean;
  sent: boolean;
};

export function batchRulesTargetKey(target: BatchRulesTarget): string {
  return `${target.objectType}:${target.objectId}`;
}

/** One in-memory batch. All writes use an immutable draft and a frozen manifest. */
export class BatchAccessRulesController {
  private phase: BatchRulesSnapshot['phase'] = 'idle';
  private operation: BatchRulesSnapshot['operation'] = 'scan';
  private manifest = new Map<string, BatchRulesTarget>();
  private children = new Map<string, Set<string>>();
  private scanQueue: BatchRulesTarget[] = [];
  private scanIndex = 0;
  private scanCursor: string | null = null;
  private cursors = new Set<string>();
  private issues = new Map<string, BatchRulesScanIssue>();
  private scanComplete = false;
  private results: BatchRulesItemResult[] = [];
  private rules: AccessRulesRecord = {};
  private inherit = true;
  private started = false;
  private runCompleted = 0;
  private runTotal = 0;
  private busy = false;
  private disposed = false;
  private stopRequested = false;
  private stopReason: BatchRulesProblem | null = null;
  private activeKey: string | null = null;
  private waitingUntil: number | null = null;
  private retryAt = 0;
  private wakeWait: (() => void) | null = null;
  private failureDecision: AbortController | null = null;
  private loader: DirectoryLoadController;
  private generation = 0;
  private roots: BatchRulesTarget[];

  constructor(targets: BatchRulesTarget[], private readonly dependencies: Dependencies) {
    this.roots = [...new Map(targets.map((target) => [batchRulesTargetKey(target), { ...target }])).values()];
    this.loader = new DirectoryLoadController(dependencies.fetchPage, dependencies.requestTimeoutMs);
    this.retryAt = dependencies.initialRetryAt ?? 0;
  }

  get snapshot(): BatchRulesSnapshot {
    return {
      phase: this.phase, operation: this.operation, targets: [...this.manifest.values()],
      results: [...this.results], scanIssues: [...this.issues.values()], scanComplete: this.scanComplete,
      started: this.started, runCompleted: this.runCompleted, runTotal: this.runTotal,
      activeKey: this.activeKey, waitingUntil: this.waitingUntil,
      retryAt: this.retryAt, stopRequested: this.stopRequested, stopReason: this.stopReason,
    };
  }

  async discover(rules: AccessRulesRecord, inherit: boolean, recursive: boolean): Promise<void> {
    if (this.busy || this.started || this.disposed) return;
    validateAccessRules(rules);
    this.rules = cloneAccessRules(rules);
    this.inherit = inherit;
    this.manifest.clear();
    this.children.clear();
    this.issues.clear();
    this.results = [];
    this.scanQueue = [];
    this.scanIndex = 0;
    this.scanCursor = null;
    this.cursors.clear();
    this.scanComplete = !recursive;
    this.operation = 'scan';
    this.generation = this.loader.begin();
    for (const root of this.roots) this.addTarget(root, recursive);
    if (!recursive) {
      this.resetStop();
      this.finishScan();
      return;
    }
    await this.resumeScan();
  }

  async resumeScan(): Promise<void> {
    if (this.busy || this.started || this.scanComplete || this.disposed) return;
    await this.withOperation('scan', async () => {
      while (this.scanIndex < this.scanQueue.length) {
        const target = this.scanQueue[this.scanIndex];
        this.activeKey = batchRulesTargetKey(target);
        this.emit();
        const outcome = await this.request(
          () => this.loader.requestPage(this.generation, target.objectId, this.scanCursor, DIRECTORY_PAGE_SIZE),
          validDirectoryPage,
        );
        if (!outcome.ok) {
          if (outcome.halt) {
            this.halt(outcome.problem);
            return;
          }
          this.issues.set(this.activeKey, { target, problem: outcome.problem });
          this.nextDirectory();
          continue;
        }
        const page = outcome.value!;
        const parentKey = batchRulesTargetKey(target);
        const childKeys = this.children.get(parentKey) ?? new Set<string>();
        for (const folder of page.folders) {
          const child: BatchRulesTarget = {
            objectType: 'directory', objectId: folder.id, name: folder.name,
            path: `${target.path ?? target.name}/${folder.name}`,
          };
          this.addTarget(child, true);
          childKeys.add(batchRulesTargetKey(child));
        }
        for (const doc of page.documents) {
          const child: BatchRulesTarget = {
            objectType: 'document', objectId: doc.id, name: doc.title,
            path: `${target.path ?? target.name}/${doc.title}`,
          };
          this.addTarget(child, true);
          childKeys.add(batchRulesTargetKey(child));
        }
        this.children.set(parentKey, childKeys);
        if (!page.has_more) this.nextDirectory();
        else if (typeof page.next_cursor !== 'string' || !page.next_cursor || this.cursors.has(page.next_cursor)) {
          this.issues.set(parentKey, { target, problem: { kind: 'cursor' } });
          this.nextDirectory();
        } else {
          this.cursors.add(page.next_cursor);
          this.scanCursor = page.next_cursor;
        }
        this.emit();
        if (this.currentStop()) {
          this.halt(this.currentStop()!);
          return;
        }
      }
      this.scanComplete = true;
      this.finishScan();
    });
  }

  async apply(allowIncomplete = false): Promise<void> {
    if (this.phase !== 'ready' || (!allowIncomplete && this.issues.size > 0)) return;
    this.started = true;
    await this.execute((item) => item.status === 'pending');
  }

  async retryFailed(): Promise<void> {
    await this.execute((item) => item.status === 'failed');
  }

  async continuePending(): Promise<void> {
    await this.execute((item) => item.status === 'pending' || (item.status === 'failed'
      && ['temporary', 'session', 'lockdown'].includes(item.problem?.kind ?? '')));
  }

  /** Must be invoked only after the UI explicitly confirms another write. */
  async resubmitUnconfirmed(): Promise<void> {
    await this.execute((item) => item.status === 'unconfirmed');
  }

  stop(reason: BatchRulesProblem = { kind: 'stopped' }): void {
    this.stopRequested = true;
    this.stopReason = reason;
    this.wakeWait?.();
    this.failureDecision?.abort();
    if (!this.busy) this.phase = 'stopped';
    this.emit();
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.loader.invalidate();
  }

  private addTarget(target: BatchRulesTarget, recursive: boolean): void {
    const key = batchRulesTargetKey(target);
    if (this.manifest.has(key)) return;
    this.manifest.set(key, { ...target });
    if (recursive && target.objectType === 'directory') this.scanQueue.push(target);
  }

  private nextDirectory(): void {
    this.scanIndex += 1;
    this.scanCursor = null;
    this.cursors.clear();
  }

  private finishScan(): void {
    // Iterative postorder handles both overlapping roots and very deep trees.
    const visited = new Set<string>();
    const active = new Set<string>();
    const ordered: BatchRulesItemResult[] = [];
    for (const rootKey of this.manifest.keys()) {
      const stack: { key: string; exit: boolean }[] = [{ key: rootKey, exit: false }];
      while (stack.length) {
        const frame = stack.pop()!;
        if (frame.exit) {
          active.delete(frame.key);
          visited.add(frame.key);
          ordered.push({ target: this.manifest.get(frame.key)!, status: 'pending' });
        } else if (active.has(frame.key)) {
          const target = this.manifest.get(frame.key)!;
          this.issues.set(frame.key, { target, problem: { kind: 'cycle' } });
        } else if (!visited.has(frame.key)) {
          active.add(frame.key);
          stack.push({ key: frame.key, exit: true });
          for (const key of [...(this.children.get(frame.key) ?? [])].reverse()) stack.push({ key, exit: false });
        }
      }
    }
    this.results = ordered;
    this.activeKey = null;
    this.phase = 'ready';
    this.emit();
  }

  private async execute(select: (item: BatchRulesItemResult) => boolean): Promise<void> {
    if (!this.started || this.busy || this.disposed) return;
    const indices = this.results.flatMap((item, index) => select(item) ? [index] : []);
    if (!indices.length) return;
    this.runCompleted = 0;
    this.runTotal = indices.length;
    const skippedProblems = new Set<string>();
    await this.withOperation('apply', async () => {
      for (const index of indices) {
        const item = this.results[index];
        this.activeKey = batchRulesTargetKey(item.target);
        let attempted = false;
        while (true) {
          this.emit();
          const outcome = await this.request(
            () => this.dependencies.setRules(item.target.objectType, item.target.objectId, cloneAccessRules(this.rules), this.inherit),
            (value) => value === true,
          );
          if (outcome.ok) this.results[index] = { target: item.target, status: 'success' };
          else if (outcome.sent) this.results[index] = {
            target: item.target,
            status: ['unconfirmed', 'invalid_response'].includes(outcome.problem.kind) ? 'unconfirmed' : 'failed',
            problem: outcome.problem,
          };
          attempted ||= outcome.ok || outcome.sent;
          this.emit();
          const stop = this.currentStop();
          if ((!outcome.ok && outcome.halt) || stop) {
            if (attempted) this.runCompleted += 1;
            this.halt(stop ?? (!outcome.ok ? outcome.problem : { kind: 'stopped' }));
            return;
          }
          if (outcome.ok || !this.dependencies.resolveFailure) break;

          const problemKey = `${outcome.problem.kind}:${outcome.problem.status ?? ''}`;
          const action = skippedProblems.has(problemKey) ? 'skip'
            : await this.decideFailure(item.target, outcome.problem);
          const stoppedAfterDecision = this.currentStop();
          if (stoppedAfterDecision || action === 'cancel') {
            if (attempted) this.runCompleted += 1;
            this.halt(stoppedAfterDecision ?? { kind: 'stopped' });
            return;
          }
          if (action === 'retry') continue;
          if (action === 'skip_all') skippedProblems.add(problemKey);
          this.results[index] = { ...this.results[index], skipped: true };
          break;
        }
        if (attempted) this.runCompleted += 1;
        this.emit();
      }
      this.phase = 'finished';
    });
  }

  private async decideFailure(target: BatchRulesTarget, problem: BatchRulesProblem): Promise<BatchRulesFailureAction> {
    const decision = new AbortController();
    this.failureDecision = decision;
    this.phase = 'deciding';
    this.emit();
    let onAbort!: () => void;
    const aborted = new Promise<BatchRulesFailureAction>((resolve) => {
      onAbort = () => resolve('cancel');
      if (decision.signal.aborted) onAbort();
      else decision.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      if (this.currentStop()) {
        decision.abort();
        return 'cancel';
      }
      // A UI resolver may ignore abort or settle much later; stopping still wakes this operation.
      const answer = Promise.resolve().then((): BatchRulesFailureAction | Promise<BatchRulesFailureAction> =>
        decision.signal.aborted ? 'cancel'
          : this.dependencies.resolveFailure!({ ...target }, { ...problem }, decision.signal),
      ).catch((): BatchRulesFailureAction => 'cancel');
      return await Promise.race([answer, aborted]);
    } finally {
      decision.signal.removeEventListener('abort', onAbort);
      if (this.failureDecision === decision) this.failureDecision = null;
      this.phase = 'running';
    }
  }

  private async withOperation(operation: BatchRulesSnapshot['operation'], run: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.operation = operation;
    this.resetStop();
    this.phase = operation === 'scan' ? 'scanning' : 'running';
    this.emit();
    try {
      await run();
    } finally {
      this.busy = false;
      this.activeKey = null;
      this.waitingUntil = null;
      this.emit();
    }
  }

  private async request<T>(send: () => Promise<T>, accept: (value: T) => boolean): Promise<RequestOutcome<T>> {
    for (let attempt = 0; ; attempt += 1) {
      const stop = this.currentStop();
      if (stop) return { ok: false, problem: stop, halt: true, sent: false };
      if (!(await this.waitUntil(this.retryAt))) {
        return { ok: false, problem: this.currentStop() ?? { kind: 'stopped' }, halt: true, sent: false };
      }
      const stoppedAfterWait = this.currentStop();
      if (stoppedAfterWait) return { ok: false, problem: stoppedAfterWait, halt: true, sent: false };
      try {
        const value = await send();
        if (!accept(value)) return { ok: false, problem: { kind: 'invalid_response' }, halt: true, sent: true };
        return { ok: true, value };
      } catch (error) {
        const status = serverErrorStatus(error);
        const availability = serverAvailability(error);
        if (availability) {
          const delay = availability.retryAfterSeconds ?? (attempt === 0 ? 2 : 4);
          this.retryAt = Date.now() + delay * 1_000;
          const problem: BatchRulesProblem = { kind: 'temporary', status: status!, error };
          if (attempt >= 2 || this.currentStop()) return { ok: false, problem, halt: true, sent: true };
          if (!(await this.waitUntil(this.retryAt))) return { ok: false, problem, halt: true, sent: true };
          continue;
        }
        const kind: BatchRulesProblemKind = status === 401 ? 'session' : status === 999 ? 'lockdown'
          : status === 403 ? 'denied' : status === 404 ? 'missing' : status === null ? 'unconfirmed' : 'rejected';
        return { ok: false, problem: { kind, status: status ?? undefined, error },
          halt: ['session', 'lockdown', 'unconfirmed'].includes(kind), sent: true };
      }
    }
  }

  private async waitUntil(until: number): Promise<boolean> {
    while (until > Date.now()) {
      if (this.currentStop()) return false;
      this.waitingUntil = until;
      this.phase = 'waiting';
      this.emit();
      if (this.currentStop()) return false;
      await new Promise<void>((resolve) => {
        // Long server delays are chunked without shortening the advised wait.
        const timer = setTimeout(done, Math.min(until - Date.now(), 60_000));
        const self = this;
        function done() {
          clearTimeout(timer);
          self.wakeWait = null;
          resolve();
        }
        this.wakeWait = done;
      });
    }
    this.waitingUntil = null;
    this.phase = this.operation === 'scan' ? 'scanning' : 'running';
    return !this.currentStop();
  }

  private currentStop(): BatchRulesProblem | null {
    return this.stopRequested || this.disposed ? this.stopReason ?? { kind: 'stopped' } : this.dependencies.guard();
  }

  private resetStop(): void {
    this.stopRequested = false;
    this.stopReason = null;
  }

  private halt(problem: BatchRulesProblem): void {
    this.stopReason = this.stopRequested ? this.stopReason : problem;
    this.phase = !this.stopRequested && problem.kind === 'temporary' ? 'paused' : 'stopped';
    this.emit();
  }

  private emit(): void {
    if (!this.disposed) this.dependencies.onChange(this.snapshot);
  }
}

function validDirectoryPage(value: ListDirectoryPageResponse | null): boolean {
  return value != null && Array.isArray(value.folders) && Array.isArray(value.documents)
    && typeof value.has_more === 'boolean'
    && value.folders.every((folder) => typeof folder.id === 'string' && folder.id.length > 0 && typeof folder.name === 'string')
    && value.documents.every((doc) => typeof doc.id === 'string' && doc.id.length > 0 && typeof doc.title === 'string');
}
