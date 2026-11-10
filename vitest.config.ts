import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    allowOnly: !process.env.CI,
    retry: 0,
    isolate: true,
    setupFiles: ['src/test/setup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.dom.test.ts', 'src/**/*.svelte.test.ts'],
        },
      },
      {
        extends: true,
        resolve: { conditions: ['browser'] },
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/**/*.dom.test.ts', 'src/**/*.svelte.test.ts'],
          setupFiles: ['src/test/fluent-dom.ts', 'src/test/dom-setup.ts'],
        },
      },
    ],
  },
});
