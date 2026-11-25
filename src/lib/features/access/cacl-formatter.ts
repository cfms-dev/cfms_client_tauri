import type { SyntaxNode } from '@lezer/common';
import { analyzeCacl, parser } from 'codemirror-lang-cacl';

export const CACL_FORMAT_MAX_LINE_LENGTH = 88;
export const CACL_FORMAT_INDENT = '  ';
export const CACL_FORMAT_MAX_BLANK_LINES = 2;

export type CaclFormatResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

interface CommentEntry {
  from: number;
  to: number;
  text: string;
}

interface PositionedBlock {
  from: number;
  to: number;
  text: string;
}

interface TokenizedItem {
  from: number;
  to: number;
  text: string;
  standaloneComments: string[];
  trailingComment: string | null;
}

function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  let child = node.firstChild;
  while (child) {
    result.push(child);
    child = child.nextSibling;
  }
  return result;
}

function findFirstSyntaxError(node: SyntaxNode): SyntaxNode | null {
  if (node.type.isError) return node;
  let child = node.firstChild;
  while (child) {
    const found = findFirstSyntaxError(child);
    if (found) return found;
    child = child.nextSibling;
  }
  return null;
}

function collectCommentsInSubtree(node: SyntaxNode, source: string): CommentEntry[] {
  const comments: CommentEntry[] = [];
  const visit = (cur: SyntaxNode) => {
    if (cur.name === 'Comment') {
      comments.push({
        from: cur.from,
        to: cur.to,
        text: source.slice(cur.from, cur.to).trimEnd(),
      });
      return;
    }
    let child = cur.firstChild;
    while (child) {
      visit(child);
      child = child.nextSibling;
    }
  };
  visit(node);
  return comments;
}

function hasNewlineBetween(source: string, from: number, to: number): boolean {
  return source.slice(from, to).includes('\n');
}

function countBlankLinesBetween(source: string, from: number, to: number): number {
  const between = source.slice(from, to);
  let newlines = 0;
  for (let i = 0; i < between.length; i += 1) {
    if (between[i] === '\n') newlines += 1;
  }
  return Math.min(CACL_FORMAT_MAX_BLANK_LINES, Math.max(0, newlines - 1));
}

function splitCommentsWithAnchors<T extends { from: number; to: number }>(
  items: T[],
  comments: CommentEntry[],
  source: string,
): { attached: Array<T & { standaloneComments: string[]; trailingComment: string | null }>; tailComments: string[] } {
  const sortedComments = [...comments].sort((a, b) => a.from - b.from);
  const attached = items.map((item) => ({
    ...item,
    standaloneComments: [] as string[],
    trailingComment: null as string | null,
  }));
  const tailComments: string[] = [];

  for (const comment of sortedComments) {
    const prevIdx = attached.findLastIndex((item) => item.to <= comment.from);
    if (prevIdx >= 0 && !hasNewlineBetween(source, attached[prevIdx].to, comment.from)) {
      attached[prevIdx].trailingComment = comment.text;
      continue;
    }
    const nextIdx = attached.findIndex((item) => item.from >= comment.to);
    if (nextIdx >= 0) {
      attached[nextIdx].standaloneComments.push(comment.text);
    } else {
      tailComments.push(comment.text);
    }
  }

  return { attached, tailComments };
}

function formatDirectiveNode(node: SyntaxNode, source: string, trailingInline: string | null): string {
  const stateNode = node.getChild('InheritState');
  const state = stateNode ? source.slice(stateNode.from, stateNode.to).trim() : 'on';
  const internalComments = collectCommentsInSubtree(node, source);
  const base = `inherit ${state};`;

  if (internalComments.length === 0) {
    return trailingInline ? `${base} ${trailingInline}` : base;
  }

  const lines = internalComments.map((c) => c.text);
  lines.push(trailingInline ? `${base} ${trailingInline}` : base);
  return lines.join('\n');
}

