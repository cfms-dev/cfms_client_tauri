// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CaclCodeEditor from '$lib/features/access/CaclCodeEditor.svelte';

const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');

afterEach(() => {
  cleanup();
  document.documentElement.dataset.theme = 'light';
  if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

describe('CaclCodeEditor', () => {
  it('mounts CodeMirror with CACL policy text and a delegated focus ring', async () => {
    const onChange = vi.fn();
    const props = {
      value: 'inherit on;\nallow [READ_CONTENT] to any;\n',
      targetObjectType: 'document' as const,
      serverDiagnostics: [],
      disabled: false,
      ariaLabel: 'CACL Policy',
      loadingLabel: 'Loading CACL editor…',
      onChange,
    };
    const view = render(CaclCodeEditor, { props });

    const editor = await screen.findByLabelText('CACL Policy', {}, { timeout: 4000 });
    expect(editor.getAttribute('data-focus-ring')).toBe('delegated');
    expect(editor.textContent).toContain('READ_CONTENT');

    await view.rerender({ ...props, value: 'inherit off;\ndeny [DELETE] to any;\n' });
    await waitFor(() => expect(editor.textContent).toContain('DELETE'));
  });

  it('emits onChange when CodeMirror document changes', async () => {
    const onChange = vi.fn();
    render(CaclCodeEditor, {
      props: {
        value: 'inherit on;\n',
        ariaLabel: 'Editable CACL Policy',
        loadingLabel: 'Loading CACL editor…',
        onChange,
      },
    });

    const content = await screen.findByLabelText('Editable CACL Policy', {}, { timeout: 4000 });
    const cmView = EditorView.findFromDOM(content)!;
    expect(cmView).not.toBeNull();

    const updated = 'inherit off;\nallow [PRESET_READ] to any;\n';
    cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: updated } });
    expect(onChange).toHaveBeenCalledWith(updated);
  });

  it('renders server diagnostics as CodeMirror lint markers', async () => {
    const { container } = render(CaclCodeEditor, {
      props: {
        value: 'inherit on;\nallow [BOGUS] to any;\n',
        targetObjectType: 'directory',
        serverDiagnostics: [
          {
            code: 'CACL_UNKNOWN_OP',
            severity: 'error',
            message: 'Unknown operation BOGUS',
            span: { line: 2, column: 8, end_line: 2, end_column: 13 },
          },
        ],
        ariaLabel: 'Diagnostic CACL Policy',
        loadingLabel: 'Loading CACL editor…',
        onChange: vi.fn(),
      },
    });

    await screen.findByLabelText('Diagnostic CACL Policy', {}, { timeout: 4000 });
    await waitFor(() => {
      const lint = container.querySelector('.cm-lintRange-error');
      expect(lint).not.toBeNull();
    });
  });

  it('reconfigures CodeMirror when the application color scheme changes', async () => {
    document.documentElement.dataset.theme = 'dark';
    render(CaclCodeEditor, {
      props: {
        value: 'inherit on;\n',
        ariaLabel: 'Themed CACL Policy',
        loadingLabel: 'Loading CACL editor…',
        onChange: vi.fn(),
      },
    });

    const content = await screen.findByLabelText('Themed CACL Policy', {}, { timeout: 4000 });
    const editor = content.closest('.cm-editor');
    expect(editor).not.toBeNull();
    const darkThemeClasses = editor?.className;

    document.documentElement.dataset.theme = 'light';
    await waitFor(() => expect(editor?.className).not.toBe(darkThemeClasses));
  });
});
