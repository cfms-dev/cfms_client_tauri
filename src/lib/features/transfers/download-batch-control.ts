/** Read-only mirror of native download producer state. */
import { writable } from 'svelte/store';
import { getDownloadBatches, type DownloadBatchSnapshot } from '#lib/api.ts';
export type { DownloadBatchSnapshot } from '#lib/api.ts';
export const downloadBatchSnapshots = writable<DownloadBatchSnapshot[]>([]);
let generation = 0;
export async function refreshDownloadBatches() {
  const run = ++generation;
  try {
    const snapshots = await getDownloadBatches();
    if (run === generation) downloadBatchSnapshots.set(snapshots.filter(batch => !batch.finished));
  } catch (error) {
    if (run === generation) throw error;
  }
}
export function resetDownloadBatches() { generation += 1; downloadBatchSnapshots.set([]); }
