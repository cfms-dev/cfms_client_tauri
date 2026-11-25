import type { SyntaxNode } from '@lezer/common';
import {
  analyzeCacl,
  ATOMIC_OP_BY_NAME,
  DEFAULT_PRESET_MACROS,
  parseCanonicalUuid,
  parser,
  parseRfc3339UtcUs,
  type CaclAnalysisResult,
  type Effect,
  type Scope,
} from 'codemirror-lang-cacl';

export const DACL_SOURCE_MAX_LENGTH = 65_536;

export interface CaclOpItem {
  name: string;
  subtract: boolean;
}

export interface CaclPrincipalRef {
  kind: 'user' | 'group';
  value: string;
}

export type CaclMatchClause =
  | { kind: 'any' }
  | { kind: 'to'; principals: CaclPrincipalRef[] }
  | { kind: 'when'; expression: string };

export interface CaclVisualRule {
  id: string;
  effect: Effect;
  opItems: CaclOpItem[];
  scope: Scope;
  match: CaclMatchClause;
  validFrom: string | null;
  validUntil: string | null;
  remark: string | null;
}

export interface CaclPolicyDocument {
  inherit: boolean;
  rules: CaclVisualRule[];
  userHints: Record<string, string>;
}

export type CaclModelParseResult =
  | { ok: true; document: CaclPolicyDocument; analysis: CaclAnalysisResult }
  | { ok: false; error: string; analysis: CaclAnalysisResult };

const ESCAPE_MAP: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  n: '\n',
  r: '\r',
  t: '\t',
};

let nextRuleUid = 0;

export function createCaclRuleId(): string {
  nextRuleUid += 1;
  return `cacl-rule-${nextRuleUid}`;
}

export function createDefaultCaclRule(overrides: Partial<CaclVisualRule> = {}): CaclVisualRule {
  return {
    id: createCaclRuleId(),
    effect: 'allow',
    opItems: [{ name: 'PRESET_READ', subtract: false }],
    scope: 'all',
    match: { kind: 'any' },
    validFrom: null,
    validUntil: null,
    remark: null,
    ...overrides,
  };
}

export function escapeCaclString(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  return `"${escaped}"`;
}

