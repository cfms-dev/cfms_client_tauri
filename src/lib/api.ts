// CFMS Client - stable typed Tauri IPC bridge.
//
// The implementation is split by domain under src/lib/api/. Keep this file
// as the public barrel so existing $lib/api imports remain stable.

export type * from './api/types';
export * from './api/core';
export * from './api/auth';
export * from './api/downloads';
export * from './api/files';
export * from './api/trash';
export * from './api/admin';
export * from './api/settings';
export * from './api/mobile';
export * from './api/avatars';
export * from './api/preferences';
export * from './api/server-errors';
export * from './api/extensions';
