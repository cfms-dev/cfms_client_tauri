// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '$lib/i18n';
import { findReleaseTour, filterReleaseHighlights } from '$lib/release-highlights/catalog';
import type { ReleaseTourPresentation } from '$lib/release-highlights/types';
import LottieScene from './LottieScene.svelte';
import ReleaseHighlightsWizard from './ReleaseHighlightsWizard.svelte';

const lottieMocks = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  const animation = {
    totalFrames: 180,
    addEventListener: vi.fn((name: string, callback: () => void) => {
      listeners.set(name, callback);
      return vi.fn();
    }),
    destroy: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    goToAndStop: vi.fn(),
  };
  return {
    listeners,
    animation,
    loadAnimation: vi.fn((_config: unknown) => animation),
  };
});

vi.mock('lottie-web/build/player/lottie_light', () => ({
  default: { loadAnimation: lottieMocks.loadAnimation },
}));

function presentation(): ReleaseTourPresentation {
  const tour = findReleaseTour('0.43.0')!;
  return {
    tour,
    highlights: filterReleaseHighlights(tour.highlights, []),
    source: 'manual',
  };
}

beforeEach(() => {
  locale.set('en');
  document.documentElement.dataset.reduceMotion = 'false';
  lottieMocks.listeners.clear();
  lottieMocks.loadAnimation.mockClear();
  lottieMocks.animation.destroy.mockClear();
  lottieMocks.animation.goToAndStop.mockClear();
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.reduceMotion;
});

describe('ReleaseHighlightsWizard', () => {
  it('moves through the filtered slides and finishes from the final action', async () => {
    const onDismiss = vi.fn();
    render(ReleaseHighlightsWizard, { props: { presentation: presentation(), onDismiss } });

    expect(screen.getByRole('heading', { name: 'Retrieve a document by its ID' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'A workspace that fits the content' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Start using CFMS' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('supports Escape and keeps keyboard focus inside the dialog', async () => {
    const onDismiss = vi.fn();
    render(ReleaseHighlightsWizard, { props: { presentation: presentation(), onDismiss } });
    const dialog = screen.getByRole('dialog');

    await waitFor(() => expect(document.activeElement).toBe(dialog));
    const next = screen.getByRole('button', { name: 'Next' });
    next.focus();
    await fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skip introduction' }));

    await fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('LottieScene', () => {
  it('freezes on a representative frame when reduced motion is enabled', async () => {
    render(LottieScene, {
      props: {
        src: '/release-highlights/v0.43/document-download.json',
        fallbackIcon: 'download',
        reducedMotion: true,
      },
    });

    await waitFor(() => expect(lottieMocks.loadAnimation).toHaveBeenCalledTimes(1));
    expect(lottieMocks.loadAnimation.mock.calls[0][0]).toMatchObject({ autoplay: false, loop: false });
    lottieMocks.listeners.get('DOMLoaded')?.();
    expect(lottieMocks.animation.goToAndStop).toHaveBeenCalledWith(179, true);
  });
});
