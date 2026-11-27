<script lang="ts">
  import type { EditorView } from '@codemirror/view';
  import { _ as t } from 'svelte-i18n';
  import ContextMenu from '#lib/shared/ui/ContextMenu.svelte';
  import type { ContextMenuItem } from '#lib/shared/ui/context-menu.ts';
  import {
    getCodeEditorCommandState,
    getCodeEditorShortcuts,
    runCodeEditorCopy,
    runCodeEditorCut,
    runCodeEditorPaste,
    runCodeEditorRedo,
    runCodeEditorSelectAll,
    runCodeEditorUndo,
  } from '#lib/shared/ui/code-editor-commands.ts';

  interface Props {
    open: boolean;
    x: number;
    y: number;
    editorView: EditorView | null;
    disabled?: boolean;
    sourceElement?: HTMLElement | null;
    onFormat?: (() => void) | null;
    formatDisabled?: boolean;
    formatLabel?: string;
    onClose: () => void;
  }

  let {
    open,
    x,
    y,
    editorView,
    disabled = false,
    sourceElement = null,
    onFormat = null,
    formatDisabled = false,
    formatLabel,
    onClose,
  }: Props = $props();

  const items = $derived.by<ContextMenuItem[]>(() => {
    if (!open) return [];
    const state = getCodeEditorCommandState(editorView);
    const shortcuts = getCodeEditorShortcuts();
    const canEdit = !disabled && state.canEdit;
    const hasFormat = Boolean(onFormat);

    return [
      {
        id: 'editor-undo',
        label: $t('codeEditor.undo'),
        icon: 'undo',
        shortcuts: shortcuts.undo,
        disabled: !canEdit || !state.canUndo,
        onSelect: () => runCodeEditorUndo(editorView),
      },
      {
        id: 'editor-redo',
        label: $t('codeEditor.redo'),
        icon: 'redo',
        shortcuts: shortcuts.redo,
        disabled: !canEdit || !state.canRedo,
        onSelect: () => runCodeEditorRedo(editorView),
      },
      { type: 'divider' },
      {
        id: 'editor-cut',
        label: $t('codeEditor.cut'),
        icon: 'cut',
        shortcuts: shortcuts.cut,
        disabled: !canEdit || !state.hasSelection,
        onSelect: () => runCodeEditorCut(editorView),
      },
      {
        id: 'editor-copy',
        label: $t('codeEditor.copy'),
        icon: 'contentCopy',
        shortcuts: shortcuts.copy,
        disabled: !state.hasSelection,
        onSelect: () => runCodeEditorCopy(editorView),
      },
      {
        id: 'editor-paste',
        label: $t('codeEditor.paste'),
        icon: 'paste',
        shortcuts: shortcuts.paste,
        disabled: !canEdit,
        onSelect: () => runCodeEditorPaste(editorView),
      },
      {
        id: 'editor-select-all',
        label: $t('codeEditor.selectAll'),
        icon: 'selectAll',
        shortcuts: shortcuts.selectAll,
        disabled: state.isEmpty,
        onSelect: () => runCodeEditorSelectAll(editorView),
      },
      { type: 'divider', hidden: !hasFormat },
      {
        id: 'editor-format',
        label: formatLabel ?? $t('codeEditor.format'),
        icon: 'wandStars',
        shortcuts: shortcuts.format,
        hidden: !hasFormat,
        disabled: !canEdit || formatDisabled,
        onSelect: () => {
          onFormat?.();
          editorView?.focus();
        },
      },
    ];
  });
</script>

<ContextMenu {open} {x} {y} {items} {sourceElement} {onClose} />
