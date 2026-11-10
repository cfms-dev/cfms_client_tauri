import type { JsonValue } from './common';

export type ScheduleTriggerType = 'cron' | 'date' | 'interval';

export interface ScheduleTrigger {
  type: ScheduleTriggerType;
  data: Record<string, JsonValue>;
  timezone: string;
}

export interface ScheduledTaskType {
  name: string;
  contract_version: number;
  required_permission: string;
  payload_schema: Record<string, JsonValue>;
  max_attempts: number;
}

export type ScheduleStatus = 'active' | 'completed' | 'failed' | 'deleted';

export interface Schedule {
  id: string;
  task_name: string;
  task_contract_version: number;
  task_available: boolean;
  payload: Record<string, JsonValue>;
  trigger: ScheduleTrigger;
  enabled: boolean;
  status: ScheduleStatus;
  revision: number;
  next_run_at: number | null;
  active_execution_id: string | null;
  pending_scheduled_for: number | null;
  created_by: string | null;
  created_at: number;
  updated_by: string | null;
  updated_at: number;
}

export interface ScheduleCreateInput {
  taskName: string;
  payload: Record<string, JsonValue>;
  trigger: ScheduleTrigger;
  enabled: boolean;
}

export interface ScheduleUpdateInput {
  id: string;
  revision: number;
  taskName?: string;
  payload?: Record<string, JsonValue>;
  trigger?: ScheduleTrigger;
  enabled?: boolean;
}
