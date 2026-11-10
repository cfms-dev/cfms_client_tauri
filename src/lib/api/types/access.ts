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
