<script lang="ts">
  // MD3 NavigationBar — floating, blurred, rounded-capsule bottom tab bar.
  //
  // • Centered via a full-width fixed wrapper + flex centering, so nothing
  //   competes with transforms (the entrance animation / sliding pill).
  // • A single "pill" element sits behind the tabs and GLIDES to the active
  //   tab with an emphasized easing whenever the route changes, instead of
  //   the highlight jumping instantly.
  // • The wrapper is pointer-events:none (so it never blocks the page) while
  //   the nav itself is pointer-events:auto.
  //
  // Reference: HomeNavigationBar in reference/src/include/ui/models/home.py

  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import Icon from './Icon.svelte';
  import type { IconName } from '$lib/icons';
  import { ripple } from '$lib/motion/actions';

  interface Tab {
    href: string;
    label: string;
    icon: IconName;
    badge?: number;
    hidden?: boolean;
  }

  interface Props {
    tabs: Tab[];
  }

  let { tabs }: Props = $props();

  const visibleTabs = $derived(tabs.filter((t) => !t.hidden));

  function isActive(href: string): boolean {
    return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
  }

  // Refs to each tab button, used to measure the active tab's box so the
  // sliding pill can be positioned/animated to match it.
  let btnEls = $state<(HTMLButtonElement | null)[]>([]);
  let pill = $state<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  });
  // Transitions are enabled only after the first measurement so the pill
  // doesn't visibly slide in from the left edge on initial mount.
  let animate = $state(false);

  function measure() {
    const idx = visibleTabs.findIndex((t) => isActive(t.href));
    const el = idx >= 0 ? btnEls[idx] : null;
    if (el) {
      pill = { left: el.offsetLeft, width: el.offsetWidth, ready: true };
    } else {
      pill = { ...pill, ready: false };
    }
  }

  // Re-measure after layout whenever the active route or the tab set changes.
  $effect(() => {
    // Track dependencies explicitly.
    void page.url.pathname;
    void visibleTabs.length;
    requestAnimationFrame(() => {
      measure();
      requestAnimationFrame(() => {
        animate = true;
      });
    });
  });

  // Keep the pill aligned if the window (and therefore tab layout) resizes.
  $effect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });
</script>

<div
  class="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4
         pointer-events-none motion-navbar-in"
>
  <nav
    class="pointer-events-auto relative flex items-stretch gap-1 p-1.5
           rounded-full border border-md3-outline/50
           bg-md3-surface-container/70 backdrop-blur-xl
           shadow-[0_12px_40px_-8px_rgba(0,0,0,0.55)]"
    aria-label="Main navigation"
  >
    <!-- Sliding active-tab background. Glides between tabs on navigation. -->
    <span
      class="absolute top-1.5 bottom-1.5 rounded-full bg-md3-primary shadow-lg pointer-events-none"
      style="left: 0; width: {pill.width}px;
             transform: translateX({pill.left}px);
             opacity: {pill.ready ? 1 : 0};
             transition: {animate
               ? 'transform 420ms var(--motion-easing-emphasized, cubic-bezier(0.2,0,0,1)), width 420ms var(--motion-easing-emphasized, cubic-bezier(0.2,0,0,1)), opacity 200ms ease'
               : 'opacity 200ms ease'};"
      aria-hidden="true"
    ></span>

    {#each visibleTabs as tab, i}
      <button
        bind:this={btnEls[i]}
        class="relative z-10 overflow-hidden rounded-full
               flex flex-col items-center justify-center gap-0.5
               px-4 py-1.5 min-w-[3.75rem]
               transition-colors duration-300 active:scale-95"
        class:text-md3-on-primary={isActive(tab.href)}
        class:text-md3-on-surface-variant={!isActive(tab.href)}
        onclick={() => goto(tab.href)}
        aria-label={tab.label}
        aria-current={isActive(tab.href) ? 'page' : undefined}
        use:ripple
      >
        <div class="relative">
          <Icon name={tab.icon} size="22px" />
          {#if tab.badge != null && tab.badge > 0}
            <span
              class="absolute -top-1.5 -right-3 min-w-[16px] h-4
                     flex items-center justify-center
                     bg-md3-error text-md3-on-error
                     text-[10px] font-bold rounded-full px-1
                     ring-2 ring-md3-surface-container"
            >
              {tab.badge > 99 ? '99+' : tab.badge}
            </span>
          {/if}
        </div>
        <span
          class="text-[11px] font-medium leading-none"
          class:font-semibold={isActive(tab.href)}
          style="font-family: var(--font-md3-sans);"
        >
          {tab.label}
        </span>
      </button>
    {/each}
  </nav>
</div>