function formatOpItem(node: SyntaxNode, source: string): { text: string; comments: CommentEntry[] } {
  const subNode = node.getChild('OpSub');
  const addNode = node.getChild('OpAdd');
  const target = subNode ?? addNode;
  const identWrap = target?.getChild('OpIdent');
  const identNode = identWrap
    ? identWrap.getChild('PresetMacro')
      ?? identWrap.getChild('AtomicOp')
      ?? identWrap.getChild('UpperIdent')
    : null;
  const ident = identNode ? source.slice(identNode.from, identNode.to).trim() : '';
  return {
    text: subNode ? `-${ident}` : ident,
    comments: collectCommentsInSubtree(node, source),
  };
}

function formatPrincipalNode(node: SyntaxNode, source: string): { text: string; comments: CommentEntry[] } {
  const comments = collectCommentsInSubtree(node, source);
  if (node.getChild('AnyPred')) {
    return { text: 'any', comments };
  }
  const pred = node.getChild('PrincipalPred') ?? node.getChild('PermPred');
  if (pred) {
    const kindNode = pred.getChild('PrincipalKind') ?? pred.getChild('PermKind');
    const strNode = pred.getChild('String');
    const kind = kindNode ? source.slice(kindNode.from, kindNode.to).trim() : '';
    const str = strNode ? source.slice(strNode.from, strNode.to).trim() : '""';
    return { text: `${kind}(${str})`, comments };
  }
  return { text: source.slice(node.from, node.to).trim(), comments };
}

function formatBoolExprSingleLine(node: SyntaxNode, source: string): string {
  switch (node.name) {
    case 'BoolExpr': {
      const child = node.firstChild;
      return child ? formatBoolExprSingleLine(child, source) : source.slice(node.from, node.to).trim();
    }
    case 'OrExpr': {
      const branches = childrenOf(node).filter((c) => c.name === 'AndExpr');
      return branches.map((b) => formatBoolExprSingleLine(b, source)).join(' or ');
    }
    case 'AndExpr': {
      const factors = childrenOf(node).filter((c) => c.name === 'NotExpr');
      return factors.map((f) => formatBoolExprSingleLine(f, source)).join(' and ');
    }
    case 'NotExpr': {
      const child = childrenOf(node).find((c) => c.name === 'NegExpr' || c.name === 'Atom');
      return child ? formatBoolExprSingleLine(child, source) : source.slice(node.from, node.to).trim();
    }
    case 'NegExpr': {
      const inner = node.getChild('NotExpr');
      return inner ? `not ${formatBoolExprSingleLine(inner, source)}` : source.slice(node.from, node.to).trim();
    }
    case 'Atom': {
      const child = childrenOf(node).find(
        (c) => c.name === 'PrincipalPred' || c.name === 'PermPred' || c.name === 'AnyPred' || c.name === 'ParenExpr',
      );
      return child ? formatBoolExprSingleLine(child, source) : source.slice(node.from, node.to).trim();
    }
    case 'ParenExpr': {
      const inner = node.getChild('BoolExpr');
      return inner ? `(${formatBoolExprSingleLine(inner, source)})` : '()';
    }
    case 'PrincipalPred':
    case 'PermPred': {
      const kindNode = node.getChild('PrincipalKind') ?? node.getChild('PermKind');
      const strNode = node.getChild('String');
      const kind = kindNode ? source.slice(kindNode.from, kindNode.to).trim() : '';
      const str = strNode ? source.slice(strNode.from, strNode.to).trim() : '""';
      return `${kind}(${str})`;
    }
    case 'AnyPred':
      return 'any';
    default:
      return source.slice(node.from, node.to).trim();
  }
}

