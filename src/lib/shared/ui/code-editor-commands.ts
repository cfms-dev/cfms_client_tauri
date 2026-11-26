import { redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands';
import { Prec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { copyText, readClipboardText } from '$lib/shared/platform/clipboard';
import { isMacLikePlatform, shortcutMatches, type ShortcutSpec } from '$lib/shared/ui/keyboard';

export function usesDarkColorScheme(): boolean {
  return document.documentElement.dataset.theme !== 'light';
}

export interface CodeEditorShortcuts {
  undo: readonly ShortcutSpec[];
  redo: readonly ShortcutSpec[];
  cut: readonly ShortcutSpec[];
  copy: readonly ShortcutSpec[];
  paste: readonly ShortcutSpec[];
  selectAll: readonly ShortcutSpec[];
  format: readonly ShortcutSpec[];
}

export function getCodeEditorShortcuts(macLike = isMacLikePlatform()): CodeEditorShortcuts {
  return {
    undo: [{ key: 'z', primary: true }],
    redo: macLike
      ? [{ key: 'z', primary: true, shift: true }]
      : [{ key: 'y', primary: true }],
    cut: [{ key: 'x', primary: true }],
    copy: [{ key: 'c', primary: true }],
    paste: [{ key: 'v', primary: true }],
    selectAll: [{ key: 'a', primary: true }],
    format: [{ key: 'f', shift: true, alt: true }],
  };
}

export interface CodeEditorCommandState {
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  isEmpty: boolean;
  canEdit: boolean;
}

export function getCodeEditorCommandState(view: EditorView | null): CodeEditorCommandState {
  if (!view) {
    return {
      canUndo: false,
      canRedo: false,
      hasSelection: false,
      isEmpty: true,
      canEdit: false,
    };
  }
  const { state } = view;
  return {
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
    hasSelection: state.selection.ranges.some((range) => !range.empty),
    isEmpty: state.doc.length === 0,
    canEdit: state.facet(EditorView.editable),
  };
}

/**
 * Bind `Shift+Alt+F` inside CodeMirror only while a formatter callback is active.
 * Returning `false` when no formatter is registered avoids swallowing the keystroke
 * for languages that do not support formatting.
 */
export function createFormatKeymapExtension(
  getHandler: () => (() => void) | null | undefined,
  isDisabled: () => boolean,
): Extension {
  return Prec.high(
    EditorView.domEventHandlers({
      keydown: (event, view) => {
        if (event.defaultPrevented || event.isComposing) return false;
        const matchesKeyF = shortcutMatches(event, { key: 'f', shift: true, alt: true })
          || (event.code === 'KeyF' && event.shiftKey && event.altKey && !event.ctrlKey && !event.metaKey);
        if (!matchesKeyF) return false;

        const handler = getHandler();
        if (!handler || isDisabled() || !view.state.facet(EditorView.editable)) {
          return false;
        }
        event.preventDefault();
        handler();
        return true;
      },
    }),
  );
}

function selectedText(view: EditorView): string {
  return view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => view.state.sliceDoc(range.from, range.to))
    .join('\n');
}

export function runCodeEditorUndo(view: EditorView | null): void {
  if (!view || !view.state.facet(EditorView.editable)) return;
  undo(view);
  view.focus();
}

export function runCodeEditorRedo(view: EditorView | null): void {
  if (!view || !view.state.facet(EditorView.editable)) return;
  redo(view);
  view.focus();
}

export async function runCodeEditorCopy(view: EditorView | null): Promise<void> {
  if (!view) return;
  const text = selectedText(view);
  if (!text) return;
  await copyText(text);
  view.focus();
}

export async function runCodeEditorCut(view: EditorView | null): Promise<void> {
  if (!view || !view.state.facet(EditorView.editable)) return;
  const text = selectedText(view);
  if (!text) return;
  try {
    await copyText(text);
  } catch {
    return;
  }
  const changes = view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => ({ from: range.from, to: range.to, insert: '' }));
  if (changes.length > 0) {
    view.dispatch({ changes });
  }
  view.focus();
}

export async function runCodeEditorPaste(view: EditorView | null): Promise<void> {
  if (!view || !view.state.facet(EditorView.editable)) return;
  const text = await readClipboardText();
  if (text !== null) {
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
    return;
  }
  view.focus();
  try {
    document.execCommand('paste');
  } catch {
    // WebView may deny programmatic paste without user-initiated clipboard shortcut.
  }
}

export function runCodeEditorSelectAll(view: EditorView | null): void {
  if (!view || view.state.doc.length === 0) return;
  selectAll(view);
  view.focus();
}

export function getEditorContextMenuAnchor(
  event: MouseEvent,
  view: EditorView | null,
): { x: number; y: number } {
  if (event.clientX !== 0 || event.clientY !== 0) {
    return { x: event.clientX, y: event.clientY };
  }
  const coords = view?.coordsAtPos(view.state.selection.main.head);
  if (coords) {
    return { x: coords.left, y: coords.bottom };
  }
  const rect = view?.dom.getBoundingClientRect()
    ?? (event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null);
  if (rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}
