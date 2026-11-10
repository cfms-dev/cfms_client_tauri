import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListDirectoryPageResponse } from '$lib/api/types';
import { BatchAccessRulesController, batchRulesSessionProblem, type BatchRulesFailureAction, type BatchRulesProblem, type BatchRulesTarget } from '$lib/features/access/batch-access-rules';

const doc = (id: string): BatchRulesTarget => ({ objectType: 'document', objectId: id, name: id });
const folder = (id: string): BatchRulesTarget => ({ objectType: 'directory', objectId: id, name: id });
const rules = { read: [{ match: 'any' as const, match_groups: [] }] };
function page(folders: string[] = [], documents: string[] = [], cursor: string | null = null): ListDirectoryPageResponse {
  return {
    folders: folders.map((id) => ({ id, name: id, created_time: null })),
    documents: documents.map((id) => ({ id, title: id, size: null, last_modified: null })),
    parent_id: null, has_more: cursor !== null, next_cursor: cursor, page_size: 128,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(targets = [doc('a'), doc('b')], options: { resolveFailures?: boolean; initialRetryAt?: number } = {}) {
  const fetchPage = vi.fn().mockResolvedValue(page());
  const setRules = vi.fn().mockResolvedValue(true);
  const onChange = vi.fn();
  const resolveFailure = vi.fn<(target: BatchRulesTarget, problem: BatchRulesProblem, signal: AbortSignal) => Promise<BatchRulesFailureAction>>()
    .mockResolvedValue('skip');
  let problem: BatchRulesProblem | null = null;
  const controller = new BatchAccessRulesController(targets, {
    fetchPage, setRules, onChange, guard: () => problem, requestTimeoutMs: 0,
    resolveFailure: options.resolveFailures ? resolveFailure : undefined,
    initialRetryAt: options.initialRetryAt,
  });
  return { controller, fetchPage, setRules, resolveFailure, onChange, setGuard: (next: BatchRulesProblem | null) => { problem = next; } };
}
async function flush() { for (let i = 0; i < 20; i += 1) await Promise.resolve(); }

afterEach(() => vi.useRealTimers());

describe('batch access rule discovery', () => {
  it('freezes and deduplicates mixed selected objects without reading their existing rules', async () => {
    const targets = [folder('a'), doc('b'), doc('b')];
    const { controller, fetchPage, setRules } = setup(targets);
    targets[0].objectId = 'changed';
    await controller.discover(rules, true, false);
    await controller.apply();
    expect(fetchPage).not.toHaveBeenCalled();
    expect(setRules.mock.calls.map(([type, id]) => [type, id])).toEqual([['directory', 'a'], ['document', 'b']]);
    expect(controller.snapshot.results.every((item) => item.status === 'success')).toBe(true);
  });

  it('fetches every cursor page, deduplicates overlapping roots and writes descendants first', async () => {
    const { controller, fetchPage, setRules } = setup([folder('root'), folder('child'), doc('file')]);
    fetchPage.mockImplementation(async (id: string, cursor: string | null) => {
      if (id === 'root' && cursor === null) return page(['child'], [], 'next');
      if (id === 'root') return page([], ['file']);
      return id === 'child' ? page(['grandchild'], ['child-file']) : page();
    });
    await controller.discover({}, false, true);
    expect(fetchPage).toHaveBeenCalledWith('root', 'next', 128);
    expect(fetchPage.mock.calls.filter(([id]) => id === 'child')).toHaveLength(1);
    await controller.apply();
    const written = setRules.mock.calls.map(([, id]) => id);
    expect(new Set(written).size).toBe(5);
    expect(written.indexOf('grandchild')).toBeLessThan(written.indexOf('child'));
    expect(written.indexOf('child-file')).toBeLessThan(written.indexOf('child'));
    expect(written.indexOf('child')).toBeLessThan(written.indexOf('root'));
    expect(written.indexOf('file')).toBeLessThan(written.indexOf('root'));
  });

  it('retains discoveries from a partial directory and scans other branches, requiring explicit incomplete coverage approval', async () => {
    const { controller, fetchPage, setRules } = setup([folder('root'), folder('other')]);
    fetchPage.mockImplementation(async (id: string, cursor: string | null) => {
      if (id === 'other') return page([], ['other-file']);
      if (cursor === null) return page([], ['known'], 'next');
      throw 'Server returned 403: denied';
    });
    await controller.discover({}, true, true);
    expect(controller.snapshot.scanIssues).toHaveLength(1);
    expect(controller.snapshot.targets.map((item) => item.objectId)).toContain('other-file');
    await controller.apply();
    expect(setRules).not.toHaveBeenCalled();
    await controller.apply(true);
    expect(setRules).toHaveBeenCalledTimes(4);
    expect(controller.snapshot.scanIssues).toHaveLength(1);
  });

  it.each(['repeat', 'missing'])('detects a %s cursor without looping', async (kind) => {
    const { controller, fetchPage } = setup([folder('root')]);
    fetchPage.mockResolvedValue(kind === 'repeat' ? page([], [], 'same') : { ...page(), has_more: true });
    await controller.discover({}, true, true);
    expect(fetchPage).toHaveBeenCalledTimes(kind === 'repeat' ? 2 : 1);
    expect(controller.snapshot.scanIssues[0].problem.kind).toBe('cursor');
  });

  it('detects hierarchy cycles and produces each known target once', async () => {
    const { controller, fetchPage } = setup([folder('a')]);
    fetchPage.mockImplementation(async (id: string) => page([id === 'a' ? 'b' : 'a']));
    await controller.discover({}, true, true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(controller.snapshot.scanIssues[0].problem.kind).toBe('cycle');
    expect(controller.snapshot.results).toHaveLength(2);
  });

  it('pauses discovery on throttling and resumes from its original cursor after the remaining cooldown', async () => {
    vi.useFakeTimers();
    const { controller, fetchPage } = setup([folder('root')]);
    fetchPage.mockResolvedValueOnce(page([], ['known'], 'next'));
    for (let i = 0; i < 3; i += 1) fetchPage.mockRejectedValueOnce('Server returned 429: slow\nCFMS_ERROR_DATA:{"retry_after_seconds":2}');
    fetchPage.mockResolvedValue(page([], ['last']));
    const scan = controller.discover({}, true, true);
    await flush();
    await vi.advanceTimersByTimeAsync(4_000);
    await scan;
    expect(controller.snapshot.phase).toBe('paused');
    expect(controller.snapshot.scanComplete).toBe(false);
    const resume = controller.resumeScan();
    await flush();
    expect(fetchPage).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(2_000);
    await resume;
    expect(fetchPage).toHaveBeenLastCalledWith('root', 'next', 128);
    expect(controller.snapshot.phase).toBe('ready');
    expect(controller.snapshot.targets).toHaveLength(3);
  });

  it('can restart a failed scan and clears obsolete discoveries and issues', async () => {
    const { controller, fetchPage } = setup([folder('root')]);
    fetchPage.mockRejectedValueOnce('Server returned 404: gone');
    await controller.discover({}, true, true);
    expect(controller.snapshot.scanIssues).toHaveLength(1);
    await controller.discover({}, true, true);
    expect(controller.snapshot.scanIssues).toHaveLength(0);
  });
});

describe('batch access rule execution and recovery', () => {
  it.each([400, 403, 404, 409, 500])('continues after a %s rejection and retries only failed objects', async (status) => {
    const { controller, setRules } = setup();
    setRules.mockRejectedValueOnce(`Server returned ${status}: rejected`);
    await controller.discover({}, true, false);
    await controller.apply();
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['failed', 'success']);
    await controller.retryFailed();
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'b', 'a']);
    expect(controller.snapshot.runTotal).toBe(1);
    expect(controller.snapshot.runCompleted).toBe(1);
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['success', 'success']);
  });

  it.each([401, 999])('stops on %s, preserving pending objects for explicit continuation', async (status) => {
    const { controller, setRules } = setup();
    setRules.mockRejectedValueOnce(`Server returned ${status}: blocked`);
    await controller.discover({}, true, false);
    await controller.apply();
    expect(setRules).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe('stopped');
    await controller.continuePending();
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'a', 'b']);
  });

  it.each([429, 503])('honors %s server delays and makes at most two automatic retries before pausing the whole batch', async (status) => {
    vi.useFakeTimers();
    const { controller, setRules } = setup();
    for (let i = 0; i < 3; i += 1) setRules.mockRejectedValueOnce(`Server returned ${status}: busy\nCFMS_ERROR_DATA:{"retry_after_seconds":5}`);
    await controller.discover({}, true, false);
    const run = controller.apply();
    await flush();
    expect(setRules).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(setRules).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_001);
    await run;
    expect(setRules).toHaveBeenCalledTimes(3);
    expect(controller.snapshot.phase).toBe('paused');
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['failed', 'pending']);
    const resumed = controller.continuePending();
    await flush();
    expect(setRules).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(5_000);
    await resumed;
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'a', 'a', 'a', 'b']);
  });

  it('uses 2 then 4 second fallback delays and allows immediately stopping a wait', async () => {
    vi.useFakeTimers();
    const { controller, setRules } = setup();
    setRules.mockRejectedValue('Server returned 429: slow');
    await controller.discover({}, true, false);
    const run = controller.apply();
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(setRules).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(setRules).toHaveBeenCalledTimes(2);
    controller.stop();
    await run;
    expect(controller.snapshot.phase).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for the in-flight write and retains its real success when stopped', async () => {
    const pending = deferred<boolean>();
    const { controller, setRules } = setup();
    setRules.mockReturnValueOnce(pending.promise);
    await controller.discover({}, true, false);
    const run = controller.apply();
    await flush();
    controller.stop();
    expect(controller.snapshot.stopRequested).toBe(true);
    expect(controller.snapshot.phase).toBe('running');
    pending.resolve(true);
    await run;
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['success', 'pending']);
    await controller.continuePending();
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'b']);
  });

  it.each([false, undefined, null])('treats an unexpected %s acknowledgement as unconfirmed, never as success', async (value) => {
    const { controller, setRules } = setup();
    setRules.mockResolvedValueOnce(value);
    await controller.discover({}, true, false);
    await controller.apply();
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['unconfirmed', 'pending']);
    await controller.retryFailed();
    expect(setRules).toHaveBeenCalledTimes(1);
    await controller.resubmitUnconfirmed();
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'a']);
  });

  it('does not retry transport failures or include uncertain writes in pending continuation', async () => {
    const { controller, setRules } = setup();
    setRules.mockRejectedValueOnce(new Error('Connection failed: no response'));
    await controller.discover({}, true, false);
    await controller.apply();
    expect(setRules).toHaveBeenCalledTimes(1);
    await controller.continuePending();
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'b']);
    expect(controller.snapshot.results[0].status).toBe('unconfirmed');
  });

  it('checks identity and permission before every request without turning unsent objects into failures', async () => {
    const { controller, setRules, setGuard } = setup();
    setRules.mockImplementationOnce(async () => { setGuard({ kind: 'identity' }); return true; });
    await controller.discover({}, true, false);
    await controller.apply();
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['success', 'pending']);
    await controller.continuePending();
    expect(setRules).toHaveBeenCalledTimes(1);
    setGuard(null);
    await controller.continuePending();
    expect(setRules).toHaveBeenCalledTimes(2);
  });

  it('prevents duplicate submissions, ignores callbacks after disposal and never sends the next write', async () => {
    const pending = deferred<boolean>();
    const { controller, setRules, onChange } = setup();
    setRules.mockReturnValueOnce(pending.promise);
    await controller.discover({}, true, false);
    const run = controller.apply();
    await flush();
    await controller.continuePending();
    controller.dispose();
    const callbacks = onChange.mock.calls.length;
    pending.resolve(true);
    await run;
    expect(onChange).toHaveBeenCalledTimes(callbacks);
    expect(setRules).toHaveBeenCalledTimes(1);
  });

  it('keeps the submitted rules immutable across edits and request-side mutation', async () => {
    const { controller, setRules } = setup();
    const draft = { read: [{ match: 'any' as const, match_groups: [] }] };
    await controller.discover(draft, false, false);
    draft.read.length = 0;
    setRules.mockImplementationOnce(async (_type, _id, sentRules) => { sentRules.read.length = 0; return true; });
    await controller.apply();
    expect(setRules.mock.calls[1][2].read).toHaveLength(1);
    expect(setRules.mock.calls[1][3]).toBe(false);
  });
});

