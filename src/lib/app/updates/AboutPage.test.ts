// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '$lib/shared/i18n';
import type { UpdateCheckPause } from '$lib/features/updates/update-check-pause';
import AboutPage from '$lib/app/updates/AboutPage.svelte';

const mocks = vi.hoisted(() => ({
  loadAppVersion: vi.fn(),
  protocolVersion: vi.fn(),
  initializeHighlights: vi.fn(async () => {}),
  hasAvailableHighlights: vi.fn(() => false),
  appUpdateState: {
    channel: 'stable',
    automaticCheckPause: { mode: 'active' } as UpdateCheckPause,
    isAutomaticCheckPaused: false,
    automaticCheckSettled: false,
    checked: false,
    checking: false,
    update: null,
    error: null,
    installing: false,
    installed: false,
    installError: null,
    progress: {
      phase: 'idle',
      downloadedBytes: 0,
      totalBytes: null,
      progress: null,
    },
    ensureChannel: vi.fn(async () => 'stable'),
    ensureAutomaticCheckPause: vi.fn(async () => ({ mode: 'active' } as const)),
    check: vi.fn(async () => null),
    install: vi.fn(async () => {}),
  },
}));

vi.mock('$lib/features/updates/app-info', () => ({ loadAppVersion: mocks.loadAppVersion }));
vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  protocolVersion: mocks.protocolVersion,
}));
vi.mock('$lib/features/updates/app-update-state.svelte.ts', () => ({ appUpdateState: mocks.appUpdateState }));
vi.mock('$lib/features/updates/release-highlights-state.svelte.ts', () => ({
  releaseHighlightsState: {
    initialize: mocks.initializeHighlights,
    hasAvailableHighlights: mocks.hasAvailableHighlights,
    openManually: vi.fn(),
  },
}));

beforeEach(() => {
  locale.set('en');
  mocks.loadAppVersion.mockReset();
  mocks.protocolVersion.mockReset();
  mocks.initializeHighlights.mockClear();
  mocks.hasAvailableHighlights.mockClear();
  mocks.appUpdateState.ensureChannel.mockClear();
  mocks.loadAppVersion.mockResolvedValue('0.46.1');
  mocks.protocolVersion.mockResolvedValue(24);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('about page', () => {
  it('renders the product identity and passes one shared version read to update context', async () => {
    const { container } = render(AboutPage);

    expect(screen.getByRole('heading', { level: 2, name: 'CFMS Client' })).toBeTruthy();
    expect(screen.getByText('Confidential File Management System')).toBeTruthy();

    await waitFor(() => expect(screen.getByText('0.46.1')).toBeTruthy());
    expect(screen.getByText('Current version')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('Apache License 2.0')).toBeTruthy();
    expect(screen.getByText('© 2025–2026 Creeper Team')).toBeTruthy();
    expect(container.querySelector('.product-heading')).toBeTruthy();
    expect(container.querySelector('.product-meta')).toBeNull();
    expect(container.querySelector('.app-mark')).toBeNull();
    expect(mocks.loadAppVersion).toHaveBeenCalledOnce();
    expect(mocks.protocolVersion).toHaveBeenCalledOnce();
  });

  it('exposes loading semantics while product metadata is pending', () => {
    mocks.loadAppVersion.mockReturnValue(new Promise(() => {}));
    mocks.protocolVersion.mockReturnValue(new Promise(() => {}));
    const { container } = render(AboutPage);

    expect(container.querySelectorAll('.technical-value[aria-busy="true"]')).toHaveLength(2);
    expect(container.querySelectorAll('.technical-value .visually-hidden')).toHaveLength(2);
  });

  it('shows localized unknown values when metadata reads fail', async () => {
    mocks.loadAppVersion.mockRejectedValue(new Error('version unavailable'));
    mocks.protocolVersion.mockRejectedValue(new Error('protocol unavailable'));
    const { container } = render(AboutPage);

    await waitFor(() => {
      const values = [...container.querySelectorAll('.technical-value')].map((node) => node.textContent?.trim());
      expect(values).toEqual(['Unknown', 'Unknown']);
    });
    expect(container.querySelectorAll('.technical-value[aria-busy="false"]')).toHaveLength(2);
  });
});
