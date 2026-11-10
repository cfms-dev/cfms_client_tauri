import type { AccessEntityType, AccessType } from '$lib/api';

export const DEFAULT_ACCESS_DURATION_MS = 24 * 60 * 60 * 1000;

export interface AccessGrantFormValue {
  entityIdentifier: string;
  entityType: AccessEntityType;
  accessTypes: AccessType[];
  startTime: number;
  endTime: number;
}

export interface AccessGrantTimeInputs {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

export function createDefaultAccessGrantTimeInputs(now = new Date()): AccessGrantTimeInputs {
  const end = new Date(now.getTime() + DEFAULT_ACCESS_DURATION_MS);

  return {
    startDate: formatDateInput(now),
    startTime: formatTimeInput(now),
    endDate: formatDateInput(end),
    endTime: formatTimeInput(end),
  };
}

export function parseAccessGrantTimestamp(date: string, time: string): number | null {
  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  const value = new Date(`${date}T${normalizedTime}`);
  const timestamp = value.getTime();

  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
}

function formatDateInput(value: Date): string {
  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
  ].join('-');
}

function formatTimeInput(value: Date): string {
  return [pad(value.getHours()), pad(value.getMinutes())].join(':');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
