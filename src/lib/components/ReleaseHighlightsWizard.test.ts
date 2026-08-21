// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '$lib/i18n';
import { findReleaseTour, filterReleaseHighlights } from '$lib/release-highlights/catalog';
import type {
  LottieAnimationData,
  ReleaseHighlightAnimationLoader,
  ReleaseTourPresentation,
} from '$lib/release-highlights/types';
import LottieScene from './LottieScene.svelte';
import ReleaseHighlightsWizard from './ReleaseHighlightsWizard.svelte';

const lottieMocks = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  const animation = {
    totalFrames: 120,
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

const animationData: LottieAnimationData = {
  v: '5.13.0', fr: 30, ip: 0, op: 120, w: 960, h: 600, assets: [], layers: [],
};
const loadAnimationData: ReleaseHighlightAnimationLoader = vi.fn(async () => ({ default: animationData }));

function presentation(permissions: readonly string[] = []): ReleaseTourPresentation {
  const tour = findReleaseTour('0.45.0')!;
  return {
    tour,
    highlights: filterReleaseHighlights(tour.highlights, permissions),
    source: 'manual',
  };
}

function completeWizardExit() {
  const event = new Event('animationend', { bubbles: true }) as AnimationEvent;
  Object.defineProperty(event, 'animationName', { value: 'overlay-exit' });
  return fireEvent(document.querySelector('.release-highlights-overlay')!, event);
}

beforeEach(() => {
  locale.set('en');
  document.documentElement.dataset.reduceMotion = 'false';
  document.documentElement.dataset.theme = 'dark';
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  lottieMocks.listeners.clear();
  lottieMocks.loadAnimation.mockClear();
  lottieMocks.animation.destroy.mockClear();
  lottieMocks.animation.pause.mockClear();
  lottieMocks.animation.play.mockClear();
  lottieMocks.animation.goToAndStop.mockClear();
  vi.mocked(loadAnimationData).mockClear();
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.reduceMotion;
  delete document.documentElement.dataset.theme;
});

describe('ReleaseHighlightsWizard', () => {
  it('moves through the filtered slides and finishes from the final action', async () => {
    const onDismiss = vi.fn();
    render(ReleaseHighlightsWizard, { props: { presentation: presentation(), onDismiss } });

    expect(screen.getByRole('heading', { name: 'A focused, full-screen feature tour' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Download by document ID' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: 'Adjust the workspace to fit' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Start using CFMS' }));
    expect(onDismiss).not.toHaveBeenCalled();
    await completeWizardExit();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows permission-aware slides and supports direct progress navigation', async () => {
    render(ReleaseHighlightsWizard, {
      props: { presentation: presentation(['diagnostics', 'manage_system']), onDismiss: vi.fn() },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'View feature 4' }));
    expect(screen.getByRole('heading', { name: 'Review server diagnostics' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'View feature 5' }));
    expect(screen.getByRole('heading', { name: 'Clearer account management' })).toBeTruthy();
  });

  it('supports arrow keys, Escape, and keeps keyboard focus inside the dialog', async () => {
    const onDismiss = vi.fn();
    render(ReleaseHighlightsWizard, { props: { presentation: presentation(), onDismiss } });
    const dialog = screen.getByRole('dialog');

    await waitFor(() => expect(document.activeElement).toBe(dialog));
    await fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: 'Download by document ID' })).toBeTruthy();
    await fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: 'A focused, full-screen feature tour' })).toBeTruthy();

    const next = screen.getByRole('button', { name: 'Next' });
    next.focus();
    await fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skip introduction' }));

    await fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
    await completeWizardExit();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('commits an animated dismissal once and restores the previous focus after unmount', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open feature tour';
    document.body.append(opener);
    opener.focus();
    const onDismiss = vi.fn();
    const result = render(ReleaseHighlightsWizard, { props: { presentation: presentation(), onDismiss } });

    await waitFor(() => expect(screen.getByRole('dialog')).toBe(document.activeElement));
    const skip = screen.getByRole('button', { name: 'Skip introduction' });
    await fireEvent.click(skip);
    await fireEvent.click(skip);
    expect(onDismiss).not.toHaveBeenCalled();

    await completeWizardExit();
    await completeWizardExit();
    expect(onDismiss).toHaveBeenCalledTimes(1);

    result.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('dismisses immediately when reduced motion is enabled', async () => {
    document.documentElement.dataset.reduceMotion = 'true';
    const onDismiss = vi.fn();
    render(ReleaseHighlightsWizard, { props: { presentation: presentation(), onDismiss } });

    await fireEvent.click(screen.getByRole('button', { name: 'Skip introduction' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('uses one edge-to-edge screen instead of a windowed dialog surface', () => {
    const { container } = render(ReleaseHighlightsWizard, {
      props: { presentation: presentation(), onDismiss: vi.fn() },
    });

    expect(container.querySelector('.release-highlights-screen')).toBeTruthy();
    expect(container.querySelector('.release-highlights-dialog')).toBeNull();
  });

  it('recreates the current scene when the color scheme changes', async () => {
    render(ReleaseHighlightsWizard, { props: { presentation: presentation(), onDismiss: vi.fn() } });
    await waitFor(() => expect(lottieMocks.loadAnimation).toHaveBeenCalledTimes(1));

    document.documentElement.dataset.theme = 'light';
    await waitFor(() => expect(lottieMocks.loadAnimation).toHaveBeenCalledTimes(2));
    expect(lottieMocks.animation.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('LottieScene', () => {
  it('loads bundled animation data without a runtime path and plays only once', async () => {
    render(LottieScene, { props: { loadAnimationData, fallbackIcon: 'download' } });

    await waitFor(() => expect(lottieMocks.loadAnimation).toHaveBeenCalledTimes(1));
    const config = lottieMocks.loadAnimation.mock.calls[0][0] as Record<string, unknown>;
    expect(config).toMatchObject({ autoplay: true, loop: false, animationData });
    expect(config).not.toHaveProperty('path');
  });

  it('freezes on the final frame when reduced motion is enabled', async () => {
    render(LottieScene, {
      props: { loadAnimationData, fallbackIcon: 'download', reducedMotion: true },
    });

    await waitFor(() => expect(lottieMocks.loadAnimation).toHaveBeenCalledTimes(1));
    expect(lottieMocks.loadAnimation.mock.calls[0][0]).toMatchObject({ autoplay: false, loop: false });
    lottieMocks.listeners.get('DOMLoaded')?.();
    expect(lottieMocks.animation.goToAndStop).toHaveBeenCalledWith(119, true);
  });

  it('pauses while hidden, resumes when visible, and destroys the player on cleanup', async () => {
    const result = render(LottieScene, { props: { loadAnimationData, fallbackIcon: 'download' } });
    await waitFor(() => expect(lottieMocks.loadAnimation).toHaveBeenCalledTimes(1));
    lottieMocks.listeners.get('DOMLoaded')?.();

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(lottieMocks.animation.pause).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(lottieMocks.animation.play).toHaveBeenCalledTimes(1);

    lottieMocks.listeners.get('complete')?.();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(lottieMocks.animation.play).toHaveBeenCalledTimes(1);

    result.unmount();
    expect(lottieMocks.animation.destroy).toHaveBeenCalledTimes(1);
  });

  it('shows the composed fallback when the animation module cannot load', async () => {
    const rejectedLoader: ReleaseHighlightAnimationLoader = vi.fn(async () => {
      throw new Error('missing animation module');
    });
    const { container } = render(LottieScene, {
      props: { loadAnimationData: rejectedLoader, fallbackIcon: 'download' },
    });

    await waitFor(() => expect(container.querySelector('[data-icon="download"]')).toBeTruthy());
    expect(lottieMocks.loadAnimation).not.toHaveBeenCalled();
  });

  it('shows the composed fallback when Lottie reports invalid data', async () => {
    const { container } = render(LottieScene, { props: { loadAnimationData, fallbackIcon: 'download' } });
    await waitFor(() => expect(lottieMocks.loadAnimation).toHaveBeenCalledTimes(1));
    lottieMocks.listeners.get('data_failed')?.();
    await waitFor(() => expect(container.querySelector('[data-icon="download"]')).toBeTruthy());
  });
});