function packCommaItems(
  items: TokenizedItem[],
  firstPrefix: string,
  contIndent: string,
  closingSuffix: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let current = firstPrefix;
  let lineHasItem = false;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const isLast = i === items.length - 1;
    const sep = isLast ? '' : ',';
    const itemWithSep = `${item.text}${sep}${isLast ? closingSuffix : ''}`;

    if (item.standaloneComments.length > 0) {
      if (lineHasItem) {
        lines.push(current);
        current = contIndent;
        lineHasItem = false;
      } else if (current !== contIndent) {
        lines.push(current.trimEnd());
        current = contIndent;
      }
      for (const comment of item.standaloneComments) {
        lines.push(`${contIndent}${comment}`);
      }
    }

    const candidate = lineHasItem
      ? `${current} ${itemWithSep}`
      : `${current}${itemWithSep}`;

    if (lineHasItem && candidate.length > maxWidth) {
      lines.push(current);
      current = `${contIndent}${itemWithSep}`;
      lineHasItem = true;
    } else {
      current = candidate;
      lineHasItem = true;
    }

    if (item.trailingComment) {
      lines.push(`${current} ${item.trailingComment}`);
      current = contIndent;
      lineHasItem = false;
    }
  }

  if (lineHasItem) {
    lines.push(current);
  } else if (closingSuffix) {
    if (lines.length > 0 && !lines[lines.length - 1].includes('#')) {
      lines[lines.length - 1] += closingSuffix;
    } else {
      lines.push(`${contIndent}${closingSuffix.trimStart()}`);
    }
  }

  return lines;
}

function formatOpSetMultiLine(
  effect: string,
  items: TokenizedItem[],
  tailComments: string[],
  opSetTrailing: string | null,
): string[] {
  const hasAnyComments = tailComments.length > 0
    || items.some((item) => item.standaloneComments.length > 0 || item.trailingComment !== null);

  if (!hasAnyComments) {
    const lines: string[] = [`${effect} [`];
    const packed = packCommaItems(
      items,
      CACL_FORMAT_INDENT,
      CACL_FORMAT_INDENT,
      '',
      CACL_FORMAT_MAX_LINE_LENGTH,
    );
    lines.push(...packed);
    lines.push(opSetTrailing ? `] ${opSetTrailing}` : ']');
    return lines;
  }

  const lines: string[] = [`${effect} [`];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    for (const comment of item.standaloneComments) {
      lines.push(`${CACL_FORMAT_INDENT}${comment}`);
    }
    const comma = i < items.length - 1 ? ',' : '';
    const line = `${CACL_FORMAT_INDENT}${item.text}${comma}`;
    lines.push(item.trailingComment ? `${line} ${item.trailingComment}` : line);
  }
  for (const comment of tailComments) {
    lines.push(`${CACL_FORMAT_INDENT}${comment}`);
  }
  lines.push(opSetTrailing ? `] ${opSetTrailing}` : ']');
  return lines;
}

function formatWhenMultiLine(
  boolExprNode: SyntaxNode,
  source: string,
  suffix: string,
  trailingComment: string | null,
): string[] {
  const internalComments = collectCommentsInSubtree(boolExprNode, source);
  const orExpr = boolExprNode.getChild('OrExpr');
  if (!orExpr) {
    const single = `${CACL_FORMAT_INDENT}when ${formatBoolExprSingleLine(boolExprNode, source)}${suffix}`;
    const commentLines = internalComments.map((c) => `${CACL_FORMAT_INDENT}  ${c.text}`);
    return [...commentLines, trailingComment ? `${single} ${trailingComment}` : single];
  }

  const branches = childrenOf(orExpr).filter((c) => c.name === 'AndExpr');
  const lines: string[] = [];
  for (const comment of internalComments) {
    lines.push(`${CACL_FORMAT_INDENT}  ${comment.text}`);
  }

  const formatAndBranch = (
    branchNode: SyntaxNode,
    leadingKeyword: string,
    branchIndent: string,
    isLastBranch: boolean,
  ) => {
    const branchSingle = formatBoolExprSingleLine(branchNode, source);
    const endSuffix = isLastBranch ? suffix : '';
    const fullLine = `${branchIndent}${leadingKeyword} ${branchSingle}${endSuffix}`;
    const factors = childrenOf(branchNode).filter((c) => c.name === 'NotExpr');

    if (factors.length > 1 && fullLine.length > CACL_FORMAT_MAX_LINE_LENGTH) {
      const factorIndent = `${CACL_FORMAT_INDENT}  `;
      for (let j = 0; j < factors.length; j += 1) {
        const factorText = formatBoolExprSingleLine(factors[j], source);
        const factorSuffix = isLastBranch && j === factors.length - 1 ? suffix : '';
        const prefix = j === 0 ? `${branchIndent}${leadingKeyword}` : `${factorIndent}and`;
        const line = `${prefix} ${factorText}${factorSuffix}`;
        const isFinalLine = isLastBranch && j === factors.length - 1;
        lines.push(isFinalLine && trailingComment ? `${line} ${trailingComment}` : line);
      }
      return;
    }

    lines.push(isLastBranch && trailingComment ? `${fullLine} ${trailingComment}` : fullLine);
  };

  for (let i = 0; i < branches.length; i += 1) {
    const isFirst = i === 0;
    const isLast = i === branches.length - 1;
    formatAndBranch(
      branches[i],
      isFirst ? 'when' : 'or',
      isFirst ? CACL_FORMAT_INDENT : `${CACL_FORMAT_INDENT}  `,
      isLast,
    );
  }

  return lines;
}

