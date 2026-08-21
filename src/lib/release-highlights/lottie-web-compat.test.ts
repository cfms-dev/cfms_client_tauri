// @vitest-environment jsdom

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import administrationDark from './animations/v0.43/account-administration.dark.json';
import administrationLight from './animations/v0.43/account-administration.light.json';
import documentDownloadDark from './animations/v0.43/document-download.dark.json';
import documentDownloadLight from './animations/v0.43/document-download.light.json';
import diagnosticsDark from './animations/v0.43/server-diagnostics.dark.json';
import diagnosticsLight from './animations/v0.43/server-diagnostics.light.json';
import flexibleWorkspaceDark from './animations/v0.43/flexible-workspace.dark.json';
import flexibleWorkspaceLight from './animations/v0.43/flexible-workspace.light.json';
import fullscreenTourDark from './animations/v0.45/fullscreen-tour.dark.json';
import fullscreenTourLight from './animations/v0.45/fullscreen-tour.light.json';

const diagnosticsThemes = [
  ['light', diagnosticsLight],
  ['dark', diagnosticsDark],
] as const;
const documentDownloadThemes = [
  ['light', documentDownloadLight],
  ['dark', documentDownloadDark],
] as const;
const administrationThemes = [
  ['light', administrationLight],
  ['dark', administrationDark],
] as const;
const flexibleWorkspaceThemes = [
  ['light', flexibleWorkspaceLight],
  ['dark', flexibleWorkspaceDark],
] as const;
const fullscreenTourThemes = [
  ['light', fullscreenTourLight],
  ['dark', fullscreenTourDark],
] as const;

let restoreCanvas: (() => void) | undefined;

beforeAll(() => {
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  restoreCanvas = () => getContext.mockRestore();
});

afterAll(() => {
  restoreCanvas?.();
});

describe('document ID download lottie-web compatibility', () => {
  it.each(documentDownloadThemes)(
    'renders each workflow beat and closes the loop in the %s theme',
    async (_theme, data) => {
      const { default: lottie } =
        await import('lottie-web/build/player/lottie_light');
      const host = document.createElement('div');
      document.body.append(host);
      const animation = lottie.loadAnimation({
        container: host,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: structuredClone(data),
      });

      await new Promise<void>((resolve, reject) => {
        animation.addEventListener('DOMLoaded', resolve);
        animation.addEventListener('data_failed', () =>
          reject(new Error('Lottie rejected the animation data')),
        );
      });

      const renderFrame = (frame: number) => {
        animation.goToAndStop(frame, true);
        const renderedSvg = host.firstElementChild?.cloneNode(true) as SVGElement;
        renderedSvg
          .querySelectorAll<SVGElement>('[style*="display: none"]')
          .forEach((element) => element.remove());
        return renderedSvg.outerHTML;
      };
      const completedFrame = renderFrame(0);
      const entryFrame = renderFrame(22);
      const dialogFrame = renderFrame(46);
      const typedFrame = renderFrame(63);
      const pressedFrame = renderFrame(74);
      const verifiedFrame = renderFrame(85);
      const resolvedFrame = renderFrame(114);
      const loopFrame = renderFrame(119);

      expect(entryFrame).not.toEqual(completedFrame);
      expect(dialogFrame).not.toEqual(entryFrame);
      expect(typedFrame).not.toEqual(dialogFrame);
      expect(pressedFrame).not.toEqual(typedFrame);
      expect(verifiedFrame).not.toEqual(pressedFrame);
      expect(resolvedFrame).not.toEqual(verifiedFrame);
      expect(loopFrame).toEqual(completedFrame);

      animation.destroy();
      host.remove();
    },
  );
});

describe('server diagnostics lottie-web compatibility', () => {
  it.each(diagnosticsThemes)(
    'renders changing SVG frames in the %s theme',
    async (_theme, data) => {
      const { default: lottie } =
        await import('lottie-web/build/player/lottie_light');
      const host = document.createElement('div');
      document.body.append(host);
      const animation = lottie.loadAnimation({
        container: host,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: structuredClone(data),
      });

      await new Promise<void>((resolve, reject) => {
        animation.addEventListener('DOMLoaded', resolve);
        animation.addEventListener('data_failed', () =>
          reject(new Error('Lottie rejected the animation data')),
        );
      });

      animation.goToAndStop(0, true);
      const openingFrame = host.innerHTML;
      animation.goToAndStop(30, true);
      const scanFrame = host.innerHTML;
      animation.goToAndStop(72, true);
      const revealFrame = host.innerHTML;

      expect(scanFrame).not.toEqual(openingFrame);
      expect(revealFrame).not.toEqual(scanFrame);

      animation.destroy();
      host.remove();
    },
  );
});

