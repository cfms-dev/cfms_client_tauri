let activeController: AbortController | null = null;
let paused = false;
let resumeWaiters = new Set<() => void>();

export function beginDownloadBatch() {
  activeController?.abort();
  activeController = new AbortController();
  return activeController;
}

export function finishDownloadBatch(controller: AbortController) {
  if (activeController === controller) {
    activeController = null;
  }
}

export function stopActiveDownloadBatch() {
  activeController?.abort();
}

export function pauseActiveDownloadBatches() {
  paused = true;
}

export function resumeActiveDownloadBatches() {
  if (!paused) return;
  paused = false;
  const waiters = resumeWaiters;
  resumeWaiters = new Set();
  for (const resolve of waiters) resolve();
}

export function throwIfDownloadBatchStopped(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException('Folder download queueing stopped.', 'AbortError');
  }
}

export async function waitForDownloadBatchResume(signal: AbortSignal) {
  while (paused) {
    throwIfDownloadBatchStopped(signal);
    await new Promise<void>((resolve, reject) => {
      const resume = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        resumeWaiters.delete(resume);
        reject(new DOMException('Folder download queueing stopped.', 'AbortError'));
      };

      signal.addEventListener('abort', abort, { once: true });
      resumeWaiters.add(resume);
    });
  }
  throwIfDownloadBatchStopped(signal);
}

export function isDownloadBatchStop(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