interface RuleClause {
  from: number;
  to: number;
  kind: 'scope' | 'to' | 'when' | 'from' | 'until' | 'remark';
  singleText: string;
  node: SyntaxNode;
  extraComments: CommentEntry[];
}

function formatRuleNode(node: SyntaxNode, source: string, policyTrailingComment: string | null): string {
  const directChildren = childrenOf(node);
  const effectNode = node.getChild('Effect');
  const effect = effectNode ? source.slice(effectNode.from, effectNode.to).trim() : 'allow';
  const opSetNode = node.getChild('OpSet');
  const semiNode = directChildren.find((c) => c.name === ';');

  // Extract OpSet items and comments inside OpSet
  const opDirectComments = opSetNode
    ? childrenOf(opSetNode)
        .filter((c) => c.name === 'Comment')
        .map((c) => ({ from: c.from, to: c.to, text: source.slice(c.from, c.to).trimEnd() }))
    : [];
  const rawOpItems = opSetNode
    ? childrenOf(opSetNode)
        .filter((c) => c.name === 'OpItem')
        .map((c) => {
          const parsed = formatOpItem(c, source);
          return { from: c.from, to: c.to, text: parsed.text, innerComments: parsed.comments };
        })
    : [];
  for (const op of rawOpItems) {
    opDirectComments.push(...op.innerComments);
  }
  const opSplit = splitCommentsWithAnchors(rawOpItems, opDirectComments, source);
  const opItemsSingle = `[${rawOpItems.map((item) => item.text).join(', ')}]`;
  const opHasComments = opSplit.tailComments.length > 0
    || opSplit.attached.some((item) => item.standaloneComments.length > 0 || item.trailingComment !== null);

  // Extract clauses after OpSet (excluding Effect, OpSet, ;)
  const clauses: RuleClause[] = [];
  for (const child of directChildren) {
    if (child.name === 'ScopeClause') {
      const scope = child.getChild('Scope');
      const scopeText = scope ? source.slice(scope.from, scope.to).trim() : 'all';
      const innerComments = collectCommentsInSubtree(child, source);
      clauses.push({
        from: child.from,
        to: child.to,
        kind: 'scope',
        singleText: `on ${scopeText}`,
        node: child,
        extraComments: innerComments,
      });
    } else if (child.name === 'MatchClause') {
      const principalList = child.getChild('PrincipalList');
      const boolExpr = child.getChild('BoolExpr');
      if (principalList) {
        const principals = childrenOf(principalList)
          .filter((c) => c.name === 'Principal')
          .map((p) => {
            const parsed = formatPrincipalNode(p, source);
            return { from: p.from, to: p.to, text: parsed.text, innerComments: parsed.comments };
          });
        const directMatchComments = [
          ...childrenOf(child).filter((c) => c.name === 'Comment'),
          ...childrenOf(principalList).filter((c) => c.name === 'Comment'),
        ].map((c) => ({ from: c.from, to: c.to, text: source.slice(c.from, c.to).trimEnd() }));
        for (const p of principals) directMatchComments.push(...p.innerComments);
        clauses.push({
          from: child.from,
          to: child.to,
          kind: 'to',
          singleText: `to ${principals.map((p) => p.text).join(', ')}`,
          node: child,
          extraComments: directMatchComments,
        });
      } else if (boolExpr) {
        const directMatchComments = childrenOf(child)
          .filter((c) => c.name === 'Comment')
          .map((c) => ({ from: c.from, to: c.to, text: source.slice(c.from, c.to).trimEnd() }));
        clauses.push({
          from: child.from,
          to: child.to,
          kind: 'when',
          singleText: `when ${formatBoolExprSingleLine(boolExpr, source)}`,
          node: child,
          extraComments: [...directMatchComments, ...collectCommentsInSubtree(boolExpr, source)],
        });
      }
    } else if (child.name === 'TimeClause') {
      for (const tc of childrenOf(child)) {
        if (tc.name === 'ValidFrom' || tc.name === 'ValidUntil') {
          const kw = tc.name === 'ValidFrom' ? 'from' : 'until';
          const str = tc.getChild('String');
          const strText = str ? source.slice(str.from, str.to).trim() : '""';
          clauses.push({
            from: tc.from,
            to: tc.to,
            kind: kw,
            singleText: `${kw} ${strText}`,
            node: tc,
            extraComments: collectCommentsInSubtree(tc, source),
          });
        } else if (tc.name === 'Comment') {
          // Will be picked up as rule-level comment below
        }
      }
    } else if (child.name === 'RemarkClause') {
      const str = child.getChild('String');
      const strText = str ? source.slice(str.from, str.to).trim() : '""';
      clauses.push({
        from: child.from,
        to: child.to,
        kind: 'remark',
        singleText: `remark ${strText}`,
        node: child,
        extraComments: collectCommentsInSubtree(child, source),
      });
    }
  }

  // Collect rule-level comments (outside OpSet, outside clauses, including inside TimeClause)
  const ruleLevelComments: CommentEntry[] = [];
  for (const child of directChildren) {
    if (child.name === 'Comment') {
      ruleLevelComments.push({
        from: child.from,
        to: child.to,
        text: source.slice(child.from, child.to).trimEnd(),
      });
    } else if (child.name === 'TimeClause') {
      for (const tc of childrenOf(child)) {
        if (tc.name === 'Comment') {
          ruleLevelComments.push({
            from: tc.from,
            to: tc.to,
            text: source.slice(tc.from, tc.to).trimEnd(),
          });
        }
      }
    }
  }
  if (effectNode) {
    ruleLevelComments.push(...collectCommentsInSubtree(effectNode, source));
  }

  // Anchor rule-level comments against [OpSet, ...clauses]
  const anchors = [
    ...(opSetNode ? [{ from: effectNode?.from ?? opSetNode.from, to: opSetNode.to, kind: 'opset' as const }] : []),
    ...clauses,
  ];
  const ruleSplit = splitCommentsWithAnchors(anchors, ruleLevelComments, source);
  const headAnchor = opSetNode ? ruleSplit.attached[0] : null;
  const attachedClauses = opSetNode ? ruleSplit.attached.slice(1) : ruleSplit.attached;

  // Determine if there are any internal comments anywhere in the rule (besides a trailing comment at the very end after ;)
  const hasInternalComments = opHasComments
    || ruleLevelComments.length > 0
    || clauses.some((c) => c.extraComments.length > 0);

  // Single-line candidate when no internal comments exist
  if (!hasInternalComments) {
    const parts = [`${effect} ${opItemsSingle}`, ...clauses.map((c) => c.singleText)];
    const singleBase = `${parts.join(' ')};`;
    const singleFull = policyTrailingComment ? `${singleBase} ${policyTrailingComment}` : singleBase;
    if (singleFull.length <= CACL_FORMAT_MAX_LINE_LENGTH) {
      return singleFull;
    }
  }

  // Multi-line formatting
  const outputLines: string[] = [];
  for (const c of headAnchor?.standaloneComments ?? []) {
    outputLines.push(c);
  }

  // Decide whether ScopeClause stays on line 1 with `effect [ops]`
  let remainingClauses = attachedClauses as Array<(typeof attachedClauses)[number] & RuleClause>;
  const firstClause = remainingClauses[0];
  const headSingle = `${effect} ${opItemsSingle}`;
  const canAttachScopeToHead = !opHasComments
    && !headAnchor?.trailingComment
    && firstClause?.kind === 'scope'
    && firstClause.standaloneComments.length === 0
    && firstClause.extraComments.length === 0;

  let scopeCombinedLine: string | null = null;
  if (canAttachScopeToHead && firstClause) {
    const candidate = `${headSingle} ${firstClause.singleText}`;
    const candidateWithComment = firstClause.trailingComment
      ? `${candidate} ${firstClause.trailingComment}`
      : candidate;
    if (candidateWithComment.length <= CACL_FORMAT_MAX_LINE_LENGTH) {
      scopeCombinedLine = candidateWithComment;
      remainingClauses = remainingClauses.slice(1);
    }
  }

  if (scopeCombinedLine !== null) {
    outputLines.push(scopeCombinedLine);
  } else {
    const headWithComment = headAnchor?.trailingComment
      ? `${headSingle} ${headAnchor.trailingComment}`
      : headSingle;
    if (!opHasComments && headWithComment.length <= CACL_FORMAT_MAX_LINE_LENGTH) {
      outputLines.push(headWithComment);
    } else {
      outputLines.push(
        ...formatOpSetMultiLine(
          effect,
          opSplit.attached,
          opSplit.tailComments,
          headAnchor?.trailingComment ?? null,
        ),
      );
    }
  }

  // Emit continuation clauses
  const hasTailCommentsBeforeSemi = ruleSplit.tailComments.length > 0
    || (semiNode !== undefined && attachedClauses.length === 0 && Boolean(headAnchor?.trailingComment));

  for (let i = 0; i < remainingClauses.length; i += 1) {
    const clause = remainingClauses[i];
    const isLastClause = i === remainingClauses.length - 1;
    const attachSemiHere = isLastClause && ruleSplit.tailComments.length === 0;
    const suffix = attachSemiHere ? ';' : '';
    const trailing = attachSemiHere
      ? (policyTrailingComment ?? clause.trailingComment)
      : clause.trailingComment;

    for (const c of clause.standaloneComments) {
      outputLines.push(`${CACL_FORMAT_INDENT}${c}`);
    }

    if (clause.kind === 'to') {
      const principalList = clause.node.getChild('PrincipalList');
      const principals = principalList
        ? childrenOf(principalList)
            .filter((c) => c.name === 'Principal')
            .map((p) => {
              const parsed = formatPrincipalNode(p, source);
              return { from: p.from, to: p.to, text: parsed.text };
            })
        : [];
      const principalSplit = splitCommentsWithAnchors(principals, clause.extraComments, source);
      const hasPrincipalComments = principalSplit.tailComments.length > 0
        || principalSplit.attached.some((p) => p.standaloneComments.length > 0 || p.trailingComment !== null);

      const simpleLine = `${CACL_FORMAT_INDENT}${clause.singleText}${suffix}`;
      const simpleWithComment = trailing ? `${simpleLine} ${trailing}` : simpleLine;

      if (!hasPrincipalComments && simpleWithComment.length <= CACL_FORMAT_MAX_LINE_LENGTH) {
        outputLines.push(simpleWithComment);
      } else {
        const packed = packCommaItems(
          principalSplit.attached,
          `${CACL_FORMAT_INDENT}to `,
          `${CACL_FORMAT_INDENT}  `,
          principalSplit.tailComments.length > 0 ? '' : suffix,
          CACL_FORMAT_MAX_LINE_LENGTH,
        );
        for (const comment of principalSplit.tailComments) {
          packed.push(`${CACL_FORMAT_INDENT}  ${comment}`);
        }
        if (principalSplit.tailComments.length > 0 && suffix) {
          packed.push(`${CACL_FORMAT_INDENT}  ${suffix}`);
        }
        if (trailing && packed.length > 0 && !packed[packed.length - 1].includes('#')) {
          packed[packed.length - 1] = `${packed[packed.length - 1]} ${trailing}`;
        } else if (trailing) {
          packed.push(`${CACL_FORMAT_INDENT}  ${trailing}`);
        }
        outputLines.push(...packed);
      }
      continue;
    }

    if (clause.kind === 'when') {
      const boolExpr = clause.node.getChild('BoolExpr');
      const simpleLine = `${CACL_FORMAT_INDENT}${clause.singleText}${suffix}`;
      const simpleWithComment = trailing ? `${simpleLine} ${trailing}` : simpleLine;
      if (clause.extraComments.length === 0 && simpleWithComment.length <= CACL_FORMAT_MAX_LINE_LENGTH) {
        outputLines.push(simpleWithComment);
      } else if (boolExpr) {
        outputLines.push(...formatWhenMultiLine(boolExpr, source, suffix, trailing));
      } else {
        outputLines.push(simpleWithComment);
      }
      continue;
    }

    // scope / from / until / remark
    for (const c of clause.extraComments) {
      outputLines.push(`${CACL_FORMAT_INDENT}${c.text}`);
    }
    const line = `${CACL_FORMAT_INDENT}${clause.singleText}${suffix}`;
    outputLines.push(trailing ? `${line} ${trailing}` : line);
  }

  if (hasTailCommentsBeforeSemi) {
    for (const comment of ruleSplit.tailComments) {
      outputLines.push(`${CACL_FORMAT_INDENT}${comment}`);
    }
    outputLines.push(
      policyTrailingComment
        ? `${CACL_FORMAT_INDENT}; ${policyTrailingComment}`
        : `${CACL_FORMAT_INDENT};`,
    );
  } else if (remainingClauses.length === 0) {
    // Edge case: e.g. `allow [OP] on self` with scopeCombinedLine already emitted and no remaining clauses
    const lastIdx = outputLines.length - 1;
    if (outputLines[lastIdx].includes('#')) {
      outputLines.push(
        policyTrailingComment
          ? `${CACL_FORMAT_INDENT}; ${policyTrailingComment}`
          : `${CACL_FORMAT_INDENT};`,
      );
    } else {
      outputLines[lastIdx] = policyTrailingComment
        ? `${outputLines[lastIdx]}; ${policyTrailingComment}`
        : `${outputLines[lastIdx]};`;
    }
  }

  return outputLines.join('\n');
}

