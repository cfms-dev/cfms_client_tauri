import { HighlightStyle } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { createCodeEditorTheme } from '$lib/shared/ui/code-editor-theme';

interface JsonSyntaxPalette {
  property: string;
  string: string;
  number: string;
  literal: string;
}

const darkSyntaxPalette: JsonSyntaxPalette = {
  property: '#9cdcfe',
  string: '#ce9178',
  number: '#b5cea8',
  literal: '#c586c0',
};

const lightSyntaxPalette: JsonSyntaxPalette = {
  property: '#0451a5',
  string: '#a31515',
  number: '#098658',
  literal: '#af00db',
};

export function jsonCodeEditorTheme(dark: boolean): Extension {
  const palette = dark ? darkSyntaxPalette : lightSyntaxPalette;
  const syntaxTheme = HighlightStyle.define([
    { tag: tags.propertyName, color: palette.property },
    { tag: tags.string, color: palette.string },
    { tag: tags.number, color: palette.number },
    { tag: [tags.bool, tags.null], color: palette.literal, fontWeight: '600' },
    {
      tag: tags.invalid,
      color: 'var(--colorStatusDangerForeground1, var(--color-md3-error))',
      textDecoration: 'underline wavy var(--colorStatusDangerForeground1, var(--color-md3-error))',
    },
  ]);

  return createCodeEditorTheme(dark, {
    syntaxTheme,
    minHeight: '12rem',
    fontSize: '0.78rem',
    lineHeight: '1.5',
  });
}
