import type { ServerObjectType } from './files';

export type AccessEntityType = "user" | "group";

export type AccessType = "read" | "write" | "move" | "manage";

export interface AccessEntry {
  id: number;
  entity_type: AccessEntityType | string;
  entity_identifier: string;
  target_type: ServerObjectType | string;
  target_identifier: string;
  access_type: AccessType | string;
  start_time: number | null;
  end_time: number | null;
}

export interface PermissionEntry {
  permission: string;
  granted: boolean;
  start_time: number;
  end_time: number | null;
}

export interface BatchRulesTarget {
  objectType: import('./files').ServerObjectType;
  objectId: string;
  name: string;
  path?: string;
}

export type BatchRulesProblemKind = 'identity' | 'session' | 'permission' | 'disconnected'
  | 'lockdown' | 'temporary' | 'denied' | 'missing' | 'rejected' | 'unconfirmed'
  | 'invalid_response' | 'cycle' | 'cursor' | 'stopped';

export interface BatchRulesProblem {
  kind: BatchRulesProblemKind;
  status?: number;
  error?: unknown;
}

export interface BatchRulesIdentity {
  server: string | null;
  userId: string | null;
}

export interface BatchRulesSession extends BatchRulesIdentity {
  loggedIn: boolean;
  permitted: boolean;
  connected: boolean;
  lockdown: boolean;
  bypassLockdown: boolean;
}

export type BatchRulesItemStatus = 'pending' | 'success' | 'failed' | 'unconfirmed';
export type BatchRulesFailureAction = 'retry' | 'skip' | 'skip_all' | 'cancel';
export interface BatchRulesItemResult {
  target: BatchRulesTarget;
  status: BatchRulesItemStatus;
  problem?: BatchRulesProblem;
  skipped?: boolean;
}
export interface BatchRulesScanIssue {
  target: BatchRulesTarget;
  problem: BatchRulesProblem;
}

export interface BatchRulesSnapshot {
  phase: 'idle' | 'scanning' | 'ready' | 'running' | 'waiting' | 'deciding' | 'paused' | 'stopped' | 'finished';
  operation: 'scan' | 'apply';
  targets: BatchRulesTarget[];
  results: BatchRulesItemResult[];
  scanIssues: BatchRulesScanIssue[];
  scanComplete: boolean;
  started: boolean;
  runCompleted: number;
  runTotal: number;
  activeKey: string | null;
  waitingUntil: number | null;
  retryAt: number;
  stopRequested: boolean;
  stopReason: BatchRulesProblem | null;
}

export interface NativeBatchRulesSnapshot extends Omit<BatchRulesSnapshot, 'targets' | 'results'> {
  targetCount: number; revision: number;
  decision: { ticket: number; target: BatchRulesTarget; problem: BatchRulesProblem } | null;
}
export interface BatchRulesItemChange { index: number; revision: number; item: BatchRulesItemResult }
