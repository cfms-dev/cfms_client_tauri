import { invoke } from '@tauri-apps/api/core';

export interface LocalDataResetFailure {
  target: string;
  message: string;
}

export interface LocalDataResetStatus {
  pending: boolean;
  failures: LocalDataResetFailure[];
}

export async function getLocalDataResetStatus(): Promise<LocalDataResetStatus> {
  return invoke('get_local_data_reset_status');
}

export async function resetLocalData(deleteDownloads = false): Promise<void> {
  return invoke('reset_local_data', { deleteDownloads });
}

export async function retryLocalDataReset(): Promise<LocalDataResetStatus> {
  return invoke('retry_local_data_reset');
}