/**
 * Format CACL policy source with 88-character line wrapping, keyword-leading
 * 2-space continuation lines, PEP 8 blank-line normalization (preserving up to
 * 2 consecutive blank lines), and full comment preservation.
 */
export function formatCaclSource(source: string): CaclFormatResult {
  if (source.trim().length === 0) {
    return { ok: true, text: '' };
  }

  const tree = parser.parse(source);
  const analysis = analyzeCacl(source);
  const blocking = analysis.diagnostics.find((diag) => diag.code === 'E101' || diag.code === 'E102');
  const syntaxError = findFirstSyntaxError(tree.topNode);
  if (blocking) {
    return { ok: false, error: blocking.message };
  }
  if (syntaxError) {
    return { ok: false, error: `Syntax error near offset ${syntaxError.from}` };
  }

  const topNodes = childrenOf(tree.topNode);
  const blocks: PositionedBlock[] = [];

  for (let i = 0; i < topNodes.length; i += 1) {
    const node = topNodes[i];
    if (node.name !== 'Directive' && node.name !== 'Rule' && node.name !== 'Comment') {
      continue;
    }

    if (node.name === 'Comment') {
      blocks.push({
        from: node.from,
        to: node.to,
        text: source.slice(node.from, node.to).trimEnd(),
      });
      continue;
    }

    // Check if the next top-level node is a trailing inline comment on the same line
    let trailingComment: string | null = null;
    let endOffset = node.to;
    const nextNode = topNodes[i + 1];
    if (nextNode?.name === 'Comment' && !hasNewlineBetween(source, node.to, nextNode.from)) {
      trailingComment = source.slice(nextNode.from, nextNode.to).trimEnd();
      endOffset = nextNode.to;
      i += 1;
    }

    const formatted = node.name === 'Directive'
      ? formatDirectiveNode(node, source, trailingComment)
      : formatRuleNode(node, source, trailingComment);

    blocks.push({
      from: node.from,
      to: endOffset,
      text: formatted,
    });
  }

  if (blocks.length === 0) {
    return { ok: true, text: '' };
  }

  let output = blocks[0].text;
  for (let i = 1; i < blocks.length; i += 1) {
    const blankLines = countBlankLinesBetween(source, blocks[i - 1].to, blocks[i].from);
    output += '\n'.repeat(blankLines + 1) + blocks[i].text;
  }

  return { ok: true, text: `${output}\n` };
}
