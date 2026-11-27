export interface ServerCaclSpan {
  line: number;
  column: number;
  end_line: number;
  end_column: number;
}

export interface ServerCaclDiagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  span?: ServerCaclSpan;
  hint?: string;
}

export interface NodeDaclResponse {
  dacl: string;
  inherit: boolean;
  fingerprint: string;
  annotated_dacl?: string;
  effective_mask?: number;
}

export interface SetNodeDaclResponse {
  dacl: string;
  inherit: boolean;
  fingerprint: string;
  diagnostics: ServerCaclDiagnostic[];
  self_lockout_warning: boolean;
  effective_mask?: number;
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
  effectiveMask?: number;
}

export type BatchRulesProblemKind = 'identity' | 'session' | 'permission' | 'disconnected'
  | 'lockdown' | 'temporary' | 'denied' | 'missing' | 'rejected' | 'unconfirmed'
  | 'invalid_response' | 'cycle' | 'cursor' | 'stopped' | 'self_lockout' | 'invalid_policy';

export interface BatchRulesProblem {
  kind: BatchRulesProblemKind;
  status?: number;
  error?: unknown;
  diagnostics?: ServerCaclDiagnostic[];
}

export interface BatchRulesIdentity {
  server: string | null;
  userId: string | null;
}

export interface BatchRulesSession extends BatchRulesIdentity {
  loggedIn: boolean;
  connected: boolean;
  lockdown: boolean;
  bypassLockdown: boolean;
}

export type BatchRulesItemStatus = 'pending' | 'success' | 'failed' | 'unconfirmed';
export type BatchRulesFailureAction = 'retry' | 'skip' | 'skip_all' | 'cancel' | 'allow_lockout' | 'allow_lockout_all';
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
