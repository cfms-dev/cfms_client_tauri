<script lang="ts">
  import { onMount } from 'svelte';
  import type { EditorView as EditorViewType } from '@codemirror/view';
  import type { Compartment as CompartmentType, Extension } from '@codemirror/state';
  import CodeEditorContextMenu from '#lib/shared/ui/CodeEditorContextMenu.svelte';
  import {
    createFormatKeymapExtension,
    getEditorContextMenuAnchor,
    usesDarkColorScheme,
  } from '#lib/shared/ui/code-editor-commands.ts';
  import { shortcutMatches } from '#lib/shared/ui/keyboard.ts';

  export interface CodeEditorMountModules {
    EditorState: typeof import('@codemirror/state').EditorState;
    Compartment: typeof import('@codemirror/state').Compartment;
    EditorView: typeof import('@codemirror/view').EditorView;
    tooltips: typeof import('@codemirror/view').tooltips;
  }

  export interface LoadedCodeEditorConfig {
    extensions: Extension[];
    colorSchemeExtension: (dark: boolean) => Extension;
  }

  interface Props {
    value: string;
    disabled?: boolean;
    ariaLabel: string;
    loadingLabel: string;
    editorClass?: string;
    minHeight?: string;
    editorView?: EditorViewType | null;
    loadExtensions: (modules: CodeEditorMountModules) => Promise<LoadedCodeEditorConfig>;
    onChange: (value: string) => void;
    onFormat?: () => void;
  }

  let {
    value,
    disabled = false,
    ariaLabel,
    loadingLabel,
    editorClass = '',
    minHeight = '12rem',
    editorView = $bindable<EditorViewType | null>(null),
    loadExtensions,
    onChange,
    onFormat,
  }: Props = $props();

  let host: HTMLDivElement;
  let editableCompartment: CompartmentType | null = null;
  let editableExtension: ((disabled: boolean) => Extension) | null = null;
  let colorSchemeCompartment: CompartmentType | null = null;
  let colorSchemeExtension: ((dark: boolean) => Extension) | null = null;
  let colorSchemeObserver: MutationObserver | null = null;
  let loadFailed = $state(false);
  let contextMenuOpen = $state(false);
  let contextMenuX = $state(0);
  let contextMenuY = $state(0);

  onMount(() => {
    let disposed = false;
    void Promise.all([
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('#lib/shared/ui/code-editor-setup.ts'),
    ]).then(async ([stateModule, viewModule, setupModule]) => {
      if (disposed) return;
      const { EditorState, Compartment } = stateModule;
      const { EditorView, tooltips } = viewModule;
      const loaded = await loadExtensions({ EditorState, Compartment, EditorView, tooltips });
      if (disposed) return;

      editableCompartment = new Compartment();
      editableExtension = (nextDisabled) => EditorView.editable.of(!nextDisabled);
      colorSchemeCompartment = new Compartment();
      colorSchemeExtension = loaded.colorSchemeExtension;

      const state = EditorState.create({
        doc: value,
        extensions: [
          setupModule.codeEditorSetup,
          ...loaded.extensions,
          editableCompartment.of(editableExtension(disabled)),
          colorSchemeCompartment.of(colorSchemeExtension(usesDarkColorScheme())),
          createFormatKeymapExtension(() => onFormat, () => disabled),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': ariaLabel,
            'aria-multiline': 'true',
            'data-focus-ring': 'delegated',
            spellcheck: 'false',
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange(update.state.doc.toString());
          }),
        ],
      });
      editorView = new EditorView({ state, parent: host });

      let darkThemeActive = usesDarkColorScheme();
      colorSchemeObserver = new MutationObserver(() => {
        const nextDarkTheme = usesDarkColorScheme();
        if (
          nextDarkTheme === darkThemeActive
          || !editorView
          || !colorSchemeCompartment
          || !colorSchemeExtension
        ) return;
        darkThemeActive = nextDarkTheme;
        editorView.dispatch({
          effects: colorSchemeCompartment.reconfigure(colorSchemeExtension(nextDarkTheme)),
        });
      });
      colorSchemeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }).catch(() => {
      if (!disposed) loadFailed = true;
    });

    return () => {
      disposed = true;
      colorSchemeObserver?.disconnect();
      colorSchemeObserver = null;
      editorView?.destroy();
      editorView = null;
    };
  });

  $effect(() => {
    const nextValue = value;
    if (!editorView || editorView.state.doc.toString() === nextValue) return;
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: nextValue },
    });
  });

  $effect(() => {
    const nextDisabled = disabled;
    if (!editorView || !editableCompartment || !editableExtension) return;
    editorView.dispatch({
      effects: editableCompartment.reconfigure(editableExtension(nextDisabled)),
    });
  });

  function handleContextMenu(event: MouseEvent) {
    if (!editorView) return;
    event.preventDefault();
    event.stopPropagation();
    const anchor = getEditorContextMenuAnchor(event, editorView);
    contextMenuX = anchor.x;
    contextMenuY = anchor.y;
    contextMenuOpen = true;
  }

  function handleTextareaKeydown(event: KeyboardEvent) {
    if (!onFormat || disabled) return;
    if (shortcutMatches(event, { key: 'f', shift: true, alt: true })) {
      event.preventDefault();
      onFormat();
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class={`code-editor ${editorClass}`.trim()}
  class:disabled
  style={`--cfms-editor-min-height: ${minHeight};`}
  oncontextmenu={handleContextMenu}
>
  <div bind:this={host}></div>
  {#if !editorView && !loadFailed}
    <div class="editor-loading" aria-live="polite">{loadingLabel}</div>
  {:else if loadFailed}
    <textarea
      value={value}
      aria-label={ariaLabel}
      disabled={disabled}
      spellcheck="false"
      oninput={(event) => onChange(event.currentTarget.value)}
      onkeydown={handleTextareaKeydown}
    ></textarea>
  {/if}
</div>

<CodeEditorContextMenu
  open={contextMenuOpen}
  x={contextMenuX}
  y={contextMenuY}
  {editorView}
  {disabled}
  sourceElement={editorView?.contentDOM ?? null}
  {onFormat}
  onClose={() => { contextMenuOpen = false; }}
/>

<style>
  .code-editor {
    --color-md3-field: var(--colorNeutralBackground1);
    --color-md3-surface-container-high: var(--colorNeutralBackground2);
    position: relative;
    overflow: hidden;
    border: 1px solid var(--colorNeutralStroke1, var(--color-md3-outline));
    border-radius: 8px;
    background: var(--colorNeutralBackground1, var(--color-md3-field));
  }
  .code-editor.disabled { opacity: 0.55; }
  .editor-loading {
    display: grid;
    min-height: var(--cfms-editor-min-height, 12rem);
    place-items: center;
    color: var(--colorNeutralForeground3, var(--color-md3-on-surface-variant));
    font: 400 12px/16px var(--fontFamilyBase, var(--font-md3-sans));
  }
  textarea {
    display: block;
    width: 100%;
    min-height: var(--cfms-editor-min-height, 12rem);
    box-sizing: border-box;
    resize: vertical;
    border: 0;
    padding: 0.7rem;
    outline: 0;
    background: transparent;
    color: var(--colorNeutralForeground1, var(--color-md3-on-surface));
    font: 400 13px/1.55 var(--fontFamilyMonospace, var(--font-md3-mono));
  }
  :global(.code-editor .cm-editor) { min-height: var(--cfms-editor-min-height, 12rem); }
</style>
