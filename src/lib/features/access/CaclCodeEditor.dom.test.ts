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

  it('keeps the active line translucent and applies high-specificity selection styling in both dark and light themes', async () => {
    document.documentElement.dataset.theme = 'dark';
    render(CaclCodeEditor, {
      props: {
        value: 'inherit on;\nallow [READ_CONTENT] to any;\n',
        ariaLabel: 'Selection Contrast CACL Policy',
        loadingLabel: 'Loading CACL editor…',
        onChange: vi.fn(),
      },
    });

    await screen.findByLabelText('Selection Contrast CACL Policy', {}, { timeout: 4000 });

    const collectThemeCss = () => Array.from(document.head.querySelectorAll('style'))
      .map((styleEl) => styleEl.textContent ?? '')
      .join('\n');

    await waitFor(() => {
      const css = collectThemeCss();
      expect(css).toMatch(/\.cm-activeLine\s*\{[^}]*transparent/);
      expect(css).toContain('.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground');
      expect(css).toContain('.cm-selectionMatch-main');
    });

    document.documentElement.dataset.theme = 'light';
    await waitFor(() => {
      const css = collectThemeCss();
      expect(css).toMatch(/\.cm-activeLine\s*\{[^}]*#242424\)\s*5%/);
    });
  });

  it('portals tooltips to document.body and styles lint markers and diagnostics without left border bars', async () => {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [{ bottom: 20, height: 16, left: 10, right: 40, top: 4, width: 30, x: 10, y: 4, toJSON: () => ({}) }],
    });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 20, height: 16, left: 10, right: 40, top: 4, width: 30, x: 10, y: 4, toJSON: () => ({}) }),
    });

    document.documentElement.dataset.theme = 'dark';
    const { container, unmount } = render(CaclCodeEditor, {
      props: {
        value: 'inherit on;\ndeny [PRESET_RW] on self to any;\n',
        targetObjectType: 'directory',
        ariaLabel: 'Tooltip Style CACL Policy',
        loadingLabel: 'Loading CACL editor…',
        onChange: vi.fn(),
      },
    });

    const content = await screen.findByLabelText('Tooltip Style CACL Policy', {}, { timeout: 4000 });
    const editor = content.closest('.cm-editor')!;
    const editorHost = container.querySelector('.cacl-code-editor')!;
    const themeClasses = editor.className.split(/\s+/).filter((cls) => cls && cls !== 'cm-editor');

    const marker = await waitFor(() => {
      const found = container.querySelector('.cm-lint-marker-warning');
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });

    await fireEvent.mouseOver(marker);

    const tooltipLint = await waitFor(() => {
      const found = document.body.querySelector('.cm-tooltip-lint');
      expect(found).toBeTruthy();
      return found as HTMLElement;
    }, { timeout: 2000 });

    expect(editorHost.contains(tooltipLint)).toBe(false);
    const tooltipContainer = tooltipLint.closest('.cm-tooltip')?.parentElement;
    expect(tooltipContainer).toBeTruthy();
    expect(tooltipContainer?.parentElement).toBe(document.body);
    for (const cls of themeClasses) {
      expect(tooltipContainer?.classList.contains(cls)).toBe(true);
    }

    const css = Array.from(document.head.querySelectorAll('style'))
      .map((styleEl) => styleEl.textContent ?? '')
      .join('\n');

    expect(css).toMatch(/\.cm-lint-marker\s*\{[^}]*content:\s*normal/);
    expect(css).toMatch(/\.cm-lint-marker-warning\s*\{[^}]*--colorStatusWarningForeground1/);
    expect(css).toMatch(/\.cm-lint-marker-warning\s*\{[^}]*mask-image:\s*url\("data:image\/svg\+xml,/);
    expect(css).toMatch(/\.cm-diagnostic\s*\{[^}]*border-left:\s*none/);
    expect(css).toMatch(/\.cm-diagnostic\s*\{[^}]*margin-left:\s*0/);
    expect(css).toMatch(/\.cm-diagnostic-warning::before\s*\{[^}]*--colorStatusWarningForeground1/);
    expect(css).toMatch(/\.cm-tooltip,\s*[^}]*\.cm-panels\s*\{[^}]*border-radius:\s*8px/);
    expect(css).toMatch(/\.cm-tooltip-lint\s*\{[^}]*border-radius:\s*8px/);
    expect(css).toMatch(/\.cm-tooltip-lint\s*\{[^}]*overflow:\s*hidden/);

    unmount();
    await waitFor(() => {
      expect(document.body.contains(tooltipContainer!)).toBe(false);
    });
  });
});
