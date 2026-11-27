<script lang="ts">
  import type { EditorView as EditorViewType } from '@codemirror/view';
  import type { Compartment as CompartmentType, Extension } from '@codemirror/state';
  import type { ObjectType } from 'codemirror-lang-cacl';
  import type { ServerCaclDiagnostic } from '#lib/api/types.ts';
  import CodeEditor, { type CodeEditorMountModules } from '#lib/shared/ui/CodeEditor.svelte';
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
    onFormat?: () => void;
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
    onFormat,
  }: Props = $props();

  let editorView = $state<EditorViewType | null>(null);
  let linterCompartment: CompartmentType | null = null;
  let buildLinterExtension: ((objectType: ObjectType | null) => Extension) | null = null;
  let forceLinting: ((view: EditorViewType) => void) | null = null;

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

  async function loadExtensions({ Compartment, tooltips }: CodeEditorMountModules) {
    const [lintModule, caclModule, themeModule, extModule] = await Promise.all([
      import('@codemirror/lint'),
      import('codemirror-lang-cacl'),
      import('./cacl-editor-theme'),
      import('./cacl-editor-extensions'),
    ]);
    const { lintGutter } = lintModule;
    const { cacl, caclLanguage } = caclModule;

    linterCompartment = new Compartment();
    buildLinterExtension = (objectType) => extModule.createUnifiedCaclLinter({
      targetObjectType: objectType,
      getServerDiagnostics: () => serverDiagnostics,
      enableQuickFixes: true,
      delay: 220,
    });
    forceLinting = lintModule.forceLinting;

    return {
      extensions: [
        cacl({ lint: false, autocomplete: true }),
        caclLanguage.data.of({
          autocomplete: extModule.createDynamicCaclCompletionSource(() => principalDirectory),
        }),
        ...(typeof document !== 'undefined' && document.body
          ? [tooltips({ parent: document.body })]
          : []),
        lintGutter(),
        linterCompartment.of(buildLinterExtension(targetObjectType)),
      ],
      colorSchemeExtension: themeModule.caclCodeEditorTheme,
    };
  }

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

<CodeEditor
  {value}
  {disabled}
  {ariaLabel}
  {loadingLabel}
  editorClass="cacl-code-editor"
  minHeight="14rem"
  bind:editorView
  {loadExtensions}
  {onChange}
  {onFormat}
/>

<style>
  @media (forced-colors: active) {
    :global(.cacl-code-editor .cm-lint-marker),
    :global(.cm-tooltip-lint .cm-diagnostic::before) {
      background-color: CanvasText !important;
    }
  }
</style>
