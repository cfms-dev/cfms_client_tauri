import { cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach } from 'vitest';
import { createMatchMedia, stubMatchMedia } from './dom-fixtures';

// Svelte's MediaQuery subscribes during module evaluation, before test hooks.
// This stable environment shim is the baseline restored by unstubGlobals.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: createMatchMedia() });
}
// Node 25+ exposes an unconfigured global localStorage stub when --localstorage-file is omitted.
if (typeof window.localStorage?.getItem !== 'function') {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(key: string) { return store.get(String(key)) ?? null; },
    key(index: number) { return Array.from(store.keys())[index] ?? null; },
    removeItem(key: string) { store.delete(String(key)); },
    setItem(key: string, value: string) { store.set(String(key), String(value)); },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, writable: true, value: storage });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage });
}

beforeEach(() => {
  if (typeof window.matchMedia !== 'function') stubMatchMedia();
});

afterEach(async () => {
  cleanup();
  await tick();
});
