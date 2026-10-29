import type { DownloadTaskDto, UploadTaskDto } from './api';
import { serverAvailability, serverErrorMessage } from './api/server-errors';
import { formatUserFacingError } from './user-facing-errors';

/** Shared text for the compact hint and the selectable, expanded task details. */
export function transferFailureReason(
  task: DownloadTaskDto | UploadTaskDto,
  translate: (key: string) => string,
): string | null {
  const needsAttention = task.status === 'failed' || task.status === 'interrupted';
  const error = task.error?.trim();
  const reason = error || ('upload_id' in task && needsAttention ? task.message?.trim() : null);
  if (!reason) return needsAttention ? translate('tasks.errors.noDetails') : null;

  const readable = serverErrorMessage(reason).trim();
  if (!readable) return needsAttention ? translate('tasks.errors.noDetails') : null;
  const formatted = formatUserFacingError(reason);
  // Availability messages summarize the response. Keep the server's actual
  // explanation alongside that summary, without the structured metadata suffix.
  return serverAvailability(reason) && formatted !== readable
    ? `${formatted}\n\n${readable}`
    : formatted;
}
