import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { Extension, Text } from '@codemirror/state';
import {
  analyzeTree,
  toCodeMirrorDiagnostics,
  type ObjectType,
} from 'codemirror-lang-cacl';
import type { ServerCaclDiagnostic } from '$lib/api/types';
import { KNOWN_GLOBAL_PERMISSIONS } from './permission-entries';

export interface CaclPrincipalDirectory {
  users: ReadonlyArray<{
    user_id: string;
    username: string;
    nickname?: string | null;
  }>;
  groups: ReadonlyArray<{
    name: string;
    display_name?: string | null;
  }>;
}

/**
 * Context-aware dynamic completions inside `user("...")`, `group("...")`,
 * and `perm("...")` string literals backed by live directory snapshots.
 */
export function createDynamicCaclCompletionSource(
  getDirectory: () => CaclPrincipalDirectory,
) {
  return (context: CompletionContext): CompletionResult | null => {
    const tree = syntaxTree(context.state);
    const node = tree.resolveInner(context.pos, -1);
    if (node.name !== 'String') return null;

    const parent = node.parent;
    if (!parent || (parent.name !== 'PrincipalPred' && parent.name !== 'PermPred')) {
      return null;
    }

    const kindNode = parent.getChild('PrincipalKind') ?? parent.getChild('PermKind');
    if (!kindNode) return null;
    const kind = context.state.sliceDoc(kindNode.from, kindNode.to);
    const innerFrom = node.from + 1;
    const innerTo = Math.max(innerFrom, node.to - (context.state.sliceDoc(node.to - 1, node.to) === '"' ? 1 : 0));
    if (context.pos < innerFrom || context.pos > innerTo) return null;

    const typed = context.state.sliceDoc(innerFrom, context.pos).toLowerCase();
    const directory = getDirectory();

    let options: Completion[] = [];
    if (kind === 'user') {
      options = directory.users
        .filter((u) =>
          !typed
          || u.username.toLowerCase().includes(typed)
          || (u.nickname ?? '').toLowerCase().includes(typed)
          || u.user_id.toLowerCase().includes(typed))
        .map((u) => ({
          label: u.nickname ? `${u.username} (${u.nickname})` : u.username,
          detail: u.user_id,
          type: 'variable',
          apply: u.user_id,
          boost: u.username.toLowerCase().startsWith(typed) ? 2 : 0,
        }));
    } else if (kind === 'group') {
      options = directory.groups
        .filter((g) =>
          !typed
          || g.name.toLowerCase().includes(typed)
          || (g.display_name ?? '').toLowerCase().includes(typed))
        .map((g) => ({
          label: g.name,
          detail: g.display_name ?? undefined,
          type: 'type',
          apply: g.name,
        }));
    } else if (kind === 'perm') {
      options = KNOWN_GLOBAL_PERMISSIONS
        .filter((perm) => !typed || perm.includes(typed))
        .map((perm) => ({
          label: perm,
          type: 'constant',
          apply: perm,
        }));
    }

    if (options.length === 0) return null;
    return {
      from: innerFrom,
      to: innerTo,
      options,
      filter: false,
    };
  };
}

export function serverSpanToOffsets(
  doc: Text,
  span?: ServerCaclDiagnostic['span'],
): { from: number; to: number } {
  if (!span || doc.length === 0) {
    return { from: 0, to: Math.min(1, doc.length) };
  }
  const clampedStartLine = Math.max(1, Math.min(doc.lines, span.line));
  const clampedEndLine = Math.max(clampedStartLine, Math.min(doc.lines, span.end_line));
  const startLineObj = doc.line(clampedStartLine);
  const endLineObj = doc.line(clampedEndLine);
  const from = Math.min(startLineObj.to, startLineObj.from + Math.max(0, span.column - 1));
  const rawTo = Math.min(endLineObj.to, endLineObj.from + Math.max(0, span.end_column - 1));
  const to = rawTo > from ? rawTo : Math.min(doc.length, from + 1);
  return { from, to };
}

export function mapServerDiagnosticsToCm(
  doc: Text,
  serverDiagnostics: readonly ServerCaclDiagnostic[],
): Diagnostic[] {
  return serverDiagnostics.map((diag) => {
    const { from, to } = serverSpanToOffsets(doc, diag.span);
    return {
      from,
      to,
      severity: diag.severity,
      source: 'cacl-server',
      message: diag.hint ? `[${diag.code}] ${diag.message}\n${diag.hint}` : `[${diag.code}] ${diag.message}`,
    };
  });
}

export function createUnifiedCaclLinter(options: {
  targetObjectType?: ObjectType | null;
  getServerDiagnostics: () => readonly ServerCaclDiagnostic[];
  enableQuickFixes?: boolean;
  delay?: number;
}): Extension {
  return linter(
    (view) => {
      const source = view.state.doc.toString();
      const tree = syntaxTree(view.state);
      const analysis = analyzeTree(tree, source, {
        targetObjectType: options.targetObjectType ?? null,
        includeWarnings: true,
      });
      const clientDiags = toCodeMirrorDiagnostics(source, analysis, {
        targetObjectType: options.targetObjectType ?? null,
        enableQuickFixes: options.enableQuickFixes ?? true,
      });
      const serverDiags = mapServerDiagnosticsToCm(view.state.doc, options.getServerDiagnostics());
      return [...clientDiags, ...serverDiags];
    },
    { delay: options.delay ?? 220 },
  );
}
