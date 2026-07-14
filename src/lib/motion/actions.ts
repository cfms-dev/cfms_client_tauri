import type { Action } from "svelte/action";

export interface HoverLiftParams {
  lift?: number;
  shadow?: string;
}

export interface RevealParams {
  threshold?: number;
  rootMargin?: string;
  class?: string;
}

export interface SmoothPositionParams {
  duration?: number;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const ripple: Action<HTMLElement> = (node) => {
  if (prefersReducedMotion()) {
    return { destroy() {} };
  }

  const rippleRoot = document.createElement("span");
  rippleRoot.className = "motion-ripple-root";
  node.prepend(rippleRoot);

  const handleClick = (event: MouseEvent) => {
    const rect = node.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const circle = document.createElement("span");

    circle.className = "motion-ripple";
    circle.style.width = `${size}px`;
    circle.style.height = `${size}px`;
    circle.style.left = `${event.clientX - rect.left}px`;
    circle.style.top = `${event.clientY - rect.top}px`;

    rippleRoot.appendChild(circle);
    circle.addEventListener("animationend", () => circle.remove(), { once: true });
  };

  node.addEventListener("click", handleClick);

  return {
    destroy() {
      node.removeEventListener("click", handleClick);
      rippleRoot.remove();
    },
  };
};

export const hoverLift: Action<HTMLElement, HoverLiftParams | undefined> = (
  node,
  params = {},
) => {
  if (prefersReducedMotion()) {
    return { destroy() {} };
  }

  const { lift = 4, shadow = "0 18px 40px rgba(79, 70, 229, 0.16)" } = params;
  const initialTransition = node.style.transition;
  const initialTransform = node.style.transform;
  const initialShadow = node.style.boxShadow;

  node.style.willChange = "transform, box-shadow";
  node.style.transition = [
    initialTransition,
    "transform var(--motion-duration-medium1) var(--motion-easing-emphasized-decelerate)",
    "box-shadow var(--motion-duration-medium1) var(--motion-easing-emphasized-decelerate)",
  ].filter(Boolean).join(", ");

  const enter = () => {
    node.style.transform = `${initialTransform} translate3d(0, -${lift}px, 0)`.trim();
    node.style.boxShadow = shadow;
  };

  const leave = () => {
    node.style.transition = [
      initialTransition,
      "transform var(--motion-duration-medium2) cubic-bezier(0.34, 1.56, 0.64, 1)",
      "box-shadow var(--motion-duration-medium2) var(--motion-easing-standard)",
    ].filter(Boolean).join(", ");
    node.style.transform = initialTransform;
    node.style.boxShadow = initialShadow;
  };

  node.addEventListener("mouseenter", enter);
  node.addEventListener("mouseleave", leave);

  return {
    destroy() {
      node.removeEventListener("mouseenter", enter);
      node.removeEventListener("mouseleave", leave);
      node.style.transition = initialTransition;
      node.style.transform = initialTransform;
      node.style.boxShadow = initialShadow;
      node.style.willChange = "";
    },
  };
};

export const reveal: Action<HTMLElement, RevealParams | undefined> = (
  node,
  params = {},
) => {
  if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
    return { destroy() {} };
  }

  const {
    threshold = 0.12,
    rootMargin = "0px 0px -8% 0px",
    class: activeClass = "motion-revealed",
  } = params;

  node.classList.add("motion-reveal");

  const observer = new IntersectionObserver(
    ([entry]) => {
      node.classList.toggle(activeClass, entry?.isIntersecting ?? false);
    },
    { threshold, rootMargin },
  );

  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
      node.classList.remove("motion-reveal", activeClass);
    },
  };
};

/**
 * Keeps an element visually anchored when its parent's changing height moves
 * it in the document flow, then eases it into the new layout position.
 */
export const smoothPosition: Action<HTMLElement, SmoothPositionParams | undefined> = (
  node,
  params = {},
) => {
  if (
    prefersReducedMotion()
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