describe('batch access rule failure decisions', () => {
  it('waits for a choice, retries the same child before its parent and counts each object once', async () => {
    const choice = deferred<BatchRulesFailureAction>();
    const { controller, fetchPage, setRules, resolveFailure } = setup([folder('root')], { resolveFailures: true });
    fetchPage.mockResolvedValue(page([], ['child']));
    setRules.mockRejectedValueOnce('Server returned 403: denied').mockRejectedValueOnce('Server returned 403: still denied');
    resolveFailure.mockReturnValueOnce(choice.promise).mockResolvedValueOnce('retry');
    await controller.discover({}, true, true);
    const run = controller.apply();
    await flush();
    expect(controller.snapshot.phase).toBe('deciding');
    expect(controller.snapshot.activeKey).toBe('document:child');
    expect(controller.snapshot.runCompleted).toBe(0);
    expect(setRules).toHaveBeenCalledTimes(1);
    await controller.apply();
    await controller.retryFailed();
    expect(setRules).toHaveBeenCalledTimes(1);
    choice.resolve('retry');
    await run;
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['child', 'child', 'child', 'root']);
    expect(resolveFailure).toHaveBeenCalledTimes(2);
    expect(controller.snapshot.runCompleted).toBe(2);
    expect(controller.snapshot.runTotal).toBe(2);
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['success', 'success']);
    expect(controller.snapshot.results.every((item) => item.skipped === undefined)).toBe(true);
  });

  it('records skipped failures, continues processing and clears the skip after an explicit successful retry', async () => {
    const { controller, setRules, resolveFailure } = setup(undefined, { resolveFailures: true });
    setRules.mockRejectedValueOnce('Server returned 403: denied');
    await controller.discover({}, true, false);
    await controller.apply();
    expect(resolveFailure.mock.calls[0].slice(0, 2)).toEqual([doc('a'), expect.objectContaining({ kind: 'denied', status: 403 })]);
    expect(controller.snapshot.results[0]).toMatchObject({ status: 'failed', skipped: true });
    expect(controller.snapshot.results[1].status).toBe('success');
    await controller.retryFailed();
    expect(setRules.mock.calls.map(([, id]) => id)).toEqual(['a', 'b', 'a']);
    expect(controller.snapshot.results[0]).toEqual({ target: doc('a'), status: 'success' });
  });

  it('limits skip-all to matching kind and status in the current execution', async () => {
    const { controller, setRules, resolveFailure } = setup(['a', 'b', 'c', 'd', 'e'].map(doc), { resolveFailures: true });
    for (const status of [403, 403, 404, 400, 500]) setRules.mockRejectedValueOnce(`Server returned ${status}: rejected`);
    resolveFailure.mockResolvedValue('skip_all');
    await controller.discover({}, true, false);
    await controller.apply();
    expect(resolveFailure.mock.calls.map(([, problem]) => problem.status)).toEqual([403, 404, 400, 500]);
    expect(controller.snapshot.results.every((item) => item.status === 'failed' && item.skipped)).toBe(true);
    expect(controller.snapshot.runCompleted).toBe(5);
    setRules.mockRejectedValue('Server returned 403: denied');
    await controller.retryFailed();
    expect(resolveFailure.mock.calls.map(([, problem]) => problem.status)).toEqual([403, 404, 400, 500, 403]);
    expect(setRules).toHaveBeenCalledTimes(10);
    expect(controller.snapshot.runCompleted).toBe(5);
  });

  it('cancels future writes while retaining the confirmed current failure', async () => {
    const { controller, setRules, resolveFailure } = setup(undefined, { resolveFailures: true });
    setRules.mockRejectedValueOnce('Server returned 404: missing');
    resolveFailure.mockResolvedValueOnce('cancel');
    await controller.discover({}, true, false);
    await controller.apply();
    expect(setRules).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe('stopped');
    expect(controller.snapshot.stopReason?.kind).toBe('stopped');
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['failed', 'pending']);
    expect(controller.snapshot.results[0].skipped).toBeUndefined();
    expect(controller.snapshot.runCompleted).toBe(1);
  });

  it.each(['stop', 'dispose'] as const)('wakes a decision on %s even if its resolver ignores abort', async (action) => {
    const choice = deferred<BatchRulesFailureAction>();
    const { controller, setRules, resolveFailure, onChange } = setup(undefined, { resolveFailures: true });
    setRules.mockRejectedValueOnce('Server returned 403: denied');
    resolveFailure.mockReturnValueOnce(choice.promise);
    await controller.discover({}, true, false);
    const run = controller.apply();
    await flush();
    const signal = resolveFailure.mock.calls[0][2];
    expect(signal.aborted).toBe(false);
    controller[action]();
    const callbackCount = onChange.mock.calls.length;
    await run;
    expect(signal.aborted).toBe(true);
    expect(controller.snapshot.phase).toBe('stopped');
    expect(controller.snapshot.runCompleted).toBe(1);
    expect(setRules).toHaveBeenCalledTimes(1);
    if (action === 'dispose') expect(onChange).toHaveBeenCalledTimes(callbackCount);
    const stoppedCallbackCount = onChange.mock.calls.length;
    choice.resolve('retry');
    await flush();
    expect(setRules).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(stoppedCallbackCount);
  });

  it('rechecks the guard after a retry choice and preserves the failure when the next write is unsent', async () => {
    const { controller, setRules, resolveFailure, setGuard } = setup(undefined, { resolveFailures: true });
    setRules.mockRejectedValueOnce('Server returned 403: denied');
    resolveFailure.mockImplementationOnce(async () => { setGuard({ kind: 'identity' }); return 'retry'; });
    await controller.discover({}, true, false);
    await controller.apply();
    expect(setRules).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe('stopped');
    expect(controller.snapshot.stopReason?.kind).toBe('identity');
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['failed', 'pending']);
    expect(controller.snapshot.runCompleted).toBe(1);
  });

  it('stops safely if the failure resolver rejects', async () => {
    const { controller, setRules, resolveFailure } = setup(undefined, { resolveFailures: true });
    setRules.mockRejectedValueOnce('Server returned 403: denied');
    resolveFailure.mockRejectedValueOnce(new Error('Dialog was unavailable'));
    await controller.discover({}, true, false);
    await controller.apply();
    expect(controller.snapshot.phase).toBe('stopped');
    expect(controller.snapshot.results.map((item) => item.status)).toEqual(['failed', 'pending']);
    expect(setRules).toHaveBeenCalledTimes(1);
  });

  it.each([401, 999, null, false])('does not offer ordinary failure decisions for %s', async (problem) => {
    const { controller, setRules, resolveFailure } = setup(undefined, { resolveFailures: true });
    if (problem === false) setRules.mockResolvedValueOnce(false);
    else setRules.mockRejectedValueOnce(problem === null ? new Error('No response') : `Server returned ${problem}: blocked`);
    await controller.discover({}, true, false);
    await controller.apply();
    expect(resolveFailure).not.toHaveBeenCalled();
    expect(controller.snapshot.phase).toBe('stopped');
    expect(setRules).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503])('keeps automatic cooldown and pausing for %s outside the failure dialog', async (status) => {
    vi.useFakeTimers();
    const { controller, setRules, resolveFailure } = setup(undefined, { resolveFailures: true });
    setRules.mockRejectedValue(`Server returned ${status}: busy\nCFMS_ERROR_DATA:{"retry_after_seconds":1}`);
    await controller.discover({}, true, false);
    const run = controller.apply();
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await run;
    expect(setRules).toHaveBeenCalledTimes(3);
    expect(resolveFailure).not.toHaveBeenCalled();
    expect(controller.snapshot.phase).toBe('paused');
  });

  it.each([true, false])('preserves an inherited cooldown before the first request with recursion %s', async (recursive) => {
    vi.useFakeTimers();
    const retryAt = Date.now() + 5_000;
    const { controller, fetchPage, setRules } = setup([folder('root')], { initialRetryAt: retryAt });
    const scan = controller.discover({}, true, recursive);
    const run = recursive ? scan : scan.then(() => controller.apply());
    await flush();
    expect(controller.snapshot.retryAt).toBe(retryAt);
    expect(controller.snapshot.phase).toBe('waiting');
    expect(fetchPage).not.toHaveBeenCalled();
    expect(setRules).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(setRules).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await run;
    if (recursive) expect(fetchPage).toHaveBeenCalledTimes(1);
    else expect(setRules).toHaveBeenCalledTimes(1);
  });
});

describe('batch session guards', () => {
  const identity = { server: 'server', username: 'alice' };
  const session = { ...identity, loggedIn: true, permitted: true, connected: true, lockdown: false, bypassLockdown: false };
  it.each([
    [{ server: 'other' }, 'identity'], [{ username: 'bob' }, 'identity'],
    [{ loggedIn: false }, 'session'], [{ permitted: false }, 'permission'],
    [{ connected: false }, 'disconnected'], [{ lockdown: true }, 'lockdown'],
  ] as const)('guards changed session state %j', (change, kind) => {
    expect(batchRulesSessionProblem(identity, { ...session, ...change })?.kind).toBe(kind);
  });
  it('allows a server-authorized lockdown bypass', () => {
    expect(batchRulesSessionProblem(identity, { ...session, lockdown: true, bypassLockdown: true })).toBeNull();
  });
});
