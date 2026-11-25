<script lang="ts">
  import { onMount } from 'svelte';
  import type { EditorView as EditorViewType } from '@codemirror/view';
  import type { Compartment as CompartmentType, Extension } from '@codemirror/state';
  import type { ObjectType } from 'codemirror-lang-cacl';
  import type { ServerCaclDiagnostic } from '$lib/api/types';
  import type { CaclPrincipalDirectory } from './cacl-editor-extensions';

  interface Props {
    value: string;
    targetObjectType?: ObjectType | null;
    serverDiagnostics?: readonly ServerCaclDiagnostic[];
    principalDirectory?: CaclPrincipalDirectory;
    disabled?: boolean;
    ariaLabel: string;
    loadingLabel: string;
    onChange: (value: string) => void;
  }

  let {
    value,
    targetObjectType = null,
    serverDiagnostics = [],
    principalDirectory = { users: [], groups: [] },
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
  let linterCompartment: CompartmentType | null = null;
  let buildLinterExtension: ((objectType: ObjectType | null) => Extension) | null = null;
  let colorSchemeObserver: MutationObserver | null = null;
  let forceLinting: ((view: EditorViewType) => void) | null = null;
  let loadFailed = $state(false);

  function usesDarkColorScheme(): boolean {
    return document.documentElement.dataset.theme !== 'light';
  }

  export function insertAtCursor(snippet: string): void {
    if (!editorView || disabled) return;
    const { from, to } = editorView.state.selection.main;
    editorView.dispatch({
      changes: { from, to, insert: snippet },
      selection: { anchor: from + snippet.length },
    });
    editorView.focus();
  }

  export function focusRange(from: number, to: number): void {
    if (!editorView) return;
    const len = editorView.state.doc.length;
    const safeFrom = Math.max(0, Math.min(len, from));
    const safeTo = Math.max(safeFrom, Math.min(len, to));
    editorView.dispatch({
      selection: { anchor: safeFrom, head: safeTo },
      scrollIntoView: true,
    });
    editorView.focus();
  }

  onMount(() => {
    let disposed = false;
    void Promise.all([
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@codemirror/lint'),
      import('codemirror-lang-cacl'),
      import('$lib/shared/ui/json-code-editor-setup'),
      import('./cacl-editor-theme'),
      import('./cacl-editor-extensions'),
    ]).then(([
      stateModule,
      viewModule,
      lintModule,
      caclModule,
      setupModule,
      themeModule,
      extModule,
    ]) => {
      if (disposed) return;
      const { EditorState, Compartment } = stateModule;
      const { EditorView } = viewModule;
      const { lintGutter } = lintModule;
      const { cacl, caclLanguage } = caclModule;

      editableCompartment = new Compartment();
      editableExtension = (nextDisabled) => EditorView.editable.of(!nextDisabled);
      colorSchemeCompartment = new Compartment();
      colorSchemeExtension = themeModule.caclCodeEditorTheme;
      linterCompartment = new Compartment();
      buildLinterExtension = (objectType) => extModule.createUnifiedCaclLinter({
        targetObjectType: objectType,
        getServerDiagnostics: () => serverDiagnostics,
        enableQuickFixes: true,
        delay: 220,
      });
      forceLinting = lintModule.forceLinting;

      const state = EditorState.create({
        doc: value,
        extensions: [
          setupModule.jsonCodeEditorSetup,
          cacl({ lint: false, autocomplete: true }),
          caclLanguage.data.of({
            autocomplete: extModule.createDynamicCaclCompletionSource(() => principalDirectory),
          }),
          lintGutter(),
          linterCompartment.of(buildLinterExtension(targetObjectType)),
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
    const nextTargetType = targetObjectType;
    if (!editorView || !linterCompartment || !buildLinterExtension) return;
    editorView.dispatch({
      effects: linterCompartment.reconfigure(buildLinterExtension(nextTargetType)),
    });
  });

  $effect(() => {
    serverDiagnostics;
    if (editorView && forceLinting) forceLinting(editorView);
  });
</script>

<div class="cacl-code-editor" class:disabled>
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
  .cacl-code-editor {
    position: relative;
    overflow: hidden;
    border: 1px solid var(--colorNeutralStroke1, var(--color-md3-outline));
    border-radius: 8px;
    background: var(--colorNeutralBackground1, var(--color-md3-field));
  }
  .cacl-code-editor.disabled { opacity: 0.55; }
  .editor-loading {
    display: grid;
    min-height: 14rem;
    place-items: center;
    color: var(--colorNeutralForeground3, var(--color-md3-on-surface-variant));
    font: 400 12px/16px var(--fontFamilyBase, var(--font-md3-sans));
  }
  textarea {
    display: block;
    width: 100%;
    min-height: 14rem;
    box-sizing: border-box;
    resize: vertical;
    border: 0;
    padding: 0.7rem;
    background: transparent;
    color: var(--colorNeutralForeground1, var(--color-md3-on-surface));
    font: 400 13px/1.55 var(--fontFamilyMonospace, var(--font-md3-mono));
  }
  :global(.cacl-code-editor .cm-editor) { min-height: 14rem; }
</style>
