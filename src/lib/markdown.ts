export type MarkdownBlock =
  | { type: 'heading'; depth: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language: string | null; code: string };

const headingPattern = /^(#{1,4})\s+(.+)$/;
const unorderedListPattern = /^\s*[-*+]\s+(.+)$/;
const orderedListPattern = /^\s*\d+[.)]\s+(.+)$/;

export function parseMarkdownBlocks(markdown: string | null | undefined): MarkdownBlock[] {
  if (!markdown?.trim()) return [];

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let codeLines: string[] | null = null;
  let codeLanguage: string | null = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push({ type: 'paragraph', text: paragraph.join(' ').trim() });
    paragraph = [];
  }

  function flushList() {
    if (!listItems.length) return;
    blocks.push({ type: 'list', ordered: listOrdered, items: listItems });
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/u, '');
    const trimmed = line.trim();

    if (codeLines) {
      if (trimmed.startsWith('```')) {
        blocks.push({
          type: 'code',
          language: codeLanguage,
          code: codeLines.join('\n'),
        });
        codeLines = null;
        codeLanguage = null;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (trimmed.startsWith('```')) {
      flushParagraph();
      flushList();
      codeLines = [];
      codeLanguage = trimmed.slice(3).trim() || null;
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(headingPattern);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        depth: heading[1].length,
        text: stripInlineMarkdown(heading[2]),
      });
      continue;
    }

    const unorderedList = line.match(unorderedListPattern);
    const orderedList = line.match(orderedListPattern);
    if (unorderedList || orderedList) {
      flushParagraph();
      const ordered = Boolean(orderedList);
      if (listItems.length && listOrdered !== ordered) {
        flushList();
      }
      listOrdered = ordered;
      listItems.push(stripInlineMarkdown((unorderedList ?? orderedList)?.[1] ?? ''));
      continue;
    }

    if (listItems.length && /^\s{2,}\S/u.test(line)) {
      const lastIndex = listItems.length - 1;
      listItems[lastIndex] = `${listItems[lastIndex]} ${stripInlineMarkdown(trimmed)}`;
      continue;
    }

    paragraph.push(stripInlineMarkdown(trimmed));
  }

  if (codeLines) {
    blocks.push({
      type: 'code',
      language: codeLanguage,
      code: codeLines.join('\n'),
    });
  }
  flushParagraph();
  flushList();

  return blocks;
}

export function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/\*([^*]+)\*/gu, '$1')
    .replace(/_([^_]+)_/gu, '$1')
    .trim();
}
