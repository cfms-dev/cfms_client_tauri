// @vitest-environment jsdom

import { stubInstantAnimations } from '../../../test/dom-fixtures';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { EditorView } from '@codemirror/view';
import BatchAccessRulesDialog from './BatchAccessRulesDialog.svelte';
import { getNodeDacl } from '$lib/api';
import { floatingProgressStore } from '$lib/shared/notifications/progress.svelte.ts';
import { dialogStore } from '$lib/shared/ui/dialogs.svelte.ts';
import type { BatchRulesTarget, BatchRulesProblem, BatchRulesSnapshot, BatchRulesFailureAction } from './batch-access-rules';
import '$lib/shared/i18n';

const controls = vi.hoisted(() => ({
  discover: vi.fn(),
  apply: vi.fn(),
  retryFailed: vi.fn(),
  dispose: vi.fn(),
  failOnce: null as null | { target: BatchRulesTarget; problem: BatchRulesProblem; onAnswer: (ans: BatchRulesFailureAction) => void },
  applySnapshot: null as null | ((roots: BatchRulesTarget[]) => Partial<BatchRulesSnapshot>),
}));

vi.mock('$lib/api', async (original) => ({
  ...(await original<typeof import('$lib/api')>()),
  getNodeDacl: vi.fn(),
  getLocale: vi.fn(),
  setLocale: vi.fn(),
}));

vi.mock('./batch-access-rules', async (original) => {
  const actual = await original<typeof import('./batch-access-rules')>();
  return {
    ...actual,
    BatchAccessRulesController: class {
      snapshot: BatchRulesSnapshot = {
        phase: 'idle',
        operation: 'scan',
        targets: [],
        results: [],
        scanIssues: [],
        scanComplete: false,
        started: false,
        runCompleted: 0,
        runTotal: 0,
        activeKey: null,
        waitingUntil: null,
        retryAt: 0,
        stopRequested: false,
        stopReason: null,
      };
      constructor(
        private roots: BatchRulesTarget[],
        private dependencies: {
          onChange: (snapshot: BatchRulesSnapshot) => void;
          resolveFailure?: (target: BatchRulesTarget, problem: BatchRulesProblem, signal: AbortSignal) => Promise<BatchRulesFailureAction>;
        },
      ) {}
      async discover(...args: unknown[]) {
        await controls.discover(...args);
        this.snapshot = {
          ...this.snapshot,
          phase: 'ready',
          targets: this.roots,
          scanComplete: true,
          results: this.roots.map((target) => ({ target, status: 'pending' })),
        };
        this.dependencies.onChange(this.snapshot);
      }
      async apply(...args: unknown[]) {
        await controls.apply(...args);
        if (controls.failOnce && this.dependencies.resolveFailure) {
          const failure = controls.failOnce;
          controls.failOnce = null;
          this.snapshot = { ...this.snapshot, phase: 'deciding' };
          this.dependencies.onChange(this.snapshot);
          const ac = new AbortController();
          const ans = await this.dependencies.resolveFailure(failure.target, failure.problem, ac.signal);
          failure.onAnswer(ans);
        }
        const override = controls.applySnapshot ? controls.applySnapshot(this.roots) : null;
        this.snapshot = {
          ...this.snapshot,
          phase: 'finished',
          started: true,
          results: this.roots.map((target) => ({ target, status: 'success' })),
          runCompleted: this.roots.length,
          runTotal: this.roots.length,
          ...override,
        };
        this.dependencies.onChange(this.snapshot);
      }
      async retryFailed(...args: unknown[]) {
        await controls.retryFailed(...args);
        this.snapshot = {
          ...this.snapshot,
          phase: 'finished',
          started: true,
          results: this.roots.map((target) => ({ target, status: 'success' })),
          runCompleted: this.roots.length,
          runTotal: this.roots.length,
        };
        this.dependencies.onChange(this.snapshot);
      }
      dispose() { controls.dispose(); }
      stop() {}
    },
  };
});

const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
beforeEach(stubInstantAnimations);

const targets: BatchRulesTarget[] = [
  { objectType: 'directory', objectId: 'folder', name: 'Documents', path: '/Documents' },
  { objectType: 'document', objectId: 'document', name: 'Report.txt', path: '/Report.txt' },
];
const recursiveLabel = 'Also apply these rules to subfolders and documents';
const scopeTitle = 'Confirm access rule changes';

