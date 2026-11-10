import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

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
      color: 'var(--color-md3-error)',
      textDecoration: 'underline wavy var(--color-md3-error)',
    },
  ]);

  return [
    EditorView.theme({
      '&': {
        minHeight: '12rem',
        backgroundColor: 'var(--color-md3-field)',
        color: 'var(--color-md3-on-surface)',
        colorScheme: dark ? 'dark' : 'light',
        fontFamily: 'var(--font-md3-mono)',
        fontSize: '0.78rem',
      },
      '.cm-content': { minHeight: '12rem', padding: '0.65rem 0' },
      '.cm-gutters': {
        backgroundColor: 'var(--color-md3-surface-container-high)',
        color: 'var(--color-md3-on-surface-variant)',
        borderRight: '1px solid var(--color-md3-outline)',
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
        color: 'var(--color-md3-on-surface-variant)',
        fill: 'currentColor',
        fontSize: '1rem',
        fontStyle: 'normal',
        fontWeight: '400',
        fontVariantLigatures: 'normal',
        lineHeight: '1',
        letterSpacing: 'normal',
        textTransform: 'none',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        transition: 'background-color 120ms ease, color 120ms ease',
      },
      '.cm-foldGutter span:hover': {
        backgroundColor: 'var(--color-md3-surface-container-highest)',
        color: 'var(--color-md3-on-surface)',
      },
      '.cm-foldGutter svg': { width: '16px', height: '16px' },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: 'var(--color-md3-surface-container-highest)',
      },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-md3-primary)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'color-mix(in srgb, var(--color-md3-primary) 26%, transparent)',
      },
      '.cm-matchingBracket': {
        backgroundColor: 'var(--color-md3-primary-container)',
        outline: '1px solid var(--color-md3-primary-emphasis)',
      },
      '&.cm-focused': {
        outline: '2px solid var(--color-md3-primary)',
        outlineOffset: '1px',
      },
      '.cm-tooltip, .cm-panels': {
        border: '1px solid var(--color-md3-outline)',
        backgroundColor: 'var(--color-md3-surface-container-high)',
        color: 'var(--color-md3-on-surface)',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--color-md3-primary-container)',
        color: 'var(--color-md3-on-primary-container)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'var(--color-md3-warning-container)',
        color: 'var(--color-md3-on-warning-container)',
      },
    }, { dark }),
    syntaxHighlighting(syntaxTheme),
  ];
}
