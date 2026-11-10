<script lang="ts">
  import { onMount } from 'svelte';
  import type { EditorView as EditorViewType } from '@codemirror/view';
  import type { Compartment as CompartmentType, Extension } from '@codemirror/state';
  import type { Diagnostic } from '@codemirror/lint';

  export interface JsonEditorDiagnostic {
    path: string;
    message: string;
  }

  interface Props {
    value: string;
    diagnostics?: JsonEditorDiagnostic[];
    disabled?: boolean;
    ariaLabel: string;
    loadingLabel: string;
    onChange: (value: string) => void;
  }

  let {
    value,
    diagnostics = [],
    disabled = false,
    ariaLabel,
    loadingLabel,
    onChange,
  }: Props = $props();

  let host: HTMLDivElement;
  let editorView = $state<EditorViewType | null>(null);
  let editableCompartment: CompartmentType | null = null;
  let editableExtension: ((disabled: boolean) => Extension) | null = null;
  let colorSchemeCompartment: CompartmentType | null = null;
  let colorSchemeExtension: ((dark: boolean) => Extension) | null = null;
  let colorSchemeObserver: MutationObserver | null = null;
  let forceLinting: ((view: EditorViewType) => void) | null = null;
  let loadFailed = $state(false);

  function usesDarkColorScheme(): boolean {
    return document.documentElement.dataset.theme !== 'light';
  }

  function decodePointerSegment(segment: string): string {
    return segment.replaceAll('~1', '/').replaceAll('~0', '~');
  }

  function diagnosticRange(text: string, path: string): { from: number; to: number } {
    const leaf = path.split('/').filter(Boolean).at(-1);
    if (!leaf) return { from: 0, to: Math.min(1, text.length) };
    const needle = JSON.stringify(decodePointerSegment(leaf));
    const from = text.indexOf(needle);
    return from < 0
      ? { from: 0, to: Math.min(1, text.length) }
      : { from, to: from + needle.length };
  }

  onMount(() => {
    let disposed = false;
    void Promise.all([
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@codemirror/lang-json'),
      import('@codemirror/lint'),
      import('$lib/shared/ui/json-code-editor-setup'),
      import('$lib/shared/ui/json-code-editor-theme'),
    ]).then(([
      stateModule,
      viewModule,
      jsonModule,
      lintModule,
      setupModule,
      themeModule,
    ]) => {
      if (disposed) return;
      const { EditorState, Compartment } = stateModule;
      const { EditorView } = viewModule;
      const { json, jsonParseLinter } = jsonModule;
      const { linter, lintGutter } = lintModule;
      const parseJson = jsonParseLinter();
      editableCompartment = new Compartment();
      editableExtension = (nextDisabled) => EditorView.editable.of(!nextDisabled);
      colorSchemeCompartment = new Compartment();
      colorSchemeExtension = themeModule.jsonCodeEditorTheme;
      forceLinting = lintModule.forceLinting;

      const schemaLinter = linter((view) => {
        const syntaxDiagnostics = parseJson(view);
        if (syntaxDiagnostics.length > 0) return syntaxDiagnostics;
        const text = view.state.doc.toString();
        return diagnostics.map((diagnostic): Diagnostic => ({
          ...diagnosticRange(text, diagnostic.path),
          severity: 'error',
          message: diagnostic.message,
          source: 'JSON Schema',
        }));
      }, { delay: 180 });

      const state = EditorState.create({
        doc: value,
        extensions: [
          setupModule.jsonCodeEditorSetup,
          json(),
          lintGutter(),
          schemaLinter,
          editableCompartment.of(editableExtension(disabled)),
          colorSchemeCompartment.of(colorSchemeExtension(usesDarkColorScheme())),
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

  $effect(() => {
    diagnostics;
    if (editorView && forceLinting) forceLinting(editorView);
  });
</script>

<div class="code-editor" class:disabled>
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
    ></textarea>
  {/if}
</div>

<style>
  .code-editor {
    --color-md3-field: var(--colorNeutralBackground1);
    --color-md3-surface-container-high: var(--colorNeutralBackground2);
    position: relative;
    overflow: hidden;
    border: 1px solid var(--color-md3-outline);
    border-radius: 8px;
    background: var(--color-md3-field);
  }
  .code-editor.disabled { opacity: 0.55; }
  .editor-loading { display: grid; min-height: 12rem; place-items: center; color: var(--color-md3-on-surface-variant); font: 0.75rem var(--font-md3-sans); }
  textarea { display: block; width: 100%; min-height: 12rem; box-sizing: border-box; resize: vertical; border: 0; padding: 0.7rem; outline: 0; background: transparent; color: var(--color-md3-on-surface); font: 0.78rem/1.5 var(--font-md3-mono); }
  :global(.code-editor .cm-editor) { min-height: 12rem; }
</style>
