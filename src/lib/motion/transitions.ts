import { spring } from "svelte/motion";
import type { TransitionConfig } from "svelte/transition";
import { isReducedMotionEnabled } from "$lib/appearance";

export interface FlyScaleParams {
  y?: number;
  x?: number;
  duration?: number;
  delay?: number;
}

export interface StaggeredListParams extends FlyScaleParams {
  step?: number;
}

export interface PopScaleParams {
  duration?: number;
  delay?: number;
}

export interface MenuScaleParams {
  duration?: number;
  delay?: number;
  y?: number;
}

export interface SnackbarMotionParams {
  y?: number;
  duration?: number;
  delay?: number;
}

const emphasized = (t: number): number => 1 - Math.pow(1 - t, 3);

function instant(): TransitionConfig {
  return { duration: 0 };
}

export function flyScale(
  _node: Element,
  params: FlyScaleParams = {},
): TransitionConfig {
  if (isReducedMotionEnabled()) return instant();

  const {
    y = 12,
    x = 0,
    duration = 300,
    delay = 0,
  } = params;

  return {
    delay,
    duration,
    easing: emphasized,
    css: (t, u) => `
      opacity: ${t};
      transform: translate3d(${u * x}px, ${u * y}px, 0) scale(${0.95 + t * 0.05});
      filter: blur(${u * 4}px);
    `,
  };
}

export function staggeredList(
  index: number,
  params: StaggeredListParams = {},
): FlyScaleParams {
  const { step = 45, delay = 0, ...rest } = params;

  return {
    ...rest,
    delay: isReducedMotionEnabled() ? 0 : delay + index * step,
  };
}

export function popScale(
  node: HTMLElement,
  params: PopScaleParams = {},
): TransitionConfig {
  if (isReducedMotionEnabled()) return instant();

  const { duration = 360, delay = 0 } = params;
  const scale = spring(0.95, { stiffness: 0.18, damping: 0.48, precision: 0.001 });
  const unsubscribe = scale.subscribe((value) => {
    node.style.transform = `scale(${value})`;
  });

  let started = false;

  return {
    delay,
    duration,
    tick: (t) => {
      if (!started && t > 0) {
        started = true;
        void scale.set(1.08).then(() => scale.set(1));
      }

      node.style.opacity = `${t}`;

      if (t === 1) {
        unsubscribe();
        node.style.transform = "";
        node.style.opacity = "";
      }
    },
  };
}

export function menuScale(
  _node: Element,
  params: MenuScaleParams = {},
): TransitionConfig {
  if (isReducedMotionEnabled()) return instant();

  const {
    duration = 140,
    delay = 0,
    y = -3,
  } = params;

  return {
    delay,
    duration,
    easing: emphasized,
    css: (t, u) => `
      opacity: ${t};
      transform: translate3d(0, ${u * y}px, 0) scale(${0.975 + t * 0.025});
      filter: blur(${u * 4}px);
    `,
  };
}

export function snackbarMotion(
  _node: Element,
  params: SnackbarMotionParams = {},
): TransitionConfig {
  if (isReducedMotionEnabled()) return instant();

  const {
    y = 18,
    duration = 220,
    delay = 0,
  } = params;

  return {
    delay,
    duration,
    easing: emphasized,
    css: (t, u) => `
      opacity: ${t};
      transform: translate3d(0, ${u * y}px, 0) scale(${0.96 + t * 0.04});
      filter: blur(${u * 5}px);
    `,
  };
}
