import { get } from 'svelte/store';
import { _ as t } from 'svelte-i18n';
import { serverAvailability, serverErrorMessage } from '$lib/api/server-errors';

const transferErrors: Record<string, string> = {
  'Upload was interrupted when the application closed': 'tasks.errors.previousSessionIncomplete',
  'Upload did not finish in the previous session': 'tasks.errors.previousSessionIncomplete',
  'Cancellation was not confirmed within 10 seconds. The record was kept; try again.': 'tasks.errors.stopTimeout',
  'Transfer is still stopping. Its record was kept; try again.': 'tasks.errors.stillStopping',
  'Previous upload execution has not stopped yet': 'tasks.errors.stillStopping',
  'Folder queueing did not stop within 10 seconds. Try again.': 'tasks.errors.queueStopTimeout',
  'Action is not available for this task': 'tasks.errors.actionUnavailable',
  'Upload source is unavailable': 'tasks.errors.sourceUnavailable',
  'Upload source is unavailable or the task cannot be restarted': 'tasks.errors.sourceUnavailable',
};

/** Format a server error for UI display using the active application locale. */
export function formatUserFacingError(error: unknown): string {
  const message = serverErrorMessage(error);
  const transferKey = transferErrors[message];
  if (transferKey) return get(t)(transferKey);
  const availability = serverAvailability(error);
  if (!availability) return message;

  const translate = get(t);
  if (availability.kind === 'rate_limited') {
    return availability.retryAfterSeconds === null
      ? translate('common.tooManyRequests')
      : translate('common.tooManyRequestsRetry', {
          values: { seconds: availability.retryAfterSeconds },
        });
  }

  return availability.retryAfterSeconds === null
    ? translate('common.serverBusy')
    : translate('common.serverBusyRetry', {
        values: { seconds: availability.retryAfterSeconds },
      });
}