describe('account administration lottie-web compatibility', () => {
  it.each(administrationThemes)(
    'renders each semantic beat and closes the loop in the %s theme',
    async (_theme, data) => {
      const { default: lottie } =
        await import('lottie-web/build/player/lottie_light');
      const host = document.createElement('div');
      document.body.append(host);
      const animation = lottie.loadAnimation({
        container: host,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: structuredClone(data),
      });

      await new Promise<void>((resolve, reject) => {
        animation.addEventListener('DOMLoaded', resolve);
        animation.addEventListener('data_failed', () =>
          reject(new Error('Lottie rejected the animation data')),
        );
      });

      const renderFrame = (frame: number) => {
        animation.goToAndStop(frame, true);
        const renderedSvg = host.firstElementChild?.cloneNode(true) as SVGElement;
        renderedSvg
          .querySelectorAll<SVGElement>('[style*="display: none"]')
          .forEach((element) => element.remove());
        return renderedSvg.outerHTML;
      };
      const completedFrame = renderFrame(0);
      const resetFrame = renderFrame(24);
      const selectionFrame = renderFrame(46);
      const dialogFrame = renderFrame(82);
      const confirmationFrame = renderFrame(106);
      const loopFrame = renderFrame(119);

      expect(resetFrame).not.toEqual(completedFrame);
      expect(selectionFrame).not.toEqual(resetFrame);
      expect(dialogFrame).not.toEqual(selectionFrame);
      expect(confirmationFrame).not.toEqual(dialogFrame);
      expect(loopFrame).toEqual(completedFrame);

      animation.destroy();
      host.remove();
    },
  );
});

describe('flexible workspace lottie-web compatibility', () => {
  it.each(flexibleWorkspaceThemes)(
    'renders the resize and maximize beats and closes the loop in the %s theme',
    async (_theme, data) => {
      const { default: lottie } =
        await import('lottie-web/build/player/lottie_light');
      const host = document.createElement('div');
      document.body.append(host);
      const animation = lottie.loadAnimation({
        container: host,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: structuredClone(data),
      });

      await new Promise<void>((resolve, reject) => {
        animation.addEventListener('DOMLoaded', resolve);
        animation.addEventListener('data_failed', () =>
          reject(new Error('Lottie rejected the animation data')),
        );
      });

      const renderFrame = (frame: number) => {
        animation.goToAndStop(frame, true);
        const renderedSvg = host.firstElementChild?.cloneNode(true) as SVGElement;
        renderedSvg
          .querySelectorAll<SVGElement>('[style*="display: none"]')
          .forEach((element) => element.remove());
        return renderedSvg.outerHTML;
      };
      const completedFrame = renderFrame(0);
      const resetFrame = renderFrame(22);
      const resizeFrame = renderFrame(50);
      const windowFrame = renderFrame(76);
      const maximizeFrame = renderFrame(96);
      const loopFrame = renderFrame(119);

      expect(resetFrame).not.toEqual(completedFrame);
      expect(resizeFrame).not.toEqual(resetFrame);
      expect(windowFrame).not.toEqual(resizeFrame);
      expect(maximizeFrame).not.toEqual(windowFrame);
      expect(loopFrame).toEqual(completedFrame);

      animation.destroy();
      host.remove();
    },
  );
});

describe('full-screen feature tour lottie-web compatibility', () => {
  it.each(fullscreenTourThemes)(
    'renders the window, expansion, and completed full-screen beats in the %s theme',
    async (_theme, data) => {
      const { default: lottie } =
        await import('lottie-web/build/player/lottie_light');
      const host = document.createElement('div');
      document.body.append(host);
      const animation = lottie.loadAnimation({
        container: host,
        renderer: 'svg',
        loop: false,
        autoplay: false,
        animationData: structuredClone(data),
      });

      await new Promise<void>((resolve, reject) => {
        animation.addEventListener('DOMLoaded', resolve);
        animation.addEventListener('data_failed', () =>
          reject(new Error('Lottie rejected the animation data')),
        );
      });

      const renderFrame = (frame: number) => {
        animation.goToAndStop(frame, true);
        return host.innerHTML;
      };
      const windowFrame = renderFrame(0);
      const anticipationFrame = renderFrame(20);
      const expansionFrame = renderFrame(46);
      const completedFrame = renderFrame(80);
      const reducedMotionFrame = renderFrame(119);

      expect(anticipationFrame).not.toEqual(windowFrame);
      expect(expansionFrame).not.toEqual(anticipationFrame);
      expect(completedFrame).not.toEqual(expansionFrame);
      expect(reducedMotionFrame).toEqual(completedFrame);

      animation.destroy();
      host.remove();
    },
  );
});
