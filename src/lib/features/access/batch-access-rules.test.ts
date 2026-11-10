import { describe, expect, it, vi } from 'vitest';
import { BatchAccessRulesController, batchRulesSessionProblem } from './batch-access-rules';
import { prepareAccessBatch, runAccessBatch, getAccessBatch, getAccessBatchChanges, disposeAccessBatch } from '$lib/api';
import { deferred } from '../../../test/deferred';
vi.mock('$lib/api', () => ({ prepareAccessBatch: vi.fn(), runAccessBatch: vi.fn(), getAccessBatch: vi.fn(), getAccessBatchChanges: vi.fn(), stopAccessBatch: vi.fn(), disposeAccessBatch: vi.fn().mockResolvedValue(undefined), decideAccessBatch: vi.fn() }));
vi.mock('$lib/shared/platform/native-events', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
const target = { objectType: 'document' as const, objectId: 'a', name: 'A' };
describe('native access batch adapter', () => {
  it('loads paged native item changes and delegates writes without interpreting them', async () => {
    vi.mocked(prepareAccessBatch).mockResolvedValue('batch');
    vi.mocked(runAccessBatch).mockResolvedValue(undefined);
    vi.mocked(getAccessBatch).mockResolvedValue({ phase: 'ready', operation: 'scan', scanIssues: [], scanComplete: true, started: false, runCompleted: 0, runTotal: 0, activeKey: null, waitingUntil: null, retryAt: 0, stopRequested: false, stopReason: null, targetCount: 1, revision: 1, decision: null });
    vi.mocked(getAccessBatchChanges).mockResolvedValueOnce([{ index: 0, revision: 1, item: { target, status: 'pending' } }]).mockResolvedValue([]);
    const change = vi.fn();
    const controller = new BatchAccessRulesController([target], { guard: () => null, onChange: change });
    await controller.discover({}, true, false);
    expect(controller.snapshot.results).toEqual([{ target, status: 'pending' }]);
    await controller.apply();
    expect(runAccessBatch).toHaveBeenLastCalledWith('batch', 'apply', false);
    controller.dispose();
    expect(disposeAccessBatch).toHaveBeenCalledWith('batch');
  });
  it('disposes a native batch created after its view has closed', async () => {
    const created = deferred<string>();
    vi.mocked(prepareAccessBatch).mockReturnValueOnce(created.promise);
    const change = vi.fn();
    const controller = new BatchAccessRulesController([target], { guard: () => null, onChange: change });
    const discovery = controller.discover({}, true, false);
    await vi.waitFor(() => expect(prepareAccessBatch).toHaveBeenCalled());
    controller.dispose(); created.resolve('late'); await discovery;
    expect(disposeAccessBatch).toHaveBeenCalledWith('late'); expect(change).not.toHaveBeenCalled();
  });
  it('keeps the frontend guard as an early UX check', () => {
    const identity = { server: 's', username: 'u' };
    expect(batchRulesSessionProblem(identity, { ...identity, loggedIn: true, permitted: true, connected: true, lockdown: true, bypassLockdown: true })).toBeNull();
    expect(batchRulesSessionProblem(identity, { ...identity, username: 'other', loggedIn: true, permitted: true, connected: true, lockdown: false, bypassLockdown: false })).toEqual({ kind: 'identity' });
  });
});
