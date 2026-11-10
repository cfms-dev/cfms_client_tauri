import { refreshDownloadBatches, resetDownloadBatches } from '$lib/features/transfers/download-batch-control';
import { appLockStore } from '$lib/features/settings/app-lock.svelte';
/** Application-owned native subscriptions; business handlers own state updates. */
import { listen, type UnlistenFn } from '$lib/shared/platform/native-events';
import type { ServiceEvent, UploadTaskDto, TransferDirection } from '$lib/api/types';
import { handleTransferEvent, handleUploadTask, handleRemovedRecords } from '$lib/features/transfers/events';
import { handleConnectionEvent } from '$lib/features/connection/events';
import { handleAuthenticationEvent } from '$lib/features/authentication/events';
import { handleFileEvent } from '$lib/features/files/events';

let subscriptions: UnlistenFn[] = [];
let initialization: Promise<void> | null = null;
let generation = 0;

export function initEventListeners(): Promise<void> {
  if (initialization) return initialization;
  const current = ++generation;
  async function install() {
    const registrations = [
      () => listen<ServiceEvent>('cfms:event', ({ payload }) => {
        if (payload.event === 'AppLockChanged') void appLockStore.refresh().catch(() => {});
        handleTransferEvent(payload);
        handleConnectionEvent(payload);
        handleAuthenticationEvent(payload);
        handleFileEvent(payload);
      }),
      () => listen<UploadTaskDto>('cfms:upload-task', ({ payload }) => handleUploadTask(payload)),
      () => listen<{ direction: TransferDirection; ids: string[] }>('cfms:transfer-records-removed', ({ payload }) => handleRemovedRecords(payload)),
    ];
    for (const register of registrations) {
      const unlisten = await register();
      if (current !== generation) { unlisten(); return; }
      subscriptions.push(unlisten);
    }
  }
  initialization = install().then(() => { if (current === generation) void refreshDownloadBatches().catch(() => {}); }).catch((error) => {
    if (current === generation) stopEventListeners();
    throw error;
  });
  return initialization;
}

export function stopEventListeners(): void {
  resetDownloadBatches();
  generation += 1;
  for (const unlisten of subscriptions) unlisten();
  subscriptions = [];
  initialization = null;
}
