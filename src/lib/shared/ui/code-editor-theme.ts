import { type HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ICON_VARIANTS } from '$lib/shared/ui/icons';

const MASK_BASE = {
  maskRepeat: 'no-repeat',
  maskPosition: 'center',
  maskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  WebkitMaskSize: 'contain',
} as const;

function maskIconStyle(svg: string, color: string) {
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return {
    backgroundColor: color,
    maskImage: url,
    WebkitMaskImage: url,
  };
}

export interface CodeEditorThemeOptions {
  syntaxTheme: HighlightStyle;
  minHeight?: string;
  fontSize?: string;
  lineHeight?: string;
}

export function createCodeEditorTheme(
  dark: boolean,
  {
    syntaxTheme,
    minHeight = '12rem',
    fontSize = '0.8125rem',
    lineHeight = '1.55',
  }: CodeEditorThemeOptions,
): Extension {
  return [
    EditorView.theme({
      '&': {
        minHeight,
        backgroundColor: 'var(--colorNeutralBackground1, var(--color-md3-field))',
        color: 'var(--colorNeutralForeground1, var(--color-md3-on-surface))',
        colorScheme: dark ? 'dark' : 'light',
        fontFamily: 'var(--fontFamilyMonospace, var(--font-md3-mono))',
        fontSize,
        lineHeight,
      },
      '.cm-content': {
        minHeight,
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
      '.cm-gutter-lint': {
        width: '1.5rem',
      },
      '.cm-gutter-lint .cm-gutterElement': {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0',
      },
      '.cm-lint-marker': {
        content: 'normal',
        display: 'block',
        width: '16px',
        height: '16px',
        flexShrink: '0',
        cursor: 'pointer',
        ...MASK_BASE,
      },
      '.cm-lint-marker-warning': {
        content: 'normal',
        ...maskIconStyle(
          ICON_VARIANTS.warning.smallFilled,
          'var(--colorStatusWarningForeground1, #bc4b09)',
        ),
      },
      '.cm-lint-marker-error': {
        content: 'normal',
        ...maskIconStyle(
          ICON_VARIANTS.errorFilled.smallFilled,
          'var(--colorStatusDangerForeground1, var(--color-md3-error))',
        ),
      },
      '.cm-lint-marker-info': {
        content: 'normal',
        ...maskIconStyle(
          ICON_VARIANTS.info.smallFilled,
          'var(--colorBrandForeground1, var(--color-md3-primary))',
        ),
      },
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
      '.cm-tooltip': {
        zIndex: '55',
      },
      '.cm-tooltip-autocomplete > ul': {
        borderRadius: '8px',
        overflow: 'hidden',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--colorBrandBackground2, var(--color-md3-primary-container))',
        color: 'var(--colorBrandForeground2, var(--color-md3-on-primary-container))',
      },
      '.cm-tooltip-lint': {
        maxWidth: 'min(34rem, 90vw)',
        borderRadius: '8px',
        overflow: 'hidden',
      },
      '.cm-diagnostic': {
        position: 'relative',
        marginLeft: '0',
        borderLeft: 'none',
        padding: '8px 12px 8px 34px',
        fontFamily: 'var(--fontFamilyBase, var(--font-md3-sans))',
        fontSize: '12px',
        lineHeight: '16px',
      },
      '.cm-diagnostic + .cm-diagnostic': {
        borderTop: '1px solid var(--colorNeutralStroke2, var(--color-md3-outline))',
      },
      '.cm-diagnostic::before': {
        content: '""',
        position: 'absolute',
        left: '10px',
        top: '8px',
        width: '16px',
        height: '16px',
        pointerEvents: 'none',
        ...MASK_BASE,
      },
      '.cm-diagnostic-error, .cm-diagnostic-warning, .cm-diagnostic-info, .cm-diagnostic-hint': {
        borderLeft: 'none',
      },
      '.cm-diagnostic-error::before': maskIconStyle(
        ICON_VARIANTS.errorFilled.smallFilled,
        'var(--colorStatusDangerForeground1, var(--color-md3-error))',
      ),
      '.cm-diagnostic-warning::before': maskIconStyle(
        ICON_VARIANTS.warning.smallFilled,
        'var(--colorStatusWarningForeground1, #bc4b09)',
      ),
      '.cm-diagnostic-info::before': maskIconStyle(
        ICON_VARIANTS.info.smallFilled,
        'var(--colorBrandForeground1, var(--color-md3-primary))',
      ),
      '.cm-diagnostic-hint::before': maskIconStyle(
        ICON_VARIANTS.info.smallFilled,
        'var(--colorNeutralForeground3, var(--color-md3-on-surface-variant))',
      ),
      '.cm-diagnosticSource': {
        marginTop: '4px',
        fontSize: '11px',
        lineHeight: '14px',
        color: 'var(--colorNeutralForeground3, var(--color-md3-on-surface-variant))',
        opacity: '1',
      },
      '.cm-diagnosticAction': {
        margin: '6px 6px 0 0',
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
