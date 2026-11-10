export interface SessionExitActions {
  clearLocalState: () => void;
  clearBackendState: () => Promise<unknown>;
  navigate: () => Promise<unknown>;
}

/**
 * Leave the protected workspace without making navigation wait for native
 * cleanup. Both asynchronous actions are still observed before completion.
 */
export async function transitionOutOfSession(actions: SessionExitActions): Promise<void> {
  actions.clearLocalState();
  await Promise.all([
    actions.clearBackendState(),
    actions.navigate(),
  ]);
}
