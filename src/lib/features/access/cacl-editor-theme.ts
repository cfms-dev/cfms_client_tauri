import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

interface CaclSyntaxPalette {
  controlKeyword: string;
  definitionKeyword: string;
  keyword: string;
  bool: string;
  scope: string;
  logicOperator: string;
  atom: string;
  predicateFn: string;
  macro: string;
  atomicOp: string;
  subtractOp: string;
  timestamp: string;
  string: string;
  comment: string;
  punctuation: string;
}

const darkSyntaxPalette: CaclSyntaxPalette = {
  controlKeyword: '#c586c0',
  definitionKeyword: '#569cd6',
  keyword: '#9cdcfe',
  bool: '#569cd6',
  scope: '#4ec9b0',
  logicOperator: '#c586c0',
  atom: '#b5cea8',
  predicateFn: '#dcdcaa',
  macro: '#60cdff',
  atomicOp: '#4fc1ff',
  subtractOp: '#f48771',
  timestamp: '#d7ba7d',
  string: '#ce9178',
  comment: '#6a9955',
  punctuation: '#d4d4d4',
};

const lightSyntaxPalette: CaclSyntaxPalette = {
  controlKeyword: '#af00db',
  definitionKeyword: '#004e8c',
  keyword: '#0451a5',
  bool: '#0067c0',
  scope: '#267f99',
  logicOperator: '#af00db',
  atom: '#098658',
  predicateFn: '#795e26',
  macro: '#004e8c',
  atomicOp: '#0070c1',
  subtractOp: '#c42b1c',
  timestamp: '#8a3707',
  string: '#a31515',
  comment: '#008000',
  punctuation: '#3b3b3b',
};

