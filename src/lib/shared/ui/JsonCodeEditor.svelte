<script lang="ts">
  import type { EditorView as EditorViewType } from '@codemirror/view';
  import type { Diagnostic } from '@codemirror/lint';
  import { decodeJsonPointerSegment } from '#lib/shared/format/values.ts';
  import CodeEditor, { type CodeEditorMountModules } from '#lib/shared/ui/CodeEditor.svelte';

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
    onFormat?: () => void;
  }

  let {
    value,
    diagnostics = [],
    disabled = false,
    ariaLabel,
    loadingLabel,
    onChange,
    onFormat,
  }: Props = $props();

  let editorView = $state<EditorViewType | null>(null);
  let forceLinting: ((view: EditorViewType) => void) | null = null;

  function diagnosticRange(text: string, path: string): { from: number; to: number } {
    const leaf = path.split('/').filter(Boolean).at(-1);
    if (!leaf) return { from: 0, to: Math.min(1, text.length) };
    const needle = JSON.stringify(decodeJsonPointerSegment(leaf));
    const from = text.indexOf(needle);
    return from < 0
      ? { from: 0, to: Math.min(1, text.length) }
      : { from, to: from + needle.length };
  }

  async function loadExtensions(_modules: CodeEditorMountModules) {
    const [jsonModule, lintModule, themeModule] = await Promise.all([
      import('@codemirror/lang-json'),
      import('@codemirror/lint'),
      import('#lib/shared/ui/json-code-editor-theme.ts'),
    ]);
    const { json, jsonParseLinter } = jsonModule;
    const { linter, lintGutter } = lintModule;
    const parseJson = jsonParseLinter();
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

    return {
      extensions: [json(), lintGutter(), schemaLinter],
      colorSchemeExtension: themeModule.jsonCodeEditorTheme,
    };
  }

  $effect(() => {
    diagnostics;
    if (editorView && forceLinting) forceLinting(editorView);
  });
</script>

<CodeEditor
  {value}
  {disabled}
  {ariaLabel}
  {loadingLabel}
  minHeight="12rem"
  bind:editorView
  {loadExtensions}
  {onChange}
  {onFormat}
/>