export function unescapeCaclStringLiteral(tokenText: string): string {
  if (tokenText.length < 2 || !tokenText.startsWith('"') || !tokenText.endsWith('"')) {
    return tokenText;
  }
  const raw = tokenText.slice(1, -1);
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      const mapped = ESCAPE_MAP[raw[i + 1]];
      out += mapped ?? raw[i + 1];
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
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

/** Extract `user("<uuid>")` -> `@username` hints from annotated CACL text. */
export function extractUserAnnotations(source: string): Record<string, string> {
  const hints: Record<string, string> = {};
  const lines = source.split(/\r?\n/);
  const userPattern = /user\("([0-9a-fA-F-]{36})"\)/g;
  const annotationPattern = /#\s*@([^\s#;]+)/g;

  for (const line of lines) {
    const uuids: string[] = [];
    for (const match of line.matchAll(userPattern)) {
      const canonical = parseCanonicalUuid(match[1]);
      if (canonical) uuids.push(canonical);
    }
    if (uuids.length === 0) continue;

    const tags = [...line.matchAll(annotationPattern)].map((m) => m[1]);
    if (tags.length === 0) continue;

    if (uuids.length === 1) {
      hints[uuids[0]] = tags[0];
    } else if (tags.length === uuids.length) {
      for (let i = 0; i < uuids.length; i += 1) {
        hints[uuids[i]] = tags[i];
      }
    }
  }
  return hints;
}

function parseOpSet(opSetNode: SyntaxNode, source: string): CaclOpItem[] {
  const items: CaclOpItem[] = [];
  for (const itemNode of childrenOf(opSetNode)) {
    if (itemNode.name !== 'OpItem') continue;
    const subNode = itemNode.getChild('OpSub');
    const addNode = itemNode.getChild('OpAdd');
    const subtract = subNode !== null;
    const identWrap = (subNode ?? addNode)?.getChild('OpIdent');
    const identNode = identWrap
      ? identWrap.getChild('PresetMacro')
        ?? identWrap.getChild('AtomicOp')
        ?? identWrap.getChild('UpperIdent')
      : null;
    const name = identNode ? source.slice(identNode.from, identNode.to).trim() : '';
    if (name) {
      items.push({ name, subtract });
    }
  }
  return items;
}

function parseMatchClause(matchNode: SyntaxNode, source: string): CaclMatchClause {
  const principalList = matchNode.getChild('PrincipalList');
  if (principalList) {
    const principals: CaclPrincipalRef[] = [];
    let hasAny = false;
    let hasNonToPrincipal = false;

    for (const principalNode of childrenOf(principalList)) {
      if (principalNode.name !== 'Principal') continue;
      if (principalNode.getChild('AnyPred')) {
        hasAny = true;
        continue;
      }
      if (principalNode.getChild('PermPred')) {
        hasNonToPrincipal = true;
        continue;
      }
      const predNode = principalNode.getChild('PrincipalPred');
      if (!predNode) continue;
      const kindNode = predNode.getChild('PrincipalKind');
      const strNode = predNode.getChild('String');
      const kind = kindNode ? source.slice(kindNode.from, kindNode.to).trim() : '';
      const rawValue = strNode ? unescapeCaclStringLiteral(source.slice(strNode.from, strNode.to)) : '';
      if (kind === 'user') {
        principals.push({ kind: 'user', value: parseCanonicalUuid(rawValue) ?? rawValue });
      } else if (kind === 'group') {
        principals.push({ kind: 'group', value: rawValue });
      }
    }

    if (hasNonToPrincipal) {
      const expr = source.slice(principalList.from, principalList.to).trim();
      return { kind: 'when', expression: expr };
    }
    if (hasAny && principals.length === 0) {
      return { kind: 'any' };
    }
    if (hasAny) {
      return { kind: 'any' };
    }
    return { kind: 'to', principals };
  }

  const boolExpr = matchNode.getChild('BoolExpr');
  if (boolExpr) {
    const rawExpr = source.slice(boolExpr.from, boolExpr.to).trim();
    if (rawExpr === 'any') return { kind: 'any' };
    return { kind: 'when', expression: rawExpr };
  }

  return { kind: 'any' };
}

/**
 * Parse CACL source into a lossless visual policy model when syntax is valid.
 * Blocks switching to Visual mode if syntax errors (`E101`/`E102`/`E201`) exist
 * so user edits in Code view are never silently discarded.
 */
export function parseCaclToModel(source: string): CaclModelParseResult {
  const tree = parser.parse(source);
  const analysis = analyzeCacl(source);
  const blocking = analysis.diagnostics.find((diag) =>
    diag.code === 'E101' || diag.code === 'E102' || diag.code === 'E201');
  if (blocking) {
    return { ok: false, error: blocking.message, analysis };
  }

  let inherit = true;
  const rules: CaclVisualRule[] = [];
  const topChildren = childrenOf(tree.topNode);

  for (const child of topChildren) {
    if (child.name === 'Directive') {
      const stateNode = child.getChild('InheritState');
      if (stateNode) {
        inherit = source.slice(stateNode.from, stateNode.to).trim() === 'on';
      }
      continue;
    }

    if (child.name !== 'Rule') continue;
    const effectNode = child.getChild('Effect');
    const effect: Effect = effectNode && source.slice(effectNode.from, effectNode.to).trim() === 'deny'
      ? 'deny'
      : 'allow';

    const opSetNode = child.getChild('OpSet');
    const opItems = opSetNode ? parseOpSet(opSetNode, source) : [];

    const scopeNode = child.getChild('ScopeClause')?.getChild('Scope');
    const scopeText = scopeNode ? source.slice(scopeNode.from, scopeNode.to).trim() : 'all';
    const scope: Scope = (scopeText === 'self' || scopeText === 'dirs' || scopeText === 'docs' || scopeText === 'all')
      ? scopeText
      : 'all';

    const matchNode = child.getChild('MatchClause');
    const match = matchNode ? parseMatchClause(matchNode, source) : ({ kind: 'any' } as const);

    const timeNode = child.getChild('TimeClause');
    const fromStr = timeNode?.getChild('ValidFrom')?.getChild('String');
    const untilStr = timeNode?.getChild('ValidUntil')?.getChild('String');
    const validFrom = fromStr ? unescapeCaclStringLiteral(source.slice(fromStr.from, fromStr.to)) : null;
    const validUntil = untilStr ? unescapeCaclStringLiteral(source.slice(untilStr.from, untilStr.to)) : null;

    const remarkStr = child.getChild('RemarkClause')?.getChild('String');
    const remark = remarkStr ? unescapeCaclStringLiteral(source.slice(remarkStr.from, remarkStr.to)) : null;

    rules.push({
      id: createCaclRuleId(),
      effect,
      opItems,
      scope,
      match,
      validFrom,
      validUntil,
      remark,
    });
  }

  return {
    ok: true,
    document: {
      inherit,
      rules,
      userHints: extractUserAnnotations(source),
    },
    analysis,
  };
}

export function formatRuleOpSet(opItems: readonly CaclOpItem[]): string {
  if (opItems.length === 0) return '[]';
  const tokens = opItems.map((item) => (item.subtract ? `-${item.name}` : item.name));
  return `[${tokens.join(', ')}]`;
}

export function serializeModelToCacl(
  doc: CaclPolicyDocument,
  options: { annotateUsers?: boolean; userHints?: Readonly<Record<string, string>> } = {},
): string {
  const hints = options.userHints ?? doc.userHints;
  const lines: string[] = [`inherit ${doc.inherit ? 'on' : 'off'};`];

  for (const rule of doc.rules) {
    const parts: string[] = [rule.effect, formatRuleOpSet(rule.opItems)];
    if (rule.scope !== 'all') {
      parts.push(`on ${rule.scope}`);
    }

    const ruleHints: string[] = [];
    if (rule.match.kind === 'any') {
      parts.push('to any');
    } else if (rule.match.kind === 'to') {
      if (rule.match.principals.length === 0) {
        parts.push('to ');
      } else {
        const rendered = rule.match.principals.map((principal) => {
          if (principal.kind === 'user') {
            const label = hints[principal.value];
            if (options.annotateUsers && label) {
              ruleHints.push(`@${label}`);
            }
          }
          return `${principal.kind}(${escapeCaclString(principal.value)})`;
        });
        parts.push(`to ${rendered.join(', ')}`);
      }
    } else {
      parts.push(`when ${rule.match.expression.trim()}`);
    }

    if (rule.validFrom && rule.validFrom.trim()) {
      parts.push(`from ${escapeCaclString(rule.validFrom.trim())}`);
    }
    if (rule.validUntil && rule.validUntil.trim()) {
      parts.push(`until ${escapeCaclString(rule.validUntil.trim())}`);
    }
    if (rule.remark !== null && rule.remark !== '') {
      parts.push(`remark ${escapeCaclString(rule.remark)}`);
    }

    const commentSuffix = options.annotateUsers && ruleHints.length > 0
      ? ` # ${ruleHints.join(', ')}`
      : '';
    lines.push(`${parts.join(' ')};${commentSuffix}`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Normalize a CACL policy draft for dirty-state detection so formatting or `# @user`
 * annotations alone do not mark an unchanged policy as dirty.
 */
export function caclDraftFingerprint(source: string): string {
  const parsed = parseCaclToModel(source);
  if (!parsed.ok) {
    return `raw:${source.trim()}`;
  }
  return serializeModelToCacl(parsed.document, { annotateUsers: false });
}

/** Update or insert the `inherit on/off;` directive in raw CACL source without disturbing rules. */
export function setInheritDirectiveInSource(source: string, inherit: boolean): string {
  const targetDirective = `inherit ${inherit ? 'on' : 'off'};`;
  const tree = parser.parse(source);
  const firstDirective = childrenOf(tree.topNode).find((c) => c.name === 'Directive');
  if (firstDirective) {
    return `${source.slice(0, firstDirective.from)}${targetDirective}${source.slice(firstDirective.to)}`;
  }
  const trimmed = source.trimStart();
  return trimmed ? `${targetDirective}\n${trimmed}` : `${targetDirective}\n`;
}

export function computeRuleEffectiveMask(opItems: readonly CaclOpItem[]): number {
  let mask = 0;
  for (const item of opItems) {
    const meta = ATOMIC_OP_BY_NAME.get(item.name);
    const bit = meta ? meta.bit : (DEFAULT_PRESET_MACROS[item.name] ?? 0);
    if (bit === 0) continue;
    if (item.subtract) {
      mask &= ~bit;
    } else {
      mask |= bit;
    }
  }
  return mask;
}

export function isOpCoveredByAdditiveItems(opItems: readonly CaclOpItem[], opName: string): boolean {
  const targetMeta = ATOMIC_OP_BY_NAME.get(opName);
  if (!targetMeta) return false;
  return opItems.some((item) => {
    if (item.subtract) return false;
    const macroMask = DEFAULT_PRESET_MACROS[item.name];
    return typeof macroMask === 'number' && (macroMask & targetMeta.bit) !== 0;
  });
}

/**
 * Toggle an atomic operation within a rule's `opItems` list while preserving macros
 * via `-OP` exclusions whenever the operation is covered by an active preset macro.
 */
export function toggleAtomicOpOnItems(
  opItems: readonly CaclOpItem[],
  opName: string,
): CaclOpItem[] {
  const meta = ATOMIC_OP_BY_NAME.get(opName);
  if (!meta) return [...opItems];

  const effectiveMask = computeRuleEffectiveMask(opItems);
  const isCurrentlyActive = (effectiveMask & meta.bit) !== 0;
  const coveredByMacro = isOpCoveredByAdditiveItems(opItems, opName);
  const next = opItems.filter((item) => item.name !== opName);

  if (isCurrentlyActive) {
    if (coveredByMacro) {
      next.push({ name: opName, subtract: true });
    }
    return next;
  }

  if (!coveredByMacro) {
    return [{ name: opName, subtract: false }, ...next];
  }
  return next;
}

/** Toggle a preset macro on/off and prune redundant explicit atomic entries now implied by the macro. */
export function togglePresetMacroOnItems(
  opItems: readonly CaclOpItem[],
  macroName: string,
): CaclOpItem[] {
  const macroMask = DEFAULT_PRESET_MACROS[macroName] ?? 0;
  if (macroMask === 0) return [...opItems];

  const exists = opItems.some((item) => !item.subtract && item.name === macroName);
  if (exists) {
    return opItems.filter((item) => {
      if (item.name === macroName) return false;
      if (item.subtract) {
        const meta = ATOMIC_OP_BY_NAME.get(item.name);
        if (meta && (macroMask & meta.bit) !== 0) return false;
      }
      return true;
    });
  }

  const pruned = opItems.filter((item) => {
    if (item.subtract) return true;
    const meta = ATOMIC_OP_BY_NAME.get(item.name);
    if (meta && (macroMask & meta.bit) !== 0) return false;
    return true;
  });
  return [{ name: macroName, subtract: false }, ...pruned];
}

/** Convert an RFC 3339 timestamp string into local `YYYY-MM-DDTHH:mm:ss` for `<input type="datetime-local">`. */
export function rfc3339ToLocalInput(rfc3339: string | null | undefined): string {
  if (!rfc3339) return '';
  const us = parseRfc3339UtcUs(rfc3339);
  if (us === null) return '';
  const ms = Number(us / 1000n);
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Convert a local `datetime-local` input value into a canonical UTC RFC 3339 timestamp (`...Z`). */
export function localInputToRfc3339Utc(localValue: string): string | null {
  const trimmed = localValue.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function addDurationRfc3339Utc(baseIso: string | null, deltaSeconds: number, nowMs = Date.now()): string {
  let baseMs = nowMs;
  if (baseIso) {
    const parsed = parseRfc3339UtcUs(baseIso);
    if (parsed !== null) baseMs = Number(parsed / 1000n);
  }
  const target = new Date(baseMs + deltaSeconds * 1000);
  return target.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export type RuleTimeWindowState = 'none' | 'active' | 'scheduled' | 'expired' | 'invalid';

export function ruleTimeWindowState(
  validFrom: string | null,
  validUntil: string | null,
  nowMs = Date.now(),
): RuleTimeWindowState {
  if (!validFrom && !validUntil) return 'none';
  const fromUs = validFrom ? parseRfc3339UtcUs(validFrom) : null;
  const untilUs = validUntil ? parseRfc3339UtcUs(validUntil) : null;
  if ((validFrom && fromUs === null) || (validUntil && untilUs === null)) return 'invalid';
  if (fromUs !== null && untilUs !== null && fromUs >= untilUs) return 'invalid';
  const nowUs = BigInt(Math.floor(nowMs)) * 1000n;
  if (untilUs !== null && nowUs >= untilUs) return 'expired';
  if (fromUs !== null && nowUs < fromUs) return 'scheduled';
  return 'active';
}
