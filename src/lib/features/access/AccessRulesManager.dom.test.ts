// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import AccessRulesManager from '$lib/features/access/AccessRulesManager.svelte';
import { DACL_SOURCE_MAX_LENGTH, DACL_SOURCE_WARN_REMAINING } from '$lib/features/access/cacl-model';
import { stubInstantAnimations } from '../../../test/dom-fixtures';

const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');

beforeEach(() => {
  stubInstantAnimations();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }),
  });
});

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

afterEach(() => {
  cleanup();
  document.documentElement.dataset.theme = 'light';
  if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

describe('AccessRulesManager', () => {
  it('toggles inheritance in visual mode and saves serialized CACL source', async () => {
    const onSave = vi.fn();
    render(AccessRulesManager, {
      dacl: 'inherit off;\nallow [PRESET_READ] to any;\n',
      targetObjectType: 'directory',
      onSave,
      onCancel: vi.fn(),
    });

    await fireEvent.click(screen.getByRole('switch', { name: 'files.inheritParentRules' }));
    await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as string;
    expect(saved).toContain('inherit on;');
    expect(saved).toContain('allow [PRESET_READ] to any;');
  });

  it('adds rules in visual mode and reports draft changes via onDraftChange', async () => {
    const onDraftChange = vi.fn();
    render(AccessRulesManager, {
      dacl: 'inherit on;\n',
      targetObjectType: 'document',
      onDraftChange,
      onSave: vi.fn(),
      onCancel: vi.fn(),
    });

    await waitFor(() => expect(onDraftChange).toHaveBeenCalled());
    onDraftChange.mockClear();

    await fireEvent.click(screen.getByRole('button', { name: 'files.cacl.addRule' }));

    await waitFor(() => {
      const latest = onDraftChange.mock.calls.at(-1)?.[0];
      expect(latest).not.toBeNull();
      expect(latest.hasErrors).toBe(false);
      expect(latest.ruleCount).toBe(1);
    });
  });

  it('switches to source CodeMirror editor and preserves valid changes back to visual mode', async () => {
    const onSave = vi.fn();
    render(AccessRulesManager, {
      dacl: 'inherit on;\n',
      targetObjectType: 'directory',
      onSave,
      onCancel: vi.fn(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'files.sourceCode' }));
    const editorDom = await screen.findByLabelText('files.accessRules');
    expect(editorDom.closest('.cm-editor')).not.toBeNull();
    expect(editorDom.getAttribute('data-focus-ring')).toBe('delegated');

    const cmView = EditorView.findFromDOM(editorDom)!;
    const edited = 'inherit off;\nallow [PRESET_RW] to group("editors");\n';
    cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: edited } });
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'files.accessRulesVisualization' }));
    const inheritSwitch = screen.getByRole('switch', { name: 'files.inheritParentRules' });
    expect(inheritSwitch.getAttribute('aria-checked')).toBe('false');

    await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onSave).toHaveBeenCalledWith(expect.stringContaining('group("editors")'));
  });

  it('blocks switching from invalid CACL source to visual mode and disables Save', async () => {
    render(AccessRulesManager, {
      dacl: 'inherit on;\n',
      targetObjectType: 'directory',
      onSave: vi.fn(),
      onCancel: vi.fn(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'files.sourceCode' }));
    const editorDom = await screen.findByLabelText('files.accessRules');
    const cmView = EditorView.findFromDOM(editorDom)!;
    cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: 'not valid cacl syntax' } });
    await tick();

    await waitFor(() => {
      const saveBtn = screen.getByRole<HTMLButtonElement>('button', { name: 'common.save' });
      expect(saveBtn.disabled).toBe(true);
    });

    await fireEvent.click(screen.getByRole('button', { name: 'files.accessRulesVisualization' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /files\.sourceCode/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('resets edits on resetRevision increment and shows server diagnostics', async () => {
    const props = {
      dacl: 'inherit on;\n',
      serverDiagnostics: [
        {
          code: 'SERVER_LOCKOUT',
          severity: 'warning' as const,
          message: 'Server diagnostic message',
        },
      ],
      resetRevision: 0,
      onSave: vi.fn(),
      onCancel: vi.fn(),
    };
    const view = render(AccessRulesManager, props);

    await fireEvent.click(screen.getByRole('button', { name: /files\.cacl\.diagnosticsWarnings/ }));
    expect(screen.getByText('Server diagnostic message')).toBeTruthy();

    await fireEvent.click(screen.getByRole('switch', { name: 'files.inheritParentRules' }));
    expect(screen.getByRole('switch', { name: 'files.inheritParentRules' }).getAttribute('aria-checked')).toBe('false');

    await view.rerender({ ...props, dacl: 'inherit on;\nallow [PRESET_READ] to any;\n', resetRevision: 1 });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'files.inheritParentRules' }).getAttribute('aria-checked')).toBe('true');
    });
  });

  it('removes the standalone format button from the toolbar and formats via context menu and Shift+Alt+F', async () => {
    render(AccessRulesManager, {
      dacl: 'inherit on;\n',
      targetObjectType: 'directory',
      onSave: vi.fn(),
      onCancel: vi.fn(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'files.sourceCode' }));
    const editorDom = await screen.findByLabelText('files.accessRules');
    expect(screen.queryByRole('button', { name: 'files.cacl.formatPolicy' })).toBeNull();

    const cmView = EditorView.findFromDOM(editorDom)!;
    const raw = [
      'inherit off;',
      '',
      '# keep comment',
      'allow [TRAVERSE, CREATE_DOCUMENT] on self to group("all_employees") remark "Blind dropbox submission entry point";',
    ].join('\n');
    cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: raw } });
    await tick();

    await fireEvent.contextMenu(editorDom, { clientX: 20, clientY: 20 });
    const formatMenuItem = await screen.findByRole('menuitem', { name: /codeEditor\.format/ });
    await fireEvent.click(formatMenuItem);

    await waitFor(() => {
      expect(cmView.state.doc.toString()).toBe([
        'inherit off;',
        '',
        '# keep comment',
        'allow [TRAVERSE, CREATE_DOCUMENT] on self',
        '  to group("all_employees")',
        '  remark "Blind dropbox submission entry point";',
        '',
      ].join('\n'));
    });

    // Shift+Alt+F formats valid source and shows alert banner on syntax errors
    cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: 'inherit on;\n  allow [PRESET_READ] to any;\n' } });
    await tick();
    await fireEvent.keyDown(editorDom, { key: 'F', shiftKey: true, altKey: true });
    await waitFor(() => {
      expect(cmView.state.doc.toString()).toBe('inherit on;\nallow [PRESET_READ] to any;\n');
    });

    cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: 'not valid cacl' } });
    await tick();
    await fireEvent.keyDown(editorDom, { key: 'F', shiftKey: true, altKey: true });
    await screen.findByRole('alert');
  });

  it('hides the diagnostics bar and size counter when valid and within safe length, and shows approaching/exceeded warnings only near limit', async () => {
    const base = 'inherit on;\n# ';
    const makeSourceOfLength = (len: number) => `${base}${'a'.repeat(len - base.length)}`;

    const { container } = render(AccessRulesManager, {
      dacl: 'inherit on;\nallow [PRESET_READ] to any;\n',
      targetObjectType: 'directory',
      onSave: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(container.querySelector('.diagnostics-bar')).toBeNull();
    expect(screen.queryByText(/policyValid/)).toBeNull();
    expect(screen.queryByText(/\/ 65536/)).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'files.sourceCode' }));
    const editorDom = await screen.findByLabelText('files.accessRules');
    const cmView = EditorView.findFromDOM(editorDom)!;

    // 1025 chars remaining (64511 / 65536) -> still hidden
    const safeBoundary = DACL_SOURCE_MAX_LENGTH - DACL_SOURCE_WARN_REMAINING - 1;
    cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: makeSourceOfLength(safeBoundary) } });
    await tick();
    expect(container.querySelector('.diagnostics-bar')).toBeNull();
    expect(screen.queryByText(/\/ 65536/)).toBeNull();

    // 1024 chars remaining (64512 / 65536) -> approaching warning + counter appear
    const warnBoundary = DACL_SOURCE_MAX_LENGTH - DACL_SOURCE_WARN_REMAINING;
    cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: makeSourceOfLength(warnBoundary) } });
    await tick();
    await waitFor(() => {
      expect(container.querySelector('.diagnostics-bar')).not.toBeNull();
      expect(screen.getByText('files.cacl.lengthApproaching')).toBeTruthy();
      expect(screen.getByText(`${warnBoundary} / ${DACL_SOURCE_MAX_LENGTH}`)).toBeTruthy();
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'common.save' }).disabled).toBe(false);
    });

    // Exceeded (65537 / 65536) -> exceeded error + counter + disabled Save
    const exceededLength = DACL_SOURCE_MAX_LENGTH + 1;
    cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: makeSourceOfLength(exceededLength) } });
    await tick();
    await waitFor(() => {
      expect(screen.getByText('files.cacl.lengthExceeded')).toBeTruthy();
      expect(screen.getByText(`${exceededLength} / ${DACL_SOURCE_MAX_LENGTH}`)).toBeTruthy();
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'common.save' }).disabled).toBe(true);
    });
  });

  it('shows diagnostics without the size counter when a short policy has diagnostics', async () => {
    const { container } = render(AccessRulesManager, {
      dacl: 'inherit on;\n',
      serverDiagnostics: [
        {
          code: 'SERVER_LOCKOUT',
          severity: 'warning' as const,
          message: 'Server warning message',
        },
      ],
      onSave: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(container.querySelector('.diagnostics-bar')).not.toBeNull();
    expect(screen.getByText('files.cacl.diagnosticsWarnings')).toBeTruthy();
    expect(screen.queryByText(/\/ 65536/)).toBeNull();
  });
});
