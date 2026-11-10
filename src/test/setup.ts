import { afterEach, vi } from 'vitest';

// Run after file-local teardown (Vitest's default stack hook ordering).
// Resource ownership assertions belong in the test, before this restoration.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
