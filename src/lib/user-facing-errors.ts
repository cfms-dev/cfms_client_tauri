import { get } from 'svelte/store';
import { _ as t } from 'svelte-i18n';
import { serverAvailability, serverErrorMessage } from '$lib/api/server-errors';

/** Format a server error for UI display using the active application locale. */
export function formatUserFacingError(error: unknown): string {
  const availability = serverAvailability(error);
  if (!availability) return serverErrorMessage(error);

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
