import { spring } from "svelte/motion";
import type { TransitionConfig } from "svelte/transition";

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

const emphasized = (t: number): number => 1 - Math.pow(1 - t, 3);

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function instant(): TransitionConfig {
  return { duration: 0 };
}

export function flyScale(
  _node: Element,
  params: FlyScaleParams = {},
): TransitionConfig {
  if (prefersReducedMotion()) return instant();

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
    delay: prefersReducedMotion() ? 0 : delay + index * step,
  };
}

export function popScale(
  node: HTMLElement,
  params: PopScaleParams = {},
): TransitionConfig {
  if (prefersReducedMotion()) return instant();

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