type Props = {
  targets: BatchRulesTarget[];
  initialTemplateKey?: string;
  canListUsers?: boolean;
  canListGroups?: boolean;
  checkGuard: () => BatchRulesProblem | null;
  onApplied: () => Promise<void>;
  onClose: () => void;
};

function setup(options: Partial<Props> = {}) {
  const onApplied = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const props: Props = {
    targets,
    canListUsers: false,
    canListGroups: false,
    checkGuard: () => null,
    onApplied,
    onClose,
    ...options,
  };
  const view = render(BatchAccessRulesDialog, props);
  return { ...view, onApplied, onClose, props };
}

async function initialized(name?: string) {
  if (name) await screen.findByText('Shared rule template from: ' + name);
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'OK' }).disabled).toBe(false));
}

async function confirmScope(count = 2) {
  const modal = await screen.findByRole('dialog', { name: scopeTitle });
  await fireEvent.click(within(modal).getByRole('button', { name: `Apply to ${count} objects` }));
}

async function source(text: string) {
  await fireEvent.click(screen.getByRole('button', { name: 'Source Code' }));
  const content = await screen.findByLabelText('Access rules');
  const editor = EditorView.findFromDOM(content)!;
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  await tick();
  return editor;
}

beforeEach(() => {
  vi.clearAllMocks();
  controls.discover.mockResolvedValue(undefined);
  controls.apply.mockResolvedValue(undefined);
  controls.retryFailed.mockResolvedValue(undefined);
  controls.failOnce = null;
  controls.applySnapshot = null;
  floatingProgressStore.clear();
  locale.set('en');
  document.documentElement.dataset.reduceMotion = 'true';
  document.documentElement.dataset.theme = 'light';
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }),
  });
  vi.mocked(getNodeDacl).mockResolvedValue({
    dacl: 'inherit off;\nallow [PRESET_READ] to any;\n',
    inherit: false,
    fingerprint: 'fp-1',
    annotated_dacl: 'inherit off;\nallow [PRESET_READ] to any;\n',
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.reduceMotion;
  if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

describe('BatchAccessRulesDialog', () => {
  it('loads the selected object DACL template via getNodeDacl before enabling submission', async () => {
    setup();
    await initialized('Documents');
    expect(getNodeDacl).toHaveBeenCalledWith('directory', 'folder', true);
    expect(controls.discover).not.toHaveBeenCalled();
  });

  it('keeps invalid CACL source in the editor and prevents submission', async () => {
    setup();
    await initialized('Documents');
    await source('not valid cacl!');
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply' }).disabled).toBe(true);
    });
    expect(controls.discover).not.toHaveBeenCalled();
  });

  it('confirms recursive scope and discovers with CACL policy string', async () => {
    const view = setup();
    await initialized('Documents');
    expect(screen.getByText(/Inheritance controls whether each target inherits/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('checkbox', { name: recursiveLabel }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByRole('dialog', { name: scopeTitle });
    expect(controls.apply).not.toHaveBeenCalled();
    await confirmScope();
    await waitFor(() => expect(view.onApplied).toHaveBeenCalledOnce());
    expect(controls.discover).toHaveBeenCalledWith(expect.stringContaining('allow [PRESET_READ] to any;'), false, true);
    expect(controls.apply).toHaveBeenCalledOnce();
  });

  it('presents self-lockout decision choices when a batch item returns 409 self_lockout', async () => {
    const chooseSpy = vi.spyOn(dialogStore, 'choose').mockResolvedValue({ value: 'allow_lockout_all', applyToAll: false });
    const answered = vi.fn();
    controls.failOnce = {
      target: targets[0],
      problem: {
        kind: 'self_lockout',
        error: 'Would lock out caller',
        diagnostics: [{ code: 'SELF_LOCKOUT', severity: 'warning', message: 'Caller loses WRITE_DACL' }],
      },
      onAnswer: answered,
    };

    setup({ targets: [targets[0]] });
    await initialized();
    await fireEvent.click(screen.getByRole('switch', { name: 'Inherit rules from parent object' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(chooseSpy).toHaveBeenCalledOnce());
    const call = chooseSpy.mock.calls[0][0];
    expect(call.title).toBe('Permission lockout warning');
    expect(call.message).toContain('Applying this access control policy (DACL)');
    expect(call.message).toContain('Caller loses WRITE_DACL');
    expect(call.cancelLabel).toBe('Stop processing');
    expect(call.cancelIcon).toBe('stop');
    expect(call.choices.map((c) => c.value)).toEqual(['allow_lockout', 'allow_lockout_all', 'skip', 'skip_all']);
    expect(call.choices.every((c) => typeof c.description === 'string' && c.description.length > 0)).toBe(true);
    await waitFor(() => expect(answered).toHaveBeenCalledWith('allow_lockout_all'));
  });

  it('keeps single-target failures inline in the editor without showing the batch results screen', async () => {
    controls.applySnapshot = (roots) => ({
      phase: 'stopped',
      started: true,
      stopReason: { kind: 'stopped' },
      results: [{
        target: roots[0],
        status: 'failed',
        problem: {
          kind: 'self_lockout',
          diagnostics: [{ code: 'SELF_LOCKOUT', severity: 'warning', message: 'Caller loses WRITE_DACL' }],
        },
      }],
      runCompleted: 1,
      runTotal: 1,
    });

    setup({ targets: [targets[0]] });
    await initialized();
    await fireEvent.click(screen.getByRole('switch', { name: 'Inherit rules from parent object' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Caller loses WRITE_DACL'));
    expect(screen.queryByRole('button', { name: 'Back to editing' })).toBeNull();
    expect(screen.queryByRole('button', { name: /All results/ })).toBeNull();
    expect(floatingProgressStore.entries).toHaveLength(0);
  });

  it('renders interactive filter pills, status badges, and unified footer recovery for multi-target runs', async () => {
    controls.applySnapshot = (roots) => ({
      phase: 'paused',
      started: true,
      results: [
        { target: roots[0], status: 'success' },
        { target: roots[1], status: 'failed', problem: { kind: 'denied' } },
      ],
      runCompleted: 2,
      runTotal: 2,
    });

    const view = setup();
    await initialized('Documents');
    await fireEvent.click(screen.getByRole('switch', { name: 'Inherit rules from parent object' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const allPill = await screen.findByRole('button', { name: /All results/ });
    const failedPill = screen.getByRole('button', { name: /Failed/ });
    const succeededPill = screen.getByRole('button', { name: /Succeeded/ });
    expect(allPill.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Documents')).toBeTruthy();
    expect(screen.getByText('Report.txt')).toBeTruthy();
    expect(floatingProgressStore.entries).toHaveLength(0);

    await fireEvent.click(failedPill);
    expect(failedPill.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Documents')).toBeNull();
    expect(screen.getByText('Report.txt')).toBeTruthy();

    await fireEvent.click(succeededPill);
    expect(screen.getByText('Documents')).toBeTruthy();
    expect(screen.queryByText('Report.txt')).toBeNull();

    const unconfirmedPill = screen.getByRole('button', { name: /Unconfirmed/ });
    await fireEvent.click(unconfirmedPill);
    expect(unconfirmedPill.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.batch-rules-results')).toBeNull();
    const emptyState = document.querySelector('.batch-rules-empty');
    expect(emptyState).not.toBeNull();
    expect(within(emptyState as HTMLElement).getByText('No results match this filter.')).toBeTruthy();
    await fireEvent.click(within(emptyState as HTMLElement).getByRole('button', { name: 'All results' }));
    expect(allPill.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.batch-rules-results')).not.toBeNull();
    expect(document.querySelector('.batch-rules-empty')).toBeNull();

    const retryBtn = screen.getByRole('button', { name: 'Retry failed objects' });
    await fireEvent.click(retryBtn);
    await waitFor(() => expect(controls.retryFailed).toHaveBeenCalledOnce());
    await waitFor(() => expect(view.onApplied).toHaveBeenCalledTimes(2));
  });

  it('disposes native execution when the dialog is unmounted', async () => {
    const view = setup();
    await initialized('Documents');
    view.unmount();
    expect(controls.dispose).toHaveBeenCalled();
  });
});
