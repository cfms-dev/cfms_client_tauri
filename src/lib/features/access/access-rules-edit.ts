import { normalizeAccessRules, type AccessRulesRecord } from '$lib/features/access/access-rules';
import { batchRulesTargetKey, type BatchRulesTarget } from '$lib/features/access/batch-access-rules';

/** Ignore JSON formatting and property order when comparing an editor baseline. */
export function accessRulesDraftFingerprint(rules: AccessRulesRecord, inherit: boolean): string {
  return JSON.stringify(canonical({ rules: normalizeAccessRules(rules), inherit }));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

/** Explorer uses folder: keys; the rules API uses directory: keys. */
export function accessRulesTemplateKey(
  targets: BatchRulesTarget[],
  focusedItemKey: string | null,
  contextItemKey: string | null = null,
): string {
  for (const itemKey of [contextItemKey, focusedItemKey]) {
    const key = itemKey?.replace(/^folder:/, 'directory:');
    const target = targets.find((target) => batchRulesTargetKey(target) === key);
    if (target) return batchRulesTargetKey(target);
  }
  return batchRulesTargetKey(targets[0]);
}
