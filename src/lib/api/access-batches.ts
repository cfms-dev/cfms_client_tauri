import { invoke } from '@tauri-apps/api/core';
import type { BatchRulesTarget, BatchRulesProblem, NativeBatchRulesSnapshot, BatchRulesItemChange } from './types/access';
export function prepareAccessBatch(targets: BatchRulesTarget[], rules: unknown, inherit: boolean, recursive: boolean): Promise<string> { return invoke('prepare_access_batch', { targets, rules, inherit, recursive }); }
export function getAccessBatch(id: string): Promise<NativeBatchRulesSnapshot> { return invoke('get_access_batch', { id }); }
export function getAccessBatchChanges(id: string, after: number): Promise<BatchRulesItemChange[]> { return invoke('get_access_batch_changes', { id, after }); }
export function runAccessBatch(id: string, command: string, allowIncomplete = false): Promise<void> { return invoke('run_access_batch', { id, command, allowIncomplete }); }
export function stopAccessBatch(id: string, reason?: BatchRulesProblem): Promise<void> { return invoke('stop_access_batch', { id, reason: reason ?? null }); }
export function disposeAccessBatch(id: string): Promise<void> { return invoke('dispose_access_batch', { id }); }
export function decideAccessBatch(id: string, ticket: number, answer: string): Promise<void> { return invoke('decide_access_batch', { id, ticket, answer }); }
