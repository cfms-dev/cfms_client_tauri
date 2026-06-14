import { browser } from '$app/environment';
import DOMPurify, { type Config } from 'dompurify';
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

const markdownSanitizeConfig: Config = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'rel'],
  FORBID_ATTR: ['style'],
};

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

markdown.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const targetIndex = token.attrIndex('target');
  const relIndex = token.attrIndex('rel');

  if (targetIndex < 0) {
    token.attrPush(['target', '_blank']);
  } else {
    token.attrs![targetIndex] = ['target', '_blank'];
  }

  if (relIndex < 0) {
    token.attrPush(['rel', 'noreferrer']);
  } else {
    token.attrs![relIndex] = ['rel', 'noreferrer'];
  }

  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(markdownSource: string | null | undefined): string {
  if (!markdownSource?.trim()) return '';
  return sanitizeMarkdownHtml(markdown.render(stripMarkdownComments(markdownSource)));
}

export function markdownInlineToText(value: string): string {
  const tokens = markdown.parseInline(value, {});
  return collectTokenText(tokens).replace(/\s+/gu, ' ').trim();
}

function collectTokenText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'text' || token.type === 'code_inline') return token.content;
      if (token.children?.length) return collectTokenText(token.children);
      return '';
    })
    .join('');
}

function sanitizeMarkdownHtml(html: string): string {
  if (!browser) return html;
  return DOMPurify.sanitize(html, markdownSanitizeConfig);
}

function stripMarkdownComments(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/gu, '').trim();
}
