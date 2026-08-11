import { invoke } from '@tauri-apps/api/core';
import type { JsonValue, ServerResponse } from './types';

/** Send an arbitrary authenticated server action for the hidden developer console. */
export async function sendDeveloperRequest(
  action: string,
  payload: JsonValue,
): Promise<ServerResponse<JsonValue>> {
  return invoke('send_developer_request', { action, payload });
}
