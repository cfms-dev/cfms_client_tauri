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

export interface FilePreferenceScope {
  serverAddress: string | null;
  username: string | null;
}

const RECENT_VISITS_KEY_PREFIX = 'cfms.recentVisits.v2';
const MAX_RECENT_VISITS = 10;

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

export function getRecentVisits(scope: FilePreferenceScope): RecentFileRecord[] {
  return getLegacyRecentVisits(scope);
}

export async function loadRecentVisits(scope: FilePreferenceScope): Promise<RecentFileRecord[]> {
  if (!hasFilePreferenceScope(scope)) return [];

  const preferences = await loadUserPreference();
  if (!shouldRecordRecentVisits(preferences)) {
    clearLegacyRecentVisits(scope);
    return [];
  }

  let records = recentRecordsFromPreference(preferences);
  if (records.length === 0) {
    const migrated = getLegacyRecentVisits(scope);
    if (migrated.length > 0) {
      records = migrated;
      await saveUserPreference({
        ...preferences,
        recent_visits: records,
      });
      clearLegacyRecentVisits(scope);
    }
  }
  return records;
}

export async function rememberVisit(
  scope: FilePreferenceScope,
  record: FileRecord,
): Promise<RecentFileRecord[]> {
  assertFilePreferenceScope(scope);

  const preferences = await loadUserPreference();
  if (!shouldRecordRecentVisits(preferences)) {
    clearLegacyRecentVisits(scope);
    return [];
  }

  const existing = recentRecordsFromPreference(preferences);
  const next: RecentFileRecord = {
    ...record,
    parentId: normalizeDirectoryId(record.parentId),
    visitedAt: Date.now(),
  };
  const records = [
    next,
    ...existing.filter((item) => item.type !== record.type || item.id !== record.id),
  ].slice(0, MAX_RECENT_VISITS);

  await saveUserPreference({
    ...preferences,
    recent_visits: records,
  });
  clearLegacyRecentVisits(scope);
  return records;
}

export async function removeRecentVisit(
  scope: FilePreferenceScope,
  record: FileRecord,
): Promise<RecentFileRecord[]> {
  assertFilePreferenceScope(scope);

  const preferences = await loadUserPreference();
  const records = recentRecordsFromPreference(preferences).filter(
    (item) => item.type !== record.type || item.id !== record.id,
  );

  await saveUserPreference({
    ...preferences,
    recent_visits: records,
  });
  clearLegacyRecentVisits(scope);
  return records;
}

export async function clearRecentVisits(scope: FilePreferenceScope): Promise<RecentFileRecord[]> {
  assertFilePreferenceScope(scope);

  const preferences = await loadUserPreference();
  await saveUserPreference({
    ...preferences,
    recent_visits: [],
  });
  clearLegacyRecentVisits(scope);
  return [];
}

function getLegacyRecentVisits(scope: FilePreferenceScope): RecentFileRecord[] {
  if (typeof localStorage === 'undefined') return [];
  const key = recentVisitsKey(scope);
  if (!key) return [];

  try {
    const raw = localStorage.getItem(key);
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

function clearLegacyRecentVisits(scope: FilePreferenceScope) {
  if (typeof localStorage === 'undefined') return;
  const key = recentVisitsKey(scope);
  if (!key) return;
  localStorage.removeItem(key);
}

export async function loadFavoriteRecords(scope: FilePreferenceScope): Promise<FileRecord[]> {
  if (!hasFilePreferenceScope(scope)) return [];
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

export function recentRecordsFromPreference(preferences: UserPreference): RecentFileRecord[] {
  return (preferences.recent_visits ?? [])
    .filter(isRecentFileRecord)
    .map((record) => ({
      ...record,
      parentId: normalizeDirectoryId(record.parentId),
    }))
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, MAX_RECENT_VISITS);
}

export async function setFavoriteRecord(
  scope: FilePreferenceScope,
  record: FileRecord,
  favorite: boolean,
): Promise<UserPreference> {
  assertFilePreferenceScope(scope);
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

export async function clearFavoriteRecords(scope: FilePreferenceScope): Promise<UserPreference> {
  assertFilePreferenceScope(scope);
  const preferences = await loadUserPreference();
  const next: UserPreference = {
    ...preferences,
    favourites: {
      files: {},
      directories: {},
    },
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

export function hasFilePreferenceScope(
  scope: FilePreferenceScope | null | undefined,
): scope is { serverAddress: string; username: string } {
  return Boolean(scopeParts(scope));
}

function assertFilePreferenceScope(scope: FilePreferenceScope) {
  if (!hasFilePreferenceScope(scope)) {
    throw new Error('Missing server address or username for file preferences.');
  }
}

function recentVisitsKey(scope: FilePreferenceScope): string | null {
  const parts = scopeParts(scope);
  if (!parts) return null;
  return `${RECENT_VISITS_KEY_PREFIX}:${encodeURIComponent(parts.serverAddress)}:${encodeURIComponent(parts.username)}`;
}

function scopeParts(scope: FilePreferenceScope | null | undefined) {
  const serverAddress = scope?.serverAddress?.trim();
  const username = scope?.username?.trim();
  if (!serverAddress || !username) return null;
  return { serverAddress, username };
}

function normalizeFavourites(value: Favourites | null | undefined): Favourites {
  return {
    files: { ...(value?.files ?? {}) },
    directories: { ...(value?.directories ?? {}) },
  };
}

export function shouldRecordRecentVisits(preferences: Pick<UserPreference, 'record_recent_visits'> | null | undefined) {
  return preferences?.record_recent_visits !== false;
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
