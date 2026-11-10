import { cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach } from 'vitest';
import { createMatchMedia, stubMatchMedia } from './dom-fixtures';

// Svelte's MediaQuery subscribes during module evaluation, before test hooks.
// This stable environment shim is the baseline restored by unstubGlobals.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: createMatchMedia() });
}

beforeEach(() => {
  if (typeof window.matchMedia !== 'function') stubMatchMedia();
});

afterEach(async () => {
  cleanup();
  await tick();
});
