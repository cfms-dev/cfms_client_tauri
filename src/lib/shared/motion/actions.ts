import type { Action } from "svelte/action";
import { isReducedMotionEnabled } from "$lib/shared/appearance";

export interface SmoothPositionParams {
  duration?: number;
}

/**
 * Keeps an element visually anchored when its parent's changing height moves
 * it in the document flow, then eases it into the new layout position.
 */
export const smoothPosition: Action<HTMLElement, SmoothPositionParams | undefined> = (
  node,
  params = {},
) => {
  if (
    isReducedMotionEnabled()
    || typeof ResizeObserver === "undefined"
    || typeof node.animate !== "function"
  ) {
    return { destroy() {} };
  }

  const { duration = 350 } = params;
  const observedElement = node.parentElement ?? node;
  let previousLayoutTop = node.getBoundingClientRect().top;
  let activeAnimation: Animation | null = null;
  let frame = 0;

  const measure = () => {
    if (isReducedMotionEnabled()) {
      activeAnimation?.cancel();
      activeAnimation = null;
      return;
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const animationInProgress = activeAnimation?.playState === "running";
      const visualTop = node.getBoundingClientRect().top;

      activeAnimation?.cancel();
      activeAnimation = null;

      const layoutTop = node.getBoundingClientRect().top;
      const delta = (animationInProgress ? visualTop : previousLayoutTop) - layoutTop;
      previousLayoutTop = layoutTop;

      if (Math.abs(delta) < 0.5) return;

      activeAnimation = node.animate(
        [
          { transform: `translate3d(0, ${delta}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        {
          duration,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        },
      );
      activeAnimation.addEventListener(
        "finish",
        () => {
          activeAnimation = null;
        },
        { once: true },
      );
    });
  };

  const observer = new ResizeObserver(measure);
  observer.observe(observedElement);
  window.addEventListener("resize", measure);

  return {
    destroy() {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(frame);
      activeAnimation?.cancel();
    },
  };
};
