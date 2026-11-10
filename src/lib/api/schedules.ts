import { invoke } from '@tauri-apps/api/core';
import type { CursorPage } from './types/common';
import type { Schedule, ScheduleCreateInput, ScheduledTaskType, ScheduleUpdateInput } from './types/schedules';

export function listScheduledTaskTypes(): Promise<ScheduledTaskType[]> {
  return invoke('list_scheduled_task_types');
}

export function listSchedules(
  cursor: string | null = null,
  pageSize = 128,
  includeDeleted = false,
): Promise<CursorPage<Schedule>> {
  return invoke('list_schedules', { cursor, pageSize, includeDeleted });
}

export function getSchedule(id: string): Promise<Schedule> {
  return invoke('get_schedule', { id });
}

export function createSchedule(input: ScheduleCreateInput): Promise<Schedule> {
  return invoke('create_schedule', {
    taskName: input.taskName,
    payload: input.payload,
    trigger: input.trigger,
    enabled: input.enabled,
  });
}

export function updateSchedule(input: ScheduleUpdateInput): Promise<Schedule> {
  return invoke('update_schedule', {
    id: input.id,
    revision: input.revision,
    taskName: input.taskName ?? null,
    payload: input.payload ?? null,
    trigger: input.trigger ?? null,
    enabled: input.enabled ?? null,
  });
}

export function deleteSchedule(id: string, revision: number): Promise<boolean> {
  return invoke('delete_schedule', { id, revision });
}
