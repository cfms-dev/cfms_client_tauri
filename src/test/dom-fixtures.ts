import { onTestFinished, vi } from 'vitest';

/** Unlike restoreAllMocks, this also restores absent properties and accessors. */
export function replaceProperty(target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
  onTestFinished(() => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  });
}

export function createMatchMedia(matches = false) {
  return vi.fn((media: string): MediaQueryList => ({
    matches, media, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }));
}

export function stubMatchMedia(matches = false) {
  vi.stubGlobal('matchMedia', createMatchMedia(matches));
}

/** Complete zero-duration Web Animations in a microtask, without RAF timers. */
export function stubInstantAnimations() {
  replaceProperty(Element.prototype, 'getAnimations', { value: () => [] });
  replaceProperty(Element.prototype, 'animate', {
    value: () => {
      const animation = {
        cancel: vi.fn(), commitStyles: vi.fn(), currentTime: 0, effect: null,
        finished: Promise.resolve(), finish: vi.fn(), onfinish: null,
        playState: 'finished', play: vi.fn(), pause: vi.fn(),
      } as unknown as Animation;
      void Promise.resolve().then(() => animation.onfinish?.(new Event('finish') as AnimationPlaybackEvent));
      return animation;
    },
  });
}
