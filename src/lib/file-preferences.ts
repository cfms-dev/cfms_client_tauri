import {
  loadUserPreference,
  saveUserPreference,
  type Favourites,
  type ServerDirectoryEntry,
  type ServerDocumentEntry,
  type ServerObjectType,
  type UserPreference,
} from '$lib/api';
import { normalizeDirectoryId } from '$lib/file-browser';

export type FileRecordType = ServerObjectType;

export interface FileRecord {
  type: FileRecordType;
  id: string;
  name: string;
  parentId?: string | null;
  visitedAt?: number;
}

export interface RecentFileRecord extends FileRecord {
  visitedAt: number;
}

const RECENT_VISITS_KEY = 'cfms.recentVisits';
const MAX_RECENT_VISITS = 12;

export function documentToRecord(
  document: Pick<ServerDocumentEntry, 'id' | 'title'>,
  parentId?: string | null,
): FileRecord {
  return {
    type: 'document',
    id: document.id,
    name: document.title,
    parentId: normalizeDirectoryId(parentId),
  };
}

export function directoryToRecord(
  directory: Pick<ServerDirectoryEntry, 'id' | 'name'>,
  parentId?: string | null,
): FileRecord {
  return {
    type: 'directory',
    id: directory.id,
    name: directory.name,
    parentId: normalizeDirectoryId(parentId),
  };
}

export function getRecentVisits(): RecentFileRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_VISITS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecentFileRecord)
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, MAX_RECENT_VISITS);
  } catch {
    return [];
  }
}

export function rememberVisit(record: FileRecord): RecentFileRecord[] {
  if (typeof localStorage === 'undefined') return [];

  const next: RecentFileRecord = {
    ...record,
    parentId: normalizeDirectoryId(record.parentId),
    visitedAt: Date.now(),
  };
  const records = [
    next,
    ...getRecentVisits().filter((item) => item.type !== record.type || item.id !== record.id),
  ].slice(0, MAX_RECENT_VISITS);

  localStorage.setItem(RECENT_VISITS_KEY, JSON.stringify(records));
  return records;
}

export async function loadFavoriteRecords(): Promise<FileRecord[]> {
  const preferences = await loadUserPreference();
  return favoriteRecordsFromPreference(preferences);
}

export function favoriteRecordsFromPreference(preferences: UserPreference): FileRecord[] {
  const favourites = normalizeFavourites(preferences.favourites);
  return [
    ...Object.entries(favourites.directories).map(([id, name]) => ({
      type: 'directory' as const,
      id,
      name,
    })),
    ...Object.entries(favourites.files).map(([id, name]) => ({
      type: 'document' as const,
      id,
      name,
    })),
  ];
}

export async function setFavoriteRecord(record: FileRecord, favorite: boolean): Promise<UserPreference> {
  const preferences = await loadUserPreference();
  const favourites = normalizeFavourites(preferences.favourites);
  const target = record.type === 'directory' ? favourites.directories : favourites.files;

  if (favorite) {
    target[record.id] = record.name;
  } else {
    delete target[record.id];
  }

  const next: UserPreference = {
    ...preferences,
    favourites,
  };
  await saveUserPreference(next);
  return next;
}

export function isFavoriteRecord(preferences: UserPreference | null, record: FileRecord): boolean {
  if (!preferences) return false;
  const favourites = normalizeFavourites(preferences.favourites);
  return record.type === 'directory'
    ? Object.hasOwn(favourites.directories, record.id)
    : Object.hasOwn(favourites.files, record.id);
}

function normalizeFavourites(value: Favourites | null | undefined): Favourites {
  return {
    files: { ...(value?.files ?? {}) },
    directories: { ...(value?.directories ?? {}) },
  };
}

function isRecentFileRecord(value: unknown): value is RecentFileRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RecentFileRecord>;
  return (
    (item.type === 'document' || item.type === 'directory')
    && typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.visitedAt === 'number'
  );
}