export function caclCodeEditorTheme(dark: boolean): Extension {
  const palette = dark ? darkSyntaxPalette : lightSyntaxPalette;
  const syntaxTheme = HighlightStyle.define([
    { tag: tags.controlKeyword, color: palette.controlKeyword, fontWeight: '600' },
    { tag: tags.definitionKeyword, color: palette.definitionKeyword, fontWeight: '600' },
    { tag: tags.keyword, color: palette.keyword },
    { tag: tags.bool, color: palette.bool, fontWeight: '600' },
    { tag: tags.typeName, color: palette.scope, fontWeight: '600' },
    { tag: tags.operatorKeyword, color: palette.logicOperator, fontWeight: '600' },
    { tag: tags.atom, color: palette.atom, fontWeight: '600' },
    { tag: tags.function(tags.variableName), color: palette.predicateFn, fontWeight: '600' },
    { tag: tags.macroName, color: palette.macro, fontWeight: '600' },
    { tag: tags.constant(tags.name), color: palette.atomicOp },
    { tag: tags.variableName, color: palette.subtractOp },
    { tag: tags.arithmeticOperator, color: palette.subtractOp, fontWeight: '700' },
    { tag: tags.special(tags.string), color: palette.timestamp },
    { tag: tags.string, color: palette.string },
    { tag: tags.lineComment, color: palette.comment, fontStyle: 'italic' },
    { tag: [tags.squareBracket, tags.paren, tags.separator], color: palette.punctuation },
    {
      tag: tags.invalid,
      color: 'var(--colorStatusDangerForeground1, var(--color-md3-error))',
      textDecoration: 'underline wavy var(--colorStatusDangerForeground1, var(--color-md3-error))',
    },
  ]);

  return [
    EditorView.theme({
      '&': {
        minHeight: '14rem',
        backgroundColor: 'var(--colorNeutralBackground1, var(--color-md3-field))',
        color: 'var(--colorNeutralForeground1, var(--color-md3-on-surface))',
        colorScheme: dark ? 'dark' : 'light',
        fontFamily: 'var(--fontFamilyMonospace, var(--font-md3-mono))',
        fontSize: '0.8125rem',
        lineHeight: '1.55',
      },
      '.cm-content': {
        minHeight: '14rem',
        padding: '0.65rem 0',
        caretColor: 'var(--colorBrandForeground1, var(--color-md3-primary))',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--colorNeutralBackground2, var(--color-md3-surface-container-high))',
        color: 'var(--colorNeutralForeground3, var(--color-md3-on-surface-variant))',
        borderRight: '1px solid var(--colorNeutralStroke2, var(--color-md3-outline))',
      },
      '.cm-foldGutter .cm-gutterElement': {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 0.125rem',
      },
      '.cm-foldGutter span': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.125rem',
        height: '1.125rem',
        padding: '0',
        borderRadius: '4px',
        color: 'var(--colorNeutralForeground3, var(--color-md3-on-surface-variant))',
        fill: 'currentColor',
        cursor: 'pointer',
        transition: 'background-color 120ms ease, color 120ms ease',
      },
      '.cm-foldGutter span:hover': {
        backgroundColor: 'var(--colorSubtleBackgroundHover, var(--color-md3-surface-container-highest))',
        color: 'var(--colorNeutralForeground1, var(--color-md3-on-surface))',
      },
      '.cm-foldGutter svg': { width: '16px', height: '16px' },
      '.cm-activeLine': {
        backgroundColor: dark
          ? 'color-mix(in srgb, var(--colorNeutralForeground1, #ffffff) 6%, transparent)'
          : 'color-mix(in srgb, var(--colorNeutralForeground1, #242424) 5%, transparent)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: dark
          ? 'color-mix(in srgb, var(--colorNeutralForeground1, #ffffff) 7%, transparent)'
          : 'color-mix(in srgb, var(--colorNeutralForeground1, #242424) 6%, transparent)',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--colorBrandForeground1, var(--color-md3-primary))',
        borderLeftWidth: '2px',
      },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
        backgroundColor: dark
          ? 'color-mix(in srgb, var(--colorBrandBackgroundStatic, #0067c0) 58%, transparent)'
          : 'color-mix(in srgb, var(--colorBrandBackground, var(--color-md3-primary)) 28%, transparent)',
      },
      '.cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: dark
          ? 'color-mix(in srgb, var(--colorBrandBackgroundStatic, #0067c0) 34%, transparent)'
          : 'color-mix(in srgb, var(--colorBrandBackground, var(--color-md3-primary)) 18%, transparent)',
      },
      '.cm-selectionMatch': {
        backgroundColor: dark
          ? 'color-mix(in srgb, var(--colorBrandBackground, #60cdff) 18%, transparent)'
          : 'color-mix(in srgb, var(--colorBrandBackground, #0067c0) 14%, transparent)',
        borderRadius: '2px',
      },
      '.cm-selectionMatch-main': {
        backgroundColor: 'transparent',
      },
      '.cm-matchingBracket': {
        backgroundColor: 'var(--colorBrandBackground2, var(--color-md3-primary-container))',
        outline: '1px solid var(--colorCompoundBrandStroke, var(--color-md3-primary-emphasis))',
      },
      '&.cm-focused': {
        outline: '2px solid var(--colorStrokeFocus2, var(--color-md3-primary))',
        outlineOffset: '1px',
      },
      '.cm-tooltip, .cm-panels': {
        border: '1px solid var(--colorNeutralStroke1, var(--color-md3-outline))',
        borderRadius: '8px',
        backgroundColor: 'var(--colorNeutralBackground1, var(--color-md3-surface-container-high))',
        color: 'var(--colorNeutralForeground1, var(--color-md3-on-surface))',
        boxShadow: 'var(--shadow16)',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--colorBrandBackground2, var(--color-md3-primary-container))',
        color: 'var(--colorBrandForeground2, var(--color-md3-on-primary-container))',
      },
      '.cm-tooltip-lint': {
        maxWidth: 'min(34rem, 90vw)',
      },
      '.cm-diagnostic': {
        padding: '6px 10px',
        fontFamily: 'var(--fontFamilyBase, var(--font-md3-sans))',
        fontSize: '12px',
        lineHeight: '16px',
      },
      '.cm-diagnostic-error': {
        borderLeft: '1px solid var(--colorStatusDangerForeground1, var(--color-md3-error))',
      },
      '.cm-diagnostic-warning': {
        borderLeft: '1px solid var(--colorStatusWarningForeground1, #bc4b09)',
      },
      '.cm-diagnosticAction': {
        marginTop: '4px',
        marginRight: '6px',
        padding: '2px 8px',
        borderRadius: '4px',
        border: '1px solid var(--colorNeutralStroke1, var(--color-md3-outline))',
        backgroundColor: 'var(--colorNeutralBackground2, var(--color-md3-surface-container))',
        color: 'var(--colorBrandForegroundLink, var(--color-md3-primary))',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
      },
      '.cm-diagnosticAction:hover': {
        backgroundColor: 'var(--colorSubtleBackgroundHover)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'var(--colorStatusWarningBackground1, var(--color-md3-warning-container))',
        color: 'var(--colorStatusWarningForeground2, var(--color-md3-on-warning-container))',
      },
    }, { dark }),
    syntaxHighlighting(syntaxTheme),
  ];
}
