import { goto } from '$app/navigation';
import {
  executeExtensionHostCall,
  readExtensionWorkflow,
  type DeclarativeWorkflow,
  type ExtensionCapability,
} from '$lib/api/extensions';
import { notificationStore } from '$lib/stores.svelte';

const MAX_STEPS = 100;
const MAX_DURATION_MS = 30_000;

export interface WorkflowRunOptions {
  input?: Record<string, unknown>;
  background?: boolean;
  signal?: AbortSignal;
}

export async function runExtensionWorkflow(
  extensionId: string,
  workflowId: string,
  options: WorkflowRunOptions = {},
): Promise<unknown> {
  const workflow = await readExtensionWorkflow(extensionId, workflowId);
  return runWorkflowDocument(extensionId, workflow, options);
}

async function runWorkflowDocument(
  extensionId: string,
  workflow: DeclarativeWorkflow,
  options: WorkflowRunOptions,
): Promise<unknown> {
  if (workflow.schema_version !== 1 || !workflow.start || !Array.isArray(workflow.nodes)) {
    throw new Error('Unsupported extension workflow schema');
  }
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const context: Record<string, unknown> = { input: options.input ?? {}, results: {} };
  const deadline = Date.now() + MAX_DURATION_MS;
  let current: string | undefined = workflow.start;
  let steps = 0;

  while (current) {
    throwIfCancelled(options.signal);
    if (++steps > MAX_STEPS || Date.now() > deadline) {
      throw new Error('Extension workflow exceeded its execution limit');
    }
    const node = nodes.get(current);
    if (!node) throw new Error(`Extension workflow node ${current} does not exist`);
    const next = typeof node.next === 'string' ? node.next : undefined;

    switch (node.type) {
      case 'host_call': {
        const capability = String(node.capability ?? '') as ExtensionCapability;
        const args = resolveValue(node.arguments ?? {}, context);
        let userConfirmed: boolean | undefined;
        if (capability === 'transfers.download.enqueue') {
          if (options.background) throw new Error('Background workflows cannot enqueue downloads');
          userConfirmed = window.confirm(`Allow extension ${extensionId} to add this download?`);
          if (!userConfirmed) throw new Error('Download request cancelled');
        }
        const result = await withinExecutionLimit(
          executeExtensionHostCall(extensionId, capability, args, userConfirmed),
          deadline,
          options.signal,
        );
        storeResult(context, node.result, result);
        current = next;
        break;
      }
      case 'transform': {
        storeResult(context, node.result, evaluateExpression(node.expression, context));
        current = next;
        break;
      }
      case 'condition': {
        current = truthy(evaluateExpression(node.expression, context))
          ? stringOrUndefined(node.if_true)
          : stringOrUndefined(node.if_false);
        break;
      }
      case 'confirm': {
        if (options.background) throw new Error('Background workflows cannot request confirmation');
        const message = String(resolveValue(node.message ?? 'Continue?', context));
        current = window.confirm(message)
          ? stringOrUndefined(node.if_confirmed) ?? next
          : stringOrUndefined(node.if_cancelled);
        break;
      }
      case 'notify': {
        const message = String(resolveValue(node.message ?? '', context));
        const tone = String(node.tone ?? 'info');
        if (tone === 'success') notificationStore.success(message);
        else if (tone === 'warning') notificationStore.warning(message);
        else if (tone === 'danger' || tone === 'error') notificationStore.error(message);
        else notificationStore.info(message);
        current = next;
        break;
      }
      case 'navigate': {
        if (options.background) throw new Error('Background workflows cannot navigate');
        const target = String(resolveValue(node.to ?? '/home/overview', context));
        if (!target.startsWith('/home/')) throw new Error('Extension navigation must stay inside the home workspace');
        await withinExecutionLimit(goto(target), deadline, options.signal);
        current = next;
        break;
      }
      case 'delay': {
        const milliseconds = Math.min(Math.max(Number(node.milliseconds ?? 0), 0), 5_000);
        await withinExecutionLimit(
          new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
          deadline,
          options.signal,
        );
        current = next;
        break;
      }
      case 'result':
        return resolveValue(node.value ?? null, context);
      default:
        throw new Error(`Unsupported extension workflow node type ${node.type}`);
    }
  }
  return null;
}

function throwIfCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Extension workflow was cancelled');
}

async function withinExecutionLimit<T>(
  operation: Promise<T>,
  deadline: number,
  signal?: AbortSignal,
): Promise<T> {
  throwIfCancelled(signal);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Extension workflow exceeded its execution limit');
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', cancelled);
      callback();
    };
    const cancelled = () => finish(() => reject(new Error('Extension workflow was cancelled')));
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error('Extension workflow exceeded its execution limit'))),
      remaining,
    );
    signal?.addEventListener('abort', cancelled, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function evaluateExpression(expression: unknown, context: Record<string, unknown>): unknown {
  if (expression === null || typeof expression !== 'object' || Array.isArray(expression)) {
    return resolveValue(expression, context);
  }
  const item = expression as Record<string, unknown>;
  const operator = String(item.op ?? 'value');
  const args = Array.isArray(item.args) ? item.args.map((value) => evaluateExpression(value, context)) : [];
  switch (operator) {
    case 'value': return resolveValue(item.value, context);
    case 'eq': return args[0] === args[1];
    case 'neq': return args[0] !== args[1];
    case 'and': return args.every(truthy);
    case 'or': return args.some(truthy);
    case 'not': return !truthy(args[0]);
    case 'gt': return Number(args[0]) > Number(args[1]);
    case 'gte': return Number(args[0]) >= Number(args[1]);
    case 'lt': return Number(args[0]) < Number(args[1]);
    case 'lte': return Number(args[0]) <= Number(args[1]);
    case 'concat': return args.map(String).join('');
    case 'length': return Array.isArray(args[0]) || typeof args[0] === 'string' ? args[0].length : 0;
    default: throw new Error(`Unsupported extension expression operator ${operator}`);
  }
}

function resolveValue(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) return getPath(context, value.slice(1));
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, context)]));
  }
  return value;
}

function getPath(value: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function storeResult(context: Record<string, unknown>, name: unknown, value: unknown) {
  if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) return;
  (context.results as Record<string, unknown>)[name] = value;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function truthy(value: unknown): boolean {
  return Boolean(value);
}
