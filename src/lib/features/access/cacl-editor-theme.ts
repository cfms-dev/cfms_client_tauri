import { HighlightStyle } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { createCodeEditorTheme } from '$lib/shared/ui/code-editor-theme';

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

  return createCodeEditorTheme(dark, {
    syntaxTheme,
    minHeight: '14rem',
    fontSize: '0.8125rem',
    lineHeight: '1.55',
  });
}
