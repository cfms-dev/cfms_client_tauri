// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccessRulesManager from '$lib/features/access/AccessRulesManager.svelte';

const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');

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
  it('keeps the default single-object save action and passes the edited rules and inheritance choice', async () => {
    const onSave = vi.fn();
    render(AccessRulesManager, {
      rules: { manage: [{ match: 'all', match_groups: [] }] },
      inheritParent: false,
      onSave,
      onCancel: vi.fn(),
    });
    await fireEvent.click(screen.getByRole('switch', { name: 'files.inheritParentRules' }));
    await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onSave).toHaveBeenCalledWith({ read: [], write: [], move: [], manage: [{ match: 'all', match_groups: [] }] }, true);
  });

  it('uses the shared CodeMirror JSON editor for source rules', async () => {
    const { container } = render(AccessRulesManager, {
      props: {
        rules: {
          read: [{ match: 'any', match_groups: [] }],
        },
        inheritParent: false,
        onSave: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'files.sourceCode' }));

    const editor = await screen.findByLabelText('files.accessRules');
    expect(editor.closest('.cm-editor')).not.toBeNull();
    expect(editor.getAttribute('data-focus-ring')).toBe('delegated');
    expect(editor.textContent).toContain('read');
    expect(container.querySelector('.access-rules-source-editor > textarea')).toBeNull();
  });

  it.each(['ok', 'apply'] as const)('passes custom footer intent %s while preserving the current draft across footer updates', async (intent) => {
    const onSave = vi.fn();
    const footer = createRawSnippet<[submit: (intent?: 'ok' | 'apply') => Promise<void>]>((submit) => ({
      render: () => '<button type="button">Submit draft</button>',
      setup: (element) => {
        const click = () => { void submit()(intent); };
        element.addEventListener('click', click);
        return () => element.removeEventListener('click', click);
      },
    }));
    const props = {
      rules: {},
      inheritParent: false,
      onSave,
      onCancel: vi.fn(),
    };
    const view = render(AccessRulesManager, props);
    await fireEvent.click(screen.getByRole('button', { name: 'files.addRuleGroup' }));
    await view.rerender({ ...props, footer, submitDisabled: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Submit draft' }));
    expect(onSave).not.toHaveBeenCalled();
    await view.rerender({ ...props, footer, submitDisabled: false });
    await fireEvent.click(screen.getByRole('button', { name: 'Submit draft' }));
    expect(onSave).toHaveBeenCalledWith({
      read: [{ match: 'any', match_groups: [] }], write: [], move: [], manage: [],
    }, false, intent);
    expect(screen.queryByRole('button', { name: 'common.save' })).toBeNull();
  });

  it('notifies cloned valid drafts for visual rules and inheritance without exposing internal state', async () => {
    const onDraftChange = vi.fn();
    const onSave = vi.fn();
    render(AccessRulesManager, {
      rules: {}, inheritParent: false, onSave, onCancel: vi.fn(), onDraftChange,
    });
    await waitFor(() => expect(onDraftChange).toHaveBeenCalledWith({
      rules: { read: [], write: [], move: [], manage: [] }, inheritParent: false,
    }));
    const reportedDraft = onDraftChange.mock.lastCall?.[0];
    reportedDraft.rules.read.push({ match: 'all', match_groups: [] });
    await fireEvent.click(screen.getByRole('button', { name: 'files.addRuleGroup' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'files.inheritParentRules' }));
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith({
      rules: { read: [{ match: 'any', match_groups: [] }], write: [], move: [], manage: [] },
      inheritParent: true,
    }));
    await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onSave).toHaveBeenCalledWith({
      read: [{ match: 'any', match_groups: [] }], write: [], move: [], manage: [],
    }, true);
  });

  it('reloads unchanged incoming rules when the reset revision advances while preserving unrelated rerenders', async () => {
    const onDraftChange = vi.fn();
    const onSave = vi.fn();
    const props = {
      rules: {}, inheritParent: false, onSave, onCancel: vi.fn(), onDraftChange, resetRevision: 0,
    };
    const view = render(AccessRulesManager, props);
    await fireEvent.click(screen.getByRole('button', { name: 'files.addRuleGroup' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'files.inheritParentRules' }));
    const editedDraft = {
      rules: { read: [{ match: 'any', match_groups: [] }], write: [], move: [], manage: [] },
      inheritParent: true,
    };
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith(editedDraft));

    await view.rerender({ ...props, rules: {}, submitDisabled: true });
    expect(onDraftChange.mock.lastCall?.[0]).toEqual(editedDraft);
    await view.rerender({ ...props, rules: {}, resetRevision: 1, submitDisabled: false });
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith({
      rules: { read: [], write: [], move: [], manage: [] }, inheritParent: false,
    }));
    await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onSave).toHaveBeenCalledWith({ read: [], write: [], move: [], manage: [] }, false);
  });

  it.each(['{', '{"read": "invalid"}'])('reports null and preserves invalid source %s until valid source is entered', async (invalidSource) => {
    const emptyRect = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) };
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => emptyRect });
    const onDraftChange = vi.fn();
    const onSave = vi.fn();
    const props = { rules: {}, inheritParent: false, onSave, onCancel: vi.fn(), onDraftChange };
    const view = render(AccessRulesManager, props);
    await fireEvent.click(screen.getByRole('button', { name: 'files.sourceCode' }));
    const content = await screen.findByLabelText('files.accessRules');
    const editor = EditorView.findFromDOM(content as HTMLElement)!;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: invalidSource } });
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith(null));
    await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
    await view.rerender({ ...props, submitDisabled: true });
    expect(editor.state.doc.toString()).toBe(invalidSource);
    await fireEvent.click(screen.getByRole('button', { name: 'files.accessRulesVisualization' }));
    expect(screen.getByLabelText('files.accessRules')).toBeTruthy();
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: '{"read": []}' } });
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith({
      rules: { read: [], write: [], move: [], manage: [] }, inheritParent: false,
    }));
    await view.rerender({ ...props, submitDisabled: false });
    await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('disables every editor control and leaves custom actions outside the inert body while saving', async () => {
    const onDraftChange = vi.fn();
    const footer = createRawSnippet(() => ({ render: () => '<button type="button">Stop execution</button>' }));
    const props = {
      rules: {}, inheritParent: false, onSave: vi.fn(), onCancel: vi.fn(), onDraftChange, footer,
    };
    const view = render(AccessRulesManager, props);
    await fireEvent.click(screen.getByRole('button', { name: 'files.addRuleGroup' }));
    const previousDraft = onDraftChange.mock.lastCall?.[0];
    await view.rerender({ ...props, saving: true });
    const inertBody = view.container.querySelector<HTMLElement>('[aria-busy="true"]');
    expect(inertBody).not.toBeNull();
    expect(inertBody!.inert).toBe(true);
    for (const control of inertBody!.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')) {
      expect(control.disabled).toBe(true);
    }
    expect(screen.getByRole('button', { name: 'Stop execution' }).closest('[inert]')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'files.sourceCode' }));
    await fireEvent.click(screen.getByRole('button', { name: 'files.addRuleGroup' }));
    expect(view.container.querySelector('.access-rules-source-editor')).toBeNull();
    expect(onDraftChange.mock.lastCall?.[0]).toEqual(previousDraft);
    await view.rerender({ ...props, saving: false });
    expect(onDraftChange.mock.lastCall?.[0]).toEqual(previousDraft);
  });

  it('explains invalid source schema with custom actions before submission and clears the error after repair', async () => {
    const emptyRect = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) };
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => emptyRect });
    const onDraftChange = vi.fn();
    const onSave = vi.fn();
    render(AccessRulesManager, {
      rules: {}, inheritParent: false, onSave, onCancel: vi.fn(), onDraftChange,
      footer: createRawSnippet(() => ({ render: () => '<span>Custom actions</span>' })),
    });
    await fireEvent.click(screen.getByRole('button', { name: 'files.sourceCode' }));
    const content = await screen.findByLabelText('files.accessRules');
    const editor = EditorView.findFromDOM(content as HTMLElement)!;

    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: '[]' } });
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith(null));
    expect(screen.getByRole('alert').textContent).toBe('files.invalidAccessRulesJson');
    expect(onSave).not.toHaveBeenCalled();
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: '{}' } });
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith({
      rules: { read: [], write: [], move: [], manage: [] }, inheritParent: false,
    }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
