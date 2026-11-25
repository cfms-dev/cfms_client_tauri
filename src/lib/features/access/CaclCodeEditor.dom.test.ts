// @vitest-environment jsdom

import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { EditorView } from '@codemirror/view';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CaclCodeEditor from '$lib/features/access/CaclCodeEditor.svelte';
import { stubInstantAnimations } from '../../../test/dom-fixtures';

const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
const rangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect');
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

beforeEach(() => {
  stubInstantAnimations();
  locale.set('en');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  document.documentElement.dataset.theme = 'light';
  if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
  if (rangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeRect);
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
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

  it('applies distinct syntax highlight classes to CACL tokens', async () => {
    const { container } = render(CaclCodeEditor, {
      props: {
        value: 'inherit off;\nallow [TRAVERSE, READ_CONTENT] to any remark "test";\n',
        ariaLabel: 'Highlighted CACL Policy',
        loadingLabel: 'Loading CACL editor…',
        onChange: vi.fn(),
      },
    });

    await screen.findByLabelText('Highlighted CACL Policy', {}, { timeout: 4000 });
    await waitFor(() => {
      const spans = Array.from(container.querySelectorAll('.cm-line span[class]'));
      const classByToken = new Map<string, string>();
      for (const span of spans) {
        const text = span.textContent ?? '';
        if (text && span.className) {
          classByToken.set(text, span.className);
        }
      }

      const inheritClass = classByToken.get('inherit');
      const allowClass = classByToken.get('allow');
      const traverseClass = classByToken.get('TRAVERSE');
      const remarkStrClass = classByToken.get('"test"');

      expect(inheritClass).toBeTruthy();
      expect(allowClass).toBeTruthy();
      expect(traverseClass).toBeTruthy();
      expect(remarkStrClass).toBeTruthy();

      expect(inheritClass).not.toBe(allowClass);
      expect(allowClass).not.toBe(traverseClass);
      expect(allowClass).not.toBe(remarkStrClass);
    });
  });

  it('opens a context menu with editing actions and Format (Shift+Alt+F) when onFormat is provided', async () => {
    const onFormat = vi.fn();
    const onChange = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readText = vi.fn().mockResolvedValue('inherit off;\n');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText },
    });

    render(CaclCodeEditor, {
      props: {
        value: 'inherit on;\nallow [READ_CONTENT] to any;\n',
        ariaLabel: 'Menu CACL Policy',
        loadingLabel: 'Loading CACL editor…',
        onChange,
        onFormat,
      },
    });

    const content = await screen.findByLabelText('Menu CACL Policy', {}, { timeout: 4000 });
    const cmView = EditorView.findFromDOM(content)!;

    await fireEvent.contextMenu(content, { clientX: 40, clientY: 60 });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Undo/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Redo/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Cut/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Copy/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Paste/ })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: /Select all/ })).toBeTruthy();

    const formatItem = within(menu).getByRole('menuitem', { name: /Format/ });
    expect(within(formatItem).getByText('Alt+Shift+F')).toBeTruthy();

    await fireEvent.click(formatItem);
    expect(onFormat).toHaveBeenCalledTimes(1);

    // Select All + Copy through the context menu
    await fireEvent.contextMenu(content, { clientX: 40, clientY: 60 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Select all/ }));
    expect(cmView.state.selection.main.from).toBe(0);
    expect(cmView.state.selection.main.to).toBe(cmView.state.doc.length);

    await fireEvent.contextMenu(content, { clientX: 40, clientY: 60 });
    await fireEvent.click(await screen.findByRole('menuitem', { name: /Copy/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('inherit on;\nallow [READ_CONTENT] to any;\n'));

    // Shift+Alt+F triggers onFormat directly
    await fireEvent.keyDown(content, { key: 'F', shiftKey: true, altKey: true });
    expect(onFormat).toHaveBeenCalledTimes(2);
  });

  it('omits Format from the context menu when onFormat is not provided', async () => {
    render(CaclCodeEditor, {
      props: {
        value: 'inherit on;\n',
        ariaLabel: 'No Format CACL Policy',
        loadingLabel: 'Loading CACL editor…',
        onChange: vi.fn(),
      },
    });

    const content = await screen.findByLabelText('No Format CACL Policy', {}, { timeout: 4000 });
    await fireEvent.contextMenu(content, { clientX: 24, clientY: 24 });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Copy/ })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: /Format/ })).toBeNull();
  });
});
